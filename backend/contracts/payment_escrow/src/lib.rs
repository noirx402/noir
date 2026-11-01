#![no_std]
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, contracterror, panic_with_error, Address, BytesN, Env, Vec};

pub mod agent_registry {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/agent_registry.wasm"
    );
}

pub mod device_registry {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/device_registry.wasm"
    );
}

#[contracttype]
pub enum DataKey {
    Admin,
    AgentRegistry,
    DeviceRegistry,
    EscrowBalance(BytesN<32>),
    /// The token a device's escrow balance is held in. Balances are plain
    /// numbers, so every movement must use this token or a deposit in one
    /// token could be withdrawn in another.
    EscrowToken(BytesN<32>),
    PendingIndex(Address),
    PendingPayment((Address, u32)),
    AuthNonce((BytesN<32>, Address)),
}

#[contracttype]
pub struct Payment {
    pub device_hash: BytesN<32>,
    /// Token the payment was authorized in; `claim` only pays it out in this token.
    pub asset: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    InsufficientBalance = 2,
    AgentNotAuthorized = 3,
    NotDeviceOwner = 4,
    NothingToClaim = 5,
    DuplicateAuth = 6,
    AgentStillActive = 7,
    /// fund_escrow for a device hash device_registry does not know. Refused
    /// because defund/sweep resolve the owner through device_registry, so a
    /// deposit for an unregistered device could never be recovered.
    DeviceNotRegistered = 8,
    /// The token does not match the one the device's escrow is held in.
    InvalidAsset = 9,
    /// The merchant is the escrow contract itself; the payment could never be claimed.
    InvalidRecipient = 10,
    /// Deposit or withdrawal amount is zero or negative.
    InvalidAmount = 11,
}

#[contract]
pub struct PaymentEscrow;

/// Emitted when escrow is funded. Topics: ("fund", device_hash).
#[contractevent(topics = ["fund"], data_format = "single-value")]
pub struct FundEvent {
    #[topic]
    pub device_hash: BytesN<32>,
    pub amount: i128,
}

/// Emitted when a payment is authorized. Topics: ("authorize", device_hash, merchant).
#[contractevent(topics = ["authorize"], data_format = "single-value")]
pub struct AuthorizeEvent {
    #[topic]
    pub device_hash: BytesN<32>,
    #[topic]
    pub merchant: Address,
    pub amount: i128,
}

/// Emitted when a merchant claims pending payments. Topics: ("claim", merchant).
#[contractevent(topics = ["claim"], data_format = "single-value")]
pub struct ClaimEvent {
    #[topic]
    pub merchant: Address,
    pub total: i128,
}

/// Emitted when escrow is defunded. Topics: ("defund", device_hash).
#[contractevent(topics = ["defund"], data_format = "single-value")]
pub struct DefundEvent {
    #[topic]
    pub device_hash: BytesN<32>,
    pub amount: i128,
}

/// Emitted when escrow is swept on agent revocation. Topics: ("sweep", device_hash).
#[contractevent(topics = ["sweep"], data_format = "single-value")]
pub struct SweepEvent {
    #[topic]
    pub device_hash: BytesN<32>,
    pub balance: i128,
}

