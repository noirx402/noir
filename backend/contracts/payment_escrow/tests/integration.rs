#[cfg(test)]
mod tests {
    use payment_escrow::{
        agent_registry, device_registry, PaymentEscrow, PaymentEscrowClient,
    };
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::{token, Address, BytesN, Env};

    fn random_address(env: &Env) -> Address {
        <Address as soroban_sdk::testutils::Address>::generate(env)
    }

    fn random_bytes_32(env: &Env) -> BytesN<32> {
        <BytesN<32> as soroban_sdk::testutils::BytesN<32>>::random(env)
    }

    fn deploy_agent_registry(env: &Env, admin: &Address, device_registry_id: &Address) -> Address {
        let id = env.register(agent_registry::WASM, ());
        agent_registry::Client::new(env, &id).initialize(admin, device_registry_id);
        id
    }

    fn deploy_device_registry(env: &Env, admin: &Address) -> Address {
        let id = env.register(device_registry::WASM, ());
        device_registry::Client::new(env, &id).initialize(admin);
        id
    }

    fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>) {
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_client = token::StellarAssetClient::new(env, &sac.address());
        (sac.address(), sac_client)
    }

    /// Full wiring: device_registry, agent_registry, token, escrow, a registered
    /// device + an authorized agent policy, and a funded escrow.
    struct Fixture<'a> {
        escrow: PaymentEscrowClient<'a>,
        token_id: Address,
        sac: token::StellarAssetClient<'a>,
        agent_registry_id: Address,
        device_registry_id: Address,
        wallet: Address,
        agent: Address,
        device_hash: BytesN<32>,
    }

    fn setup(env: &Env, max_amount: i128, expires_at: u64) -> Fixture<'_> {
        let admin = random_address(env);
        let wallet = random_address(env);
        let agent = random_address(env);
        let device_hash = random_bytes_32(env);

        let device_registry_id = deploy_device_registry(env, &admin);
        let agent_registry_id = deploy_agent_registry(env, &admin, &device_registry_id);
        let (token_id, sac) = create_token(env, &admin);

        // Register the device so device_registry.get_owner resolves to the wallet.
        device_registry::Client::new(env, &device_registry_id)
            .register(&wallet, &device_hash, &agent);

        // Authorize the agent under a constrained policy bound to the token.
        agent_registry::Client::new(env, &agent_registry_id)
            .register_agent(&wallet, &device_hash, &agent, &max_amount, &token_id, &expires_at);

        let escrow_id = env.register(PaymentEscrow, ());
        let escrow = PaymentEscrowClient::new(env, &escrow_id);
        escrow.initialize(&admin, &agent_registry_id, &device_registry_id);

        sac.mint(&wallet, &10_000);

        Fixture {
            escrow,
            token_id,
            sac,
            agent_registry_id,
            device_registry_id,
            wallet,
            agent,
            device_hash,
        }
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_initialize_double_init_guard() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow
            .initialize(&random_address(&env), &f.agent_registry_id, &f.agent_registry_id);
    }

    #[test]
    fn test_balance_of_unfunded_is_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        // Never funded -> defaults to 0, no panic.
        assert_eq!(f.escrow.balance_of(&f.device_hash), 0);
        assert_eq!(f.escrow.balance_of(&random_bytes_32(&env)), 0);
    }

    #[test]
    fn test_fund_escrow_increases_balance() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        assert_eq!(f.escrow.balance_of(&f.device_hash), 500);
    }

    #[test]
    fn test_authorize_in_policy_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &200, &1);

        assert_eq!(f.escrow.balance_of(&f.device_hash), 300);
        assert_eq!(f.escrow.pending_balance(&merchant), 200);
    }

    #[test]
    fn test_claim_payments() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &200, &1);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &150, &2);

        f.escrow.claim(&f.token_id, &merchant);
        assert_eq!(f.sac.balance(&merchant), 350);
        assert_eq!(f.escrow.pending_balance(&merchant), 0);
    }

    #[test]
    fn test_defund_escrow_returns_funds() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow.defund_escrow(&f.token_id, &f.device_hash, &200);
        assert_eq!(f.escrow.balance_of(&f.device_hash), 300);
    }

    // ---------------- Negative paths (SOW security validation) ----------------

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_unauthorized_agent_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let stranger = random_address(&env);
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&stranger, &f.device_hash, &merchant, &f.token_id, &200, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_over_limit_payment_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0); // cap = 1000
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &5000);
        // 1001 exceeds the policy cap of 1000 -> AgentNotAuthorized.
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &1001, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_wrong_asset_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);
        let (other_token, _) = create_token(&env, &f.wallet);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        // Policy is bound to f.token_id; paying with other_token is rejected.
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &other_token, &200, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_expired_authorization_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let f = setup(&env, 1000, 2000); // expires at 2000
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        env.ledger().set_timestamp(2001); // past expiry
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &200, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_replayed_nonce_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &100, &1);
        // Reusing nonce 1 (<= last) is a replay -> DuplicateAuth.
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &100, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_fund_unregistered_device_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        // Funds for a hash device_registry does not know could never be
        // withdrawn or swept (both resolve the owner there) — refuse them.
        f.escrow
            .fund_escrow(&f.token_id, &f.wallet, &random_bytes_32(&env), &500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_insufficient_balance_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &100);
        // In-policy (<=1000) but escrow only has 100.
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &200, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_claim_nothing_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);
        f.escrow.claim(&f.token_id, &merchant);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_revoked_agent_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        // Revoke the agent; a subsequent authorize must be rejected.
        agent_registry::Client::new(&env, &f.agent_registry_id)
            .revoke_agent(&f.wallet, &f.device_hash);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &100, &1);
    }

    // ---------------- Sweep on revoke ----------------

    #[test]
    fn test_sweep_on_revoke_returns_all_funds_to_owner() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &700);
        let owner_before = f.sac.balance(&f.wallet);

        // Owner revokes the agent, then sweeps the escrow back to themselves.
        agent_registry::Client::new(&env, &f.agent_registry_id)
            .revoke_agent(&f.wallet, &f.device_hash);
        let swept = f.escrow.sweep_on_revoke(&f.token_id, &f.device_hash, &f.agent);

        assert_eq!(swept, 700);
        assert_eq!(f.escrow.balance_of(&f.device_hash), 0);
        assert_eq!(f.sac.balance(&f.wallet), owner_before + 700);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_sweep_rejected_while_agent_active() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);

        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &700);
        // Agent is still authorized -> sweep must be refused (AgentStillActive).
        f.escrow.sweep_on_revoke(&f.token_id, &f.device_hash, &f.agent);
    }

    #[test]
    fn test_sweep_on_empty_escrow_is_noop() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);

        agent_registry::Client::new(&env, &f.agent_registry_id)
            .revoke_agent(&f.wallet, &f.device_hash);
        let swept = f.escrow.sweep_on_revoke(&f.token_id, &f.device_hash, &f.agent);
        assert_eq!(swept, 0);
    }

    // ---------------- Exploit regressions (Week 4 audit) ----------------

    /// An attacker funds their own device with a worthless token, then tries
    /// to withdraw the same amount in the real token. Balances are bound to
    /// the funding token, so this is refused (InvalidAsset).
    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_cross_asset_defund_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        // Victim deposit sitting in the escrow.
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &5000);

        let device_registry_id = f.device_registry_id.clone();
        let attacker = random_address(&env);
        let attacker_device = random_bytes_32(&env);
        device_registry::Client::new(&env, &device_registry_id)
            .register(&attacker, &attacker_device, &random_address(&env));
        let (junk, junk_sac) = create_token(&env, &attacker);
        junk_sac.mint(&attacker, &5000);
        f.escrow.fund_escrow(&junk, &attacker, &attacker_device, &5000);

        f.escrow.defund_escrow(&f.token_id, &attacker_device, &5000);
    }

    /// Same trick through sweep_on_revoke.
    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_cross_asset_sweep_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &700);
        let (junk, _) = create_token(&env, &f.wallet);
        agent_registry::Client::new(&env, &f.agent_registry_id)
            .revoke_agent(&f.wallet, &f.device_hash);
        f.escrow.sweep_on_revoke(&junk, &f.device_hash, &f.agent);
    }

    /// Topping up a funded escrow with a different token is refused.
    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_fund_with_second_asset_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        let (other, other_sac) = create_token(&env, &f.wallet);
        other_sac.mint(&f.wallet, &500);
        f.escrow.fund_escrow(&other, &f.wallet, &f.device_hash, &500);
    }

    /// A merchant claiming in a token the payments were not made in gets
    /// nothing (and the real-token payments stay claimable).
    #[test]
    fn test_claim_only_pays_the_payment_asset() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &200, &1);

        let (junk, junk_sac) = create_token(&env, &merchant);
        assert!(f.escrow.try_claim(&junk, &merchant).is_err());
        assert_eq!(junk_sac.balance(&merchant), 0);

        f.escrow.claim(&f.token_id, &merchant);
        assert_eq!(f.sac.balance(&merchant), 200);
    }

    /// A stranger cannot revoke the owner's agent and install their own to
    /// spend the owner's escrow.
    #[test]
    fn test_agent_hijack_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);

        let reg = agent_registry::Client::new(&env, &f.agent_registry_id);
        let attacker = random_address(&env);
        assert!(reg.try_revoke_agent(&attacker, &f.device_hash).is_err());
        assert!(reg
            .try_register_agent(&attacker, &f.device_hash, &attacker, &0, &f.token_id, &0)
            .is_err());
        assert!(f
            .escrow
            .try_authorize(&attacker, &f.device_hash, &attacker, &f.token_id, &500, &1)
            .is_err());
        assert_eq!(f.escrow.balance_of(&f.device_hash), 500);
    }

    /// Revoking the device directly (without revoking the agent) still stops
    /// the agent from paying (DeviceNotRegistered).
    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_revoked_device_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        device_registry::Client::new(&env, &f.device_registry_id)
            .revoke(&f.wallet, &f.device_hash);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &100, &1);
    }

    /// The tag moves to a new owner after a direct device revoke. The previous
    /// owner's agent policy is stale and must not spend the new owner's escrow.
    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_stale_policy_after_ownership_change_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let devices = device_registry::Client::new(&env, &f.device_registry_id);
        devices.revoke(&f.wallet, &f.device_hash);

        let new_owner = random_address(&env);
        devices.register(&new_owner, &f.device_hash, &random_address(&env));
        f.sac.mint(&new_owner, &500);
        f.escrow.fund_escrow(&f.token_id, &new_owner, &f.device_hash, &500);

        // Old owner's agent tries to spend the new owner's deposit.
        f.escrow
            .authorize(&f.agent, &f.device_hash, &f.agent, &f.token_id, &100, &1);
    }

    /// Paying the escrow contract itself would lock the funds forever.
    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn test_escrow_as_merchant_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &f.escrow.address, &f.token_id, &100, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_nonpositive_fund_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_negative_defund_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow.defund_escrow(&f.token_id, &f.device_hash, &-100);
    }

    /// Pending payments live in persistent storage, so a merchant who claims
    /// late (past the temporary-entry TTL) still gets paid.
    #[test]
    fn test_late_claim_still_pays() {
        let env = Env::default();
        env.mock_all_auths();
        let f = setup(&env, 1000, 0);
        let merchant = random_address(&env);
        f.escrow.fund_escrow(&f.token_id, &f.wallet, &f.device_hash, &500);
        f.escrow
            .authorize(&f.agent, &f.device_hash, &merchant, &f.token_id, &200, &1);

        // Well past the default temporary-entry TTL, inside the persistent one.
        let seq = env.ledger().sequence();
        env.ledger().set_sequence_number(seq + 1_000);
        assert_eq!(f.escrow.pending_balance(&merchant), 200);
        f.escrow.claim(&f.token_id, &merchant);
        assert_eq!(f.sac.balance(&merchant), 200);
    }
}
