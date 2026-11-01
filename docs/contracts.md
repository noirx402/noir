# Smart Contract Reference

The three Soroban contracts in [`backend/contracts/`](../backend/contracts/). This page is the public interface reference: every function, argument, error code, event and storage key, taken from the Rust source. If this page and the source ever disagree, the source wins.

| Contract | Source | Tests | Testnet ID (2026-10-07 deploy) |
|----------|--------|-------|--------------------------------|
| `device_registry` | [`device_registry/src/lib.rs`](../backend/contracts/device_registry/src/lib.rs) | 10 | [`CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5`](https://stellar.expert/explorer/testnet/contract/CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5) |
| `agent_registry` | [`agent_registry/src/lib.rs`](../backend/contracts/agent_registry/src/lib.rs) | 21 | [`CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV`](https://stellar.expert/explorer/testnet/contract/CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV) |
| `payment_escrow` | [`payment_escrow/src/lib.rs`](../backend/contracts/payment_escrow/src/lib.rs) | 29 | [`CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS`](https://stellar.expert/explorer/testnet/contract/CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS) |

WASM hashes and deploy transactions: [`deploy-evidence/deploy-testnet-20261024T131024Z.md`](../deploy-evidence/deploy-testnet-20261024T131024Z.md).

> [!WARNING]
> **Live Testnet runs the Week 4 code.** The security fixes (2026-10-21, see [Security fixes](#week-4-security-fixes)) were redeployed on 2026-10-24 ([deploy record](../deploy-evidence/deploy-testnet-20261024T131024Z.md)) and the live [security matrix passed](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) against these IDs. `agent_registry.initialize` now takes `(admin, device_registry_id)`. The 2026-10-07 IDs are retired: they run the pre-fix code and the matrix refuses them.

## Conventions

- **`device_hash: BytesN<32>`** is `SHA-256(tag UID string)`, computed off-chain (see [NFC hardware](nfc-hardware.md#how-a-tag-becomes-a-device_hash)). The raw UID never goes on-chain.
- **Amounts are `i128` in stroops** of the token contract (1 XLM = 10,000,000 stroops). Token arguments are Stellar Asset Contract (SAC) addresses; for native XLM on Testnet use `stellar contract id asset --asset native --network testnet`.
- **Auth.** Every state-changing call starts with `require_auth()` on the party whose consent it needs. The app never enforces authorization on its own.
- **Errors** reach clients as `Error(Contract, #N)`. The app maps them to user-facing text in [`frontend/src/domain/contractErrors.ts`](../frontend/src/domain/contractErrors.ts).
- **Storage.** All state is `persistent`. Pending merchant payments used to be `temporary` and could expire unclaimed; they are persistent since the Week 4 fixes.

---

## device_registry

Maps a hashed NFC device to its owner wallet and agent, and keeps a dense per-wallet index of devices.

### Types

```rust
pub struct DeviceInfo {
    pub owner: Address,
    pub agent: Address,
    pub status: u32,      // 0 = active
    pub created_at: u64,  // ledger timestamp at registration
}

enum DataKey { Admin, WalletDeviceCount(Address), WalletDeviceByIndex(Address, u32), Device(BytesN<32>) }
```

### Functions

| Function | Auth | Behaviour | Errors |
|----------|------|-----------|--------|
| `initialize(admin: Address)` | `admin` | Stores the admin once. | `AlreadyInitialized` |
| `register(wallet: Address, device_hash: BytesN<32>, agent: Address)` | `wallet` | Records `DeviceInfo { owner: wallet, agent, status: 0 }` and appends the hash to the wallet's index. Emits `register`. | `AlreadyRegistered` |
| `revoke(wallet: Address, device_hash: BytesN<32>)` | `wallet` | Deletes the device entry and compacts the wallet index, so the tag can be registered again. Emits `revoke`. | `DeviceNotFound`, `NotOwner` |
| `get_device(device_hash) -> DeviceInfo` | — | Read the full record. | `DeviceNotFound` |
| `get_owner(device_hash) -> Address` | — | Owner wallet. Used by `payment_escrow` for defund, sweep and the fund check. | `DeviceNotFound` |
| `get_agent(device_hash) -> Address` | — | Agent recorded at registration. | `DeviceNotFound` |
| `is_authorized(device_hash, agent) -> bool` | — | `true` if `agent` matches and `status == 0`; `false` for unknown devices. | — |
| `wallet_device_count(wallet) -> u32` | — | Number of devices owned by `wallet`. | — |
| `wallet_device_at(wallet, index: u32) -> BytesN<32>` | — | Device hash at `index` (0-based). | `DeviceNotFound` |

### Errors

| Code | Name | When |
|------|------|------|
| 1 | `AlreadyInitialized` | `initialize` called twice |
| 2 | `DeviceNotFound` | Unknown `device_hash` |
| 3 | `NotOwner` | `revoke` by a wallet that does not own the device |
| 4 | `AlreadyRegistered` | `register` for a hash that already exists (duplicate registration) |

### Events

| Topics | Data |
|--------|------|
| `("register", device_hash)` | `agent: Address` |
| `("revoke", device_hash)` | — |

---

## agent_registry

Holds the **constrained delegated-payment policy** for each device. `check_payment` is the single predicate `payment_escrow` trusts.

### Types

```rust
pub struct AgentPolicy {
    pub owner: Address,     // wallet that granted it (device owner at registration)
    pub agent: Address,     // the authorized signing key
    pub max_amount: i128,   // per-payment cap; 0 = uncapped
    pub asset: Address,     // the only token the agent may spend
    pub expires_at: u64,    // absolute ledger timestamp; 0 = never expires
}

enum DataKey { Admin, DeviceRegistry, AgentMap(BytesN<32>) }
```

### Functions

| Function | Auth | Behaviour | Errors |
|----------|------|-----------|--------|
| `initialize(admin: Address, device_registry_id: Address)` | `admin` | Stores the admin and the device registry it checks ownership against, once. | `AlreadyInitialized` |
| `register_agent(wallet, device_hash, agent, max_amount: i128, asset: Address, expires_at: u64)` | `wallet` | `wallet` must own `device_hash` in `device_registry`. Stores the policy with `owner = wallet`. Rejects `max_amount < 0` and a non-zero `expires_at` that is not in the future. A policy left by a previous owner of the tag is replaced; one from `wallet` itself is `AlreadyRegistered`. Emits `agent_reg`. | `InvalidPolicy`, `NotOwner`, `AlreadyRegistered` |
| `revoke_agent(wallet, device_hash)` | `wallet` | `wallet` must be the policy's `owner`. Deletes the policy. After this, `is_auth` and `check_payment` return `false`. Works after the device itself is revoked. Emits `agent_rev`. | `AgentNotFound`, `NotOwner` |
| `get_policy(device_hash) -> AgentPolicy` | — | Read the full policy. | `AgentNotFound` |
| `get_agent(device_hash) -> Address` | — | `get_policy(..).agent`. | `AgentNotFound` |
| `is_auth(device_hash, agent) -> bool` | — | `agent` matches **and** not expired. | — |
| `check_payment(device_hash, agent, asset, amount: i128) -> bool` | — | `agent` matches **and** `asset` matches **and** `amount > 0` **and** (`max_amount == 0` or `amount <= max_amount`) **and** not expired. | — |

Expiry: a policy is expired when `expires_at != 0 && ledger.timestamp() > expires_at`.

### Errors

| Code | Name | When |
|------|------|------|
| 1 | `AlreadyInitialized` | `initialize` called twice |
| 2 | `AgentNotFound` | No policy for `device_hash` |
| 3 | `AlreadyRegistered` | A policy already exists for `device_hash` (revoke first) |
| 4 | `InvalidPolicy` | Negative `max_amount`, or `expires_at` already in the past |
| 5 | `NotOwner` | `register_agent` by a wallet that does not own the device, or `revoke_agent` by a wallet that did not grant the policy |

### Events

| Topics | Data |
|--------|------|
| `("agent_reg", device_hash)` | `agent: Address` |
| `("agent_rev", device_hash)` | — |

---

## payment_escrow

Holds a pre-funded balance per device, authorizes in-policy payments with nonce replay protection, batch-settles to merchants, and returns funds to the owner. It calls the other two contracts through `contractimport!`, so they must be built first ([build order](deployment.md#1-build)).

### Types

```rust
pub struct Payment { pub device_hash: BytesN<32>, pub asset: Address, pub amount: i128, pub timestamp: u64 }

enum DataKey {
    Admin, AgentRegistry, DeviceRegistry,
    EscrowBalance(BytesN<32>),               // persistent
    EscrowToken(BytesN<32>),                 // persistent, token the balance is held in
    PendingIndex(Address),                   // persistent, per merchant
    PendingPayment((Address, u32)),          // persistent, per merchant + index
    AuthNonce((BytesN<32>, Address)),        // persistent, per device + agent
}
```

### Functions

| Function | Auth | Behaviour | Errors |
|----------|------|-----------|--------|
| `initialize(admin, agent_registry_id: Address, device_registry_id: Address)` | `admin` | Stores the admin and both registry IDs once. | `AlreadyInitialized` |
| `fund_escrow(token, wallet, device_hash, amount: i128)` | `wallet` | `amount > 0`; `device_registry.get_owner(device_hash)` must succeed; a funded escrow only takes more of the token it already holds. Transfers `amount` from `wallet` into the contract, credits the device balance, records the token. Emits `fund`. | `InvalidAmount`, `DeviceNotRegistered`, `InvalidAsset` |
| `authorize(agent, device_hash, merchant, asset, amount: i128, nonce: u64)` | `agent` | 1. `nonce > last_nonce(device, agent)` or `DuplicateAuth`; stores the nonce. 2. `merchant` is not the escrow contract or `InvalidRecipient`. 3. Device registered or `DeviceNotRegistered`. 4. `agent_registry.check_payment(...)` and the policy's `owner` is the device's current owner, or `AgentNotAuthorized`. 5. `asset` is the escrow's token or `InvalidAsset`. 6. Balance `>= amount` or `InsufficientBalance`. Deducts the balance and records a pending `Payment` (with its asset) for `merchant`. Emits `authorize`. | `DuplicateAuth`, `InvalidRecipient`, `DeviceNotRegistered`, `AgentNotAuthorized`, `InvalidAsset`, `InsufficientBalance` |
| `claim(token, merchant)` | `merchant` | Sums the pending payments for `merchant` made in `token`, clears them, and transfers the total in one token transfer. Payments in another token stay pending. Emits `claim`. | `NothingToClaim` |
| `defund_escrow(token, device_hash, amount: i128)` | device owner | Owner (resolved from `device_registry`) withdraws part of the balance, in the escrow's token. Emits `defund`. | `InvalidAmount`, `InvalidAsset`, `InsufficientBalance` |
| `sweep_on_revoke(token, device_hash, agent) -> i128` | device owner | Refuses while `agent_registry.is_auth(device_hash, agent)` is true. Otherwise transfers the **entire** balance (in the escrow's token) to the owner and returns it; returns `0` on an empty escrow. Emits `sweep` when it moves funds. | `AgentStillActive`, `InvalidAsset` |
| `escrow_token(device_hash) -> Option<Address>` | — | Token the device's escrow is held in, if it was ever funded. | — |
| `balance_of(device_hash) -> i128` | — | Current escrow balance. | — |
| `pending_balance(merchant) -> i128` | — | Sum of pending, unclaimed payments for `merchant`. | — |

### Errors

| Code | Name | When |
|------|------|------|
| 1 | `AlreadyInitialized` | `initialize` called twice |
| 2 | `InsufficientBalance` | `authorize` or `defund_escrow` for more than the device balance |
| 3 | `AgentNotAuthorized` | `check_payment` failed: wrong or revoked agent, wrong asset, `amount <= 0`, over the cap, or expired |
| 4 | `NotDeviceOwner` | Registry ID missing (contract not initialized) |
| 5 | `NothingToClaim` | `claim` with no pending payments |
| 6 | `DuplicateAuth` | `authorize` nonce not strictly greater than the last one (replay) |
| 7 | `AgentStillActive` | `sweep_on_revoke` while the agent is still authorized |
| 8 | `DeviceNotRegistered` | `fund_escrow` or `authorize` for a device `device_registry` does not know (never registered or revoked) |
| 9 | `InvalidAsset` | Token differs from the one the device's escrow is held in |
| 10 | `InvalidRecipient` | `authorize` with the escrow contract as `merchant` |
| 11 | `InvalidAmount` | `fund_escrow` / `defund_escrow` with `amount <= 0` |

### Events

| Topics | Data |
|--------|------|
| `("fund", device_hash)` | `amount: i128` |
| `("authorize", device_hash, merchant)` | `amount: i128` |
| `("claim", merchant)` | `total: i128` |
| `("defund", device_hash)` | `amount: i128` |
| `("sweep", device_hash)` | `balance: i128` |

---

## Call order

```
device_registry.register          (owner signs)
agent_registry.register_agent     (owner signs; sets cap / asset / expiry)
payment_escrow.fund_escrow        (owner signs)
  ── tap ──
payment_escrow.authorize          (agent signs; nonce + policy + balance)
payment_escrow.claim              (merchant signs; batch settlement)

Unlink safely:
agent_registry.revoke_agent → payment_escrow.sweep_on_revoke → device_registry.revoke
```

## Week 4 security fixes

Found in the 2026-10-21 audit, fixed in source, each with a regression test that failed before the fix. **Live on Testnet only after the next redeploy.**

| Bug on the 2026-10-07 deploy | Impact | Fix | Regression tests |
|------------------------------|--------|-----|------------------|
| Escrow balances were not tied to a token | **Critical.** Fund your own device with a token you issue, then `defund_escrow` / `sweep_on_revoke` the same amount in XLM: drains everyone's escrow | Balance bound to its token (`EscrowToken`); every movement must use it (`InvalidAsset`); payments carry their asset and `claim` pays only that asset | `test_cross_asset_defund_rejected`, `test_cross_asset_sweep_rejected`, `test_fund_with_second_asset_rejected`, `test_claim_only_pays_the_payment_asset` |
| `register_agent` / `revoke_agent` did not check device ownership | **Critical.** A stranger revokes the owner's agent, registers their own and `authorize`s the owner's escrow to themselves | `agent_registry` checks ownership in `device_registry` (`NotOwner`); escrow refuses a policy whose `owner` is not the device's current owner | `test_agent_hijack_rejected`, `test_register_for_someone_elses_device_rejected`, `test_revoke_by_stranger_rejected`, `test_stale_policy_after_ownership_change_rejected` |
| `authorize` never consulted `device_registry` | A revoked device could still pay while its agent policy was on file | `authorize` requires a registered device (`DeviceNotRegistered`) | `test_revoked_device_rejected` |
| Pending payments in `temporary` storage | An unclaimed payment expired with its funds already debited: stranded in the contract | Persistent storage | `test_late_claim_still_pays` |
| No recipient / amount checks | Paying the escrow itself locks funds; zero or negative amounts reached the token | `InvalidRecipient`, `InvalidAmount` | `test_escrow_as_merchant_rejected`, `test_nonpositive_fund_rejected`, `test_negative_defund_rejected` |

What the policy still does **not** restrict: which merchant an agent pays. Any address other than the escrow itself is accepted; the agent key is trusted to choose the merchant within its cap. A merchant allow-list in `AgentPolicy` is the natural extension.

> [!WARNING]
> Never call `device_registry.revoke` while the escrow balance is above zero. `defund_escrow` and `sweep_on_revoke` resolve the owner through `device_registry`, so revoking the device first strands the funds. The app's `x402.unlinkDevice` runs the safe order shown above.

## Invoking with the Stellar CLI

```bash
# Read a policy (simulation only, no fee)
stellar contract invoke --id CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV \
  --source <identity> --network testnet --send=no -- \
  get_policy --device_hash <64-hex-char hash>

# Check whether a payment would pass (amount in stroops)
stellar contract invoke --id CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV \
  --source <identity> --network testnet --send=no -- \
  check_payment --device_hash <hash> --agent <G…> --asset <SAC C…> --amount 10000000

# Escrow balance
stellar contract invoke --id CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS \
  --source <identity> --network testnet --send=no -- \
  balance_of --device_hash <hash>
```

Related: [Architecture](architecture.md) · [API reference](api-reference.md) · [Testing](testing.md)