#[contractimpl]
impl PaymentEscrow {
    pub fn initialize(env: Env, admin: Address, agent_registry_id: Address, device_registry_id: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::AgentRegistry, &agent_registry_id);
        storage.set(&DataKey::DeviceRegistry, &device_registry_id);
    }

    pub fn fund_escrow(
        env: Env,
        token: Address,
        wallet: Address,
        device_hash: BytesN<32>,
        amount: i128,
    ) {
        wallet.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if Self::device_owner(&env, &device_hash).is_none() {
            panic_with_error!(&env, Error::DeviceNotRegistered);
        }

        let key = DataKey::EscrowBalance(device_hash.clone());
        let current = env
            .storage()
            .persistent()
            .get::<_, i128>(&key)
            .unwrap_or(0);

        // An empty escrow may switch token; a funded one only takes more of
        // the token it already holds.
        let token_key = DataKey::EscrowToken(device_hash.clone());
        if current > 0 && env.storage().persistent().get::<_, Address>(&token_key) != Some(token.clone()) {
            panic_with_error!(&env, Error::InvalidAsset);
        }

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&wallet, &env.current_contract_address(), &amount);

        env.storage().persistent().set(&key, &(current + amount));
        env.storage().persistent().set(&token_key, &token);

        FundEvent { device_hash, amount }.publish(&env);
    }

    pub fn authorize(
        env: Env,
        agent: Address,
        device_hash: BytesN<32>,
        merchant: Address,
        asset: Address,
        amount: i128,
        nonce: u64,
    ) {
        agent.require_auth();

        // Replay protection: each (device, agent) pair carries a monotonically
        // increasing nonce. A replayed or stale request is rejected.
        let nonce_key = DataKey::AuthNonce((device_hash.clone(), agent.clone()));
        let last_nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0);
        if nonce <= last_nonce {
            panic_with_error!(&env, Error::DuplicateAuth);
        }
        env.storage().persistent().set(&nonce_key, &nonce);

        if merchant == env.current_contract_address() {
            panic_with_error!(&env, Error::InvalidRecipient);
        }

        // A revoked (or never registered) device cannot pay, even if an agent
        // policy for it is still on file.
        let owner = Self::device_owner(&env, &device_hash)
            .unwrap_or_else(|| panic_with_error!(&env, Error::DeviceNotRegistered));

        let agent_registry_id: Address = env
            .storage()
            .persistent()
            .get(&DataKey::AgentRegistry)
            .unwrap_or_else(|| panic_with_error!(&env, Error::AgentNotAuthorized));

        // Enforce the FULL constrained-authorization policy in one call: the
        // agent must match, the asset must be the approved one, the amount must
        // be positive and within the cap, and the authorization must not have
        // expired. The agent_registry owns these rules; the escrow only asks.
        let reg = agent_registry::Client::new(&env, &agent_registry_id);
        if !reg.check_payment(&device_hash, &agent, &asset, &amount) {
            panic_with_error!(&env, Error::AgentNotAuthorized);
        }
        // The policy must have been granted by the device's current owner. A
        // policy left over from a previous owner of the tag cannot spend the
        // new owner's escrow.
        if reg.get_policy(&device_hash).owner != owner {
            panic_with_error!(&env, Error::AgentNotAuthorized);
        }
        Self::require_escrow_token(&env, &device_hash, &asset);

        let balance_key = DataKey::EscrowBalance(device_hash.clone());
        let balance = env
            .storage()
            .persistent()
            .get::<_, i128>(&balance_key)
            .unwrap_or(0);
        if balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        env.storage()
            .persistent()
            .set(&balance_key, &(balance - amount));

        let idx_key = DataKey::PendingIndex(merchant.clone());
        let mut idx: u32 = env
            .storage()
            .persistent()
            .get(&idx_key)
            .unwrap_or(0);
        idx += 1;
        env.storage().persistent().set(&idx_key, &idx);

        let payment = Payment {
            device_hash: device_hash.clone(),
            asset,
            amount,
            timestamp: env.ledger().timestamp(),
        };
        // Persistent, not temporary: an unclaimed payment has already left the
        // device balance, so letting it expire would strand the funds.
        env.storage()
            .persistent()
            .set(&DataKey::PendingPayment((merchant.clone(), idx)), &payment);

        AuthorizeEvent {
            device_hash,
            merchant,
            amount,
        }
        .publish(&env);
    }

    pub fn claim(env: Env, token: Address, merchant: Address) {
        merchant.require_auth();

        let idx_key = DataKey::PendingIndex(merchant.clone());
        let max_idx: u32 = env
            .storage()
            .persistent()
            .get(&idx_key)
            .unwrap_or(0);

        // Only payments made in `token` are paid out; any in another token
        // stay pending for a claim in that token.
        let mut total: i128 = 0;
        let mut claimed_indices: Vec<u32> = Vec::new(&env);
        let mut remaining = false;

        for i in 1..=max_idx {
            let payment_key = DataKey::PendingPayment((merchant.clone(), i));
            if let Some(payment) = env
                .storage()
                .persistent()
                .get::<_, Payment>(&payment_key)
            {
                if payment.asset == token {
                    total += payment.amount;
                    claimed_indices.push_back(i);
                } else {
                    remaining = true;
                }
            }
        }

        if total == 0 {
            panic_with_error!(&env, Error::NothingToClaim);
        }

        for idx in claimed_indices.iter() {
            let key = DataKey::PendingPayment((merchant.clone(), idx));
            env.storage().persistent().remove(&key);
        }

        if !remaining {
            env.storage().persistent().set(&idx_key, &0u32);
        }

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(
            &env.current_contract_address(),
            &merchant,
            &total,
        );

        ClaimEvent { merchant, total }.publish(&env);
    }

    pub fn defund_escrow(
        env: Env,
        token: Address,
        device_hash: BytesN<32>,
        amount: i128,
    ) {
        let device_registry_id: Address = env
            .storage()
            .persistent()
            .get(&DataKey::DeviceRegistry)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotDeviceOwner));

        let reg = device_registry::Client::new(&env, &device_registry_id);
        let owner = reg.get_owner(&device_hash);
        owner.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        Self::require_escrow_token(&env, &device_hash, &token);

        let balance_key = DataKey::EscrowBalance(device_hash.clone());
        let balance = env
            .storage()
            .persistent()
            .get::<_, i128>(&balance_key)
            .unwrap_or(0);
        if balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        env.storage()
            .persistent()
            .set(&balance_key, &(balance - amount));

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(
            &env.current_contract_address(),
            &owner,
            &amount,
        );

        DefundEvent { device_hash, amount }.publish(&env);
    }

    /// Return a device's ENTIRE remaining escrow balance to its owner once the
    /// agent authorization has been revoked.
    ///
    /// This is the on-revoke sweep: after the wallet owner calls
    /// `agent_registry.revoke_agent`, the device has no authorized agent and
    /// its escrow should no longer sit locked. This method confirms there is no
    /// longer an active authorization for `agent` on the device, then transfers
    /// the whole balance back to the owner (resolved from `device_registry`).
    ///
    /// Guarded so it cannot be used to pull funds while an agent is still live:
    /// if the agent is still authorized, it panics `AgentStillActive`.
    pub fn sweep_on_revoke(
        env: Env,
        token: Address,
        device_hash: BytesN<32>,
        agent: Address,
    ) -> i128 {
        let device_registry_id: Address = env
            .storage()
            .persistent()
            .get(&DataKey::DeviceRegistry)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotDeviceOwner));

        let dev_reg = device_registry::Client::new(&env, &device_registry_id);
        let owner = dev_reg.get_owner(&device_hash);
        owner.require_auth();

        // The sweep is only valid after revocation. If the agent is still
        // authorized in the agent_registry, refuse — otherwise this would be a
        // way to drain an active escrow out from under a working agent.
        let agent_registry_id: Address = env
            .storage()
            .persistent()
            .get(&DataKey::AgentRegistry)
            .unwrap_or_else(|| panic_with_error!(&env, Error::AgentNotAuthorized));
        let agent_reg = agent_registry::Client::new(&env, &agent_registry_id);
        if agent_reg.is_auth(&device_hash, &agent) {
            panic_with_error!(&env, Error::AgentStillActive);
        }

        let balance_key = DataKey::EscrowBalance(device_hash.clone());
        let balance = env
            .storage()
            .persistent()
            .get::<_, i128>(&balance_key)
            .unwrap_or(0);

        if balance <= 0 {
            return 0;
        }
        Self::require_escrow_token(&env, &device_hash, &token);

        env.storage().persistent().set(&balance_key, &0i128);

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(
            &env.current_contract_address(),
            &owner,
            &balance,
        );

        SweepEvent { device_hash, balance }.publish(&env);

        balance
    }

    /// Token the device's escrow is held in, if it was ever funded.
    pub fn escrow_token(env: Env, device_hash: BytesN<32>) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::EscrowToken(device_hash))
    }

    pub fn balance_of(env: Env, device_hash: BytesN<32>) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::EscrowBalance(device_hash))
            .unwrap_or(0)
    }

    pub fn pending_balance(env: Env, merchant: Address) -> i128 {
        let idx_key = DataKey::PendingIndex(merchant.clone());
        let max_idx: u32 = env
            .storage()
            .persistent()
            .get(&idx_key)
            .unwrap_or(0);

        let mut total: i128 = 0;
        for i in 1..=max_idx {
            let payment_key = DataKey::PendingPayment((merchant.clone(), i));
            if let Some(payment) = env
                .storage()
                .persistent()
                .get::<_, Payment>(&payment_key)
            {
                total += payment.amount;
            }
        }
        total
    }
}

impl PaymentEscrow {
    /// Owner of `device_hash` in device_registry, or None if it is not registered.
    fn device_owner(env: &Env, device_hash: &BytesN<32>) -> Option<Address> {
        let device_registry_id: Address = env
            .storage()
            .persistent()
            .get(&DataKey::DeviceRegistry)
            .unwrap_or_else(|| panic_with_error!(env, Error::DeviceNotRegistered));
        match device_registry::Client::new(env, &device_registry_id).try_get_owner(device_hash) {
            Ok(Ok(owner)) => Some(owner),
            _ => None,
        }
    }

    /// Panic `InvalidAsset` unless `token` is the token the device's escrow is held in.
    fn require_escrow_token(env: &Env, device_hash: &BytesN<32>, token: &Address) {
        let held: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowToken(device_hash.clone()));
        if held.as_ref() != Some(token) {
            panic_with_error!(env, Error::InvalidAsset);
        }
    }
}
