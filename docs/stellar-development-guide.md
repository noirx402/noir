<div align="center">

<img src="../frontend/assets/noir-mark.png" width="96" alt="Noir logo">

# Stellar Development Guide

**Noir Wallet — Soroban contracts, SDK usage, deployment, and wallet integration**

</div>

> This guide documents the Stellar/Soroban layer of Noir Wallet: the three Soroban
> smart contracts, the `soroban-sdk` and `@stellar/stellar-sdk` components used,
> the on-chain authorization model, deployment to Stellar Testnet, the React
> Native wallet integration, and how everything is tested. For rendered flow
> diagrams see [`architecture.md`](architecture.md); for on-chain deployment
> proof see [`Evidence/README.md`](Evidence/README.md).

---

## Table of contents

1. [Overview](#1-overview)
2. [Technology stack](#2-technology-stack)
3. [Soroban smart contracts](#3-soroban-smart-contracts)
4. [Authorization model](#4-authorization-model)
5. [Contract events (`#[contractevent]`)](#5-contract-events-contractevent)
6. [Building the contracts](#6-building-the-contracts)
7. [Deployment to Testnet](#7-deployment-to-testnet)
8. [Deployed contract IDs](#8-deployed-contract-ids)
9. [Frontend wallet integration](#9-frontend-wallet-integration)
10. [Transaction lifecycle](#10-transaction-lifecycle)
11. [Testing](#11-testing)
12. [CI](#12-ci)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Overview

Noir Wallet implements the **x402** zero-interaction payment flow on Stellar: a
hardware tap (NFC/RFID) debits a pre-funded on-chain escrow instantly, with no
app unlock or confirmation. The on-chain trust model is enforced by three
Soroban contracts; the mobile app only orchestrates — it never substitutes for
on-chain authorization.

```
RFID / NFC tag
   │  SHA-256(UID) → device_hash
   ▼
Mobile app / POS terminal  ──(@stellar/stellar-sdk)──►  Soroban RPC
   │
   ├── device_registry   device_hash → { owner, agent }
   ├── agent_registry    device_hash → AgentPolicy { agent, cap, asset, expiry }
   └── payment_escrow     pre-fund → authorize (in-policy) → claim / sweep
                                   │
                                   ▼
                            Stellar Network (Testnet)
```

---

## 2. Technology stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Contracts | Rust + `soroban-sdk` | 25.3.1 |
| Build target | `wasm32v1-none` (Soroban target for SDK 25) | — |
| Toolchain | Rust (pinned for reproducible WASM) | 1.98.1 |
| Contract CLI | `stellar` / soroban CLI | — |
| Frontend | React Native (Expo), TypeScript | Expo 57 |
| Wallet SDK | `@stellar/stellar-sdk` | ^16.0.1 |
| RPC | Soroban RPC (`rpc.Server`) | — |
| Asset transfers | Stellar Asset Contract (SAC) via `token::Client` | — |

### `soroban-sdk` components used

`#[contract]`, `#[contractimpl]`, `#[contracttype]`, `#[contracterror]`,
`#[contractevent]`, `panic_with_error!`, `Address`, `BytesN<32>`, `Env`,
`env.storage().persistent()` / `.temporary()`, `env.ledger().timestamp()`,
`Address::require_auth()`, `soroban_sdk::token::Client`, and `contractimport!`
for cross-contract composition.

### `@stellar/stellar-sdk` components used

`rpc.Server`, `TransactionBuilder`, `Contract`, `Account`, `Address`, `Keypair`,
`xdr.ScVal`, `BASE_FEE`, `server.simulateTransaction`, `server.prepareTransaction`,
`server.sendTransaction`, `server.getTransaction`, `server.getAccount`.

---

## 3. Soroban smart contracts

All three live under `backend/contracts/`. `payment_escrow` composes the other
two at compile time via `contractimport!`, so **build order matters**:
`device_registry` + `agent_registry` first, then `payment_escrow`.

### 3.1 device_registry

Maps a hardware device hash to its owner wallet and authorized agent.

| Method | Args | Auth | Description |
|--------|------|------|-------------|
| `initialize` | `admin: Address` | `admin` | Set contract admin (once) |
| `register` | `wallet, device_hash: BytesN<32>, agent` | `wallet` | Register a device to a wallet with its agent |
| `revoke` | `wallet, device_hash` | `wallet` | Remove the device entry (owner only), freeing the hash |
| `get_device` | `device_hash` | — | `DeviceInfo { owner, agent, status, created_at }` |
| `wallet_device_count` | `wallet` | — | Devices a wallet has registered |
| `wallet_device_at` | `wallet, index: u32` | — | Enumerate a wallet's device hashes |
| `is_authorized` | `device_hash, agent` | — | `true` if device exists, active, maps to this agent |
| `get_agent` / `get_owner` | `device_hash` | — | Agent / owner for a device |

Errors: `AlreadyInitialized=1`, `DeviceNotFound=2`, `NotOwner=3`, `AlreadyRegistered=4`.

> `revoke` fully removes the entry (and compacts the per-wallet index) so the
> hash can be re-registered later — a soft status flag would block
> re-registration with `AlreadyRegistered`.

### 3.2 agent_registry

Holds the **constrained delegated-payment policy** per device.

```rust
pub struct AgentPolicy {
    pub agent: Address,     // authorized signing key
    pub max_amount: i128,   // per-payment cap; 0 = uncapped
    pub asset: Address,     // the only token the agent may spend
    pub expires_at: u64,    // absolute ledger timestamp; 0 = never expires
}
```

| Method | Args | Auth | Description |
|--------|------|------|-------------|
| `initialize` | `admin` | `admin` | Set admin (once) |
| `register_agent` | `wallet, device_hash, agent, max_amount: i128, asset, expires_at: u64` | `wallet` | Authorize an agent under a constrained policy |
| `revoke_agent` | `wallet, device_hash` | `wallet` | Revoke agent access |
| `get_agent` / `get_policy` | `device_hash` | — | Agent / full policy |
| `is_auth` | `device_hash, agent` | — | Agent matches and not expired |
| `check_payment` | `device_hash, agent, asset, amount` | — | Full policy predicate (agent + asset + `amount>0` + within cap + not expired) |

Errors: `AlreadyInitialized=1`, `AgentNotFound=2`, `AlreadyRegistered=3`, `InvalidPolicy=4`.

> `check_payment` is the single enforcement predicate — the policy rules live in
> one place so `payment_escrow` only asks, never re-implements them.

### 3.3 payment_escrow

Pre-funded escrow with instant in-policy authorization and batch settlement.

| Method | Args | Auth | Description |
|--------|------|------|-------------|
| `initialize` | `admin, agent_registry_id, device_registry_id` | `admin` | Set admin + link both registries |
| `fund_escrow` | `token, wallet, device_hash, amount` | `wallet` | Deposit into escrow for a device |
| `authorize` | `agent, device_hash, merchant, asset, amount, nonce: u64` | `agent` | Instant payment auth, enforced vs. policy, nonce replay-protected |
| `claim` | `token, merchant` | `merchant` | Batch-claim all pending payments |
| `defund_escrow` | `token, device_hash, amount` | device owner | Reclaim unused escrow |
| `sweep_on_revoke` | `token, device_hash, agent` | device owner | After revoke, return the whole balance to the owner |
| `balance_of` / `pending_balance` | `device_hash` / `merchant` | — | Escrow / unclaimed balances |

Errors: `AlreadyInitialized=1`, `InsufficientBalance=2`, `AgentNotAuthorized=3`, `NotDeviceOwner=4`, `NothingToClaim=5`, `DuplicateAuth=6`, `AgentStillActive=7`.

> **Replay protection:** each `(device_hash, agent)` pair tracks a monotonic
> nonce; `authorize` rejects any `nonce <= last_nonce` with `DuplicateAuth`.
>
> **Sweep guard:** `sweep_on_revoke` refuses with `AgentStillActive` if the
> agent is still authorized in `agent_registry` — funds can't be pulled out from
> under a live agent.

---

## 4. Authorization model

Every state-changing call carries an on-chain `require_auth()` on the consenting
party. **Authorization is never enforced by the app alone.**

| Action | Who must authorize | Enforced by |
|--------|--------------------|-------------|
| Register / revoke device | device owner wallet | `wallet.require_auth()` |
| Authorize / revoke agent | device owner wallet | `wallet.require_auth()` |
| Fund escrow | funding wallet | `wallet.require_auth()` |
| Authorize payment (tap) | the agent key | `agent.require_auth()` + `agent_registry.check_payment` |
| Claim | merchant | `merchant.require_auth()` |
| Defund / sweep | device owner (resolved via `device_registry.get_owner`) | `owner.require_auth()` |

A tap payment is thus gated twice: the agent must sign (`require_auth`), **and**
the payment must satisfy the full on-chain policy (`check_payment`): correct
agent, correct asset, positive amount, within the per-payment cap, not expired.

---

## 5. Contract events (`#[contractevent]`)

Events use the SDK 25 `#[contractevent]` macro (migrated away from the
deprecated `env.events().publish(...)`). Each is a typed struct; `#[topic]`
fields become indexable topics, the rest become data.

```rust
/// Topics: ("agent_reg", device_hash); data: agent
#[contractevent(topics = ["agent_reg"], data_format = "single-value")]
pub struct AgentRegEvent {
    #[topic]
    pub device_hash: BytesN<32>,
    pub agent: Address,
}

// published with:
AgentRegEvent { device_hash, agent }.publish(&env);
```

| Contract | Events |
|----------|--------|
| device_registry | `RegisterEvent`, `RevokeEvent` |
| agent_registry | `AgentRegEvent`, `AgentRevEvent` |
| payment_escrow | `FundEvent`, `AuthorizeEvent`, `ClaimEvent`, `DefundEvent`, `SweepEvent` |

---

## 6. Building the contracts

```bash
cd backend

# Build release WASM (dependency order matters for payment_escrow)
cargo build --release --target wasm32v1-none \
  -p device-registry -p agent-registry -p payment-escrow

# Host-target check (no_std WASM target can't run tests)
cargo check -p device-registry -p agent-registry -p payment-escrow
```

> `backend/.cargo/config.toml` resets the default build target to the host so
> plain `cargo test` works; the reproducible WASM build still uses the explicit
> `--target wasm32v1-none`.

---

## 7. Deployment to Testnet

Use the one-shot script, which builds, hashes, deploys, initializes, and writes
an evidence file:

```bash
# Default: testnet, identity "deployer"
./scripts/redeploy-contracts.sh

# Also patch frontend/.env with the new IDs
UPDATE_ENV=1 ./scripts/redeploy-contracts.sh
```

The script runs these real on-chain transactions, in order:

1. `stellar contract deploy` × 3 → **create-from-WASM** (new contract IDs)
2. `device_registry.initialize(admin)`
3. `agent_registry.initialize(admin, device_registry_id)` — ownership checks go to device_registry
4. `payment_escrow.initialize(admin, agent_registry_id, device_registry_id)` — links all three on-chain

> **Each redeploy is a clean slate**, not an in-place upgrade: every run mints
> **new contract IDs**, and prior on-chain state on the old instances is
> abandoned. The authoritative record (IDs, WASM SHA-256, init args) is written
> to a timestamped file in [`../deploy-evidence/`](../deploy-evidence/).

Manual equivalent:

```bash
stellar contract deploy --wasm target/wasm32v1-none/release/device_registry.wasm --network testnet
stellar contract invoke --id <DEVICE_ID> --network testnet -- initialize --admin <ADMIN>
# ...repeat for agent_registry and payment_escrow (escrow linked to the other two)
```

---

## 8. Deployed contract IDs

**Testnet** (redeployed 2026-10-24, Week 4 security fixes):

| Contract | ID | WASM SHA-256 |
|----------|----|--------------|
| device_registry | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` | `f2c758eb…580d55` |
| agent_registry | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` | `06402417…1c84ab` |
| payment_escrow | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` | `e430f8ab…73a0a2` |

The on-chain WASM hash must match the local release build — recompute with
`sha256sum` to verify the deployed code is exactly what's in this repo. On-chain
explorer screenshots: [`Evidence/README.md`](Evidence/README.md).

---

## 9. Frontend wallet integration

The app talks to Soroban through `@stellar/stellar-sdk` v16. Two thin helpers
in `frontend/src/lib/soroban.ts` wrap all contract traffic:

| Helper | Purpose |
|--------|---------|
| `readContract({ contractId, method, args, source })` | Read-only: builds a tx, **simulates** it, returns `retval` (no submission, no fee) |
| `invokeContract({ contractId, method, args, source, signer })` | State-changing: build → `prepareTransaction` → sign → `sendTransaction` → poll `getTransaction` |
| `deviceHashScVal(sha256Hex)` | `xdr.ScVal.scvBytes(Buffer.from(hex))` for a `BytesN<32>` device hash |
| `walletAddressScVal(publicKey)` | `Address.fromString(pk).toScVal()` for an `Address` arg |

The x402 orchestration lives in `frontend/src/domain/x402.ts`, which exposes the
device/agent/escrow operations the UI calls, including:

- `registerDeviceAndAgentOnChain(...)` — the provisioning flow (device + agent in one path)
- `registerDeviceOnChain` / `revokeDeviceOnChain`
- `registerAgentOnChain` / `revokeAgentOnChain`
- `payWithAgent(...)` — the tap-to-pay authorize
- `topUpAgent` / `sweepAgentFunds` / `retireAgent`
- `getEscrowBalance` / `getPendingBalance` / `getOnChainDevices`

### Device provisioning flow (app → chain)

1. App reads the NFC tag UID and computes `SHA-256(UID)` → `device_hash`.
2. User signs; app calls `device_registry.register(wallet, device_hash, agent)`.
3. A per-device x402 agent keypair is created and funded (Friendbot on testnet).
4. Owner signs `agent_registry.register_agent(...)` to authorize the agent under a policy.
5. Device is linked and ready for tap-to-pay.

### Escrow payment flow (tap)

1. Owner `fund_escrow(...)` once per device.
2. Tap → `device_hash` → agent calls `payment_escrow.authorize(merchant, amount, nonce)`.
3. Funds move from escrow to a pending-merchant balance instantly.
4. Merchant `claim(...)` settles all pending payments in one tx.
5. Owner can `defund_escrow(...)` unused balance, or `sweep_on_revoke(...)` after revoking the agent.

---

## 10. Transaction lifecycle

**Read (simulate only)** — `readContract`:

```
getAccount(source) → TransactionBuilder(contract.call(method,args))
→ server.simulateTransaction(tx) → return sim.result.retval
```

**Write (submit + poll)** — `invokeContract`:

```
sourceAccountExists(source)                  // guard: must be funded on-chain
→ getAccount(source)
→ TransactionBuilder(contract.call(method,args)).setTimeout(30).build()
→ server.prepareTransaction(tx)              // Soroban footprint + resource fees
→ prepared.sign(signer)                      // Keypair
→ server.sendTransaction(prepared)
→ poll server.getTransaction(hash)           // up to 60s, 1s interval
→ SUCCESS → return hash | FAILED/timeout → throw
```

Fees use `BASE_FEE`; the network passphrase and RPC URL come from app `Config`.
Accounts must exist on-chain (funded via Friendbot on testnet) before use — both
helpers guard with `sourceAccountExists`.

---

## 11. Testing

Integration tests live in each contract's `tests/integration.rs` and run on the
host target.

```bash
cd backend
cargo test                                   # all contracts
cargo test -p agent-registry                 # one contract
```

Current coverage — **45 tests, 0 failures, 0 warnings** (full per-test list in [Testing](testing.md)):

| Contract | Tests | Focus |
|----------|-------|-------|
| device_registry | 10 | register/revoke/re-register, index compaction, `is_authorized` true & false paths, owner guards |
| agent_registry | 17 | policy roundtrip, `check_payment` predicate (cap, asset, expiry, non-positive), `is_auth`, invalid-policy guards |
| payment_escrow | 18 | fund/authorize/claim/defund, nonce replay, over-limit/wrong-asset/expired/unauthorized rejects, sweep-on-revoke + guard |

Test utilities: `Env::default()`, `env.register(...)`, `env.mock_all_auths()`,
`register_stellar_asset_contract_v2` (SAC token for escrow tests),
`env.ledger().set_timestamp(...)` (expiry tests). Negative tests use
`#[should_panic(expected = "Error(Contract, #N)")]` matching the contract error
codes.

Doctests are disabled per contract (`[lib] doctest = false`) because the
contracts carry no runnable doc examples.

---

## 12. CI

`.github/workflows/contracts.yml` builds and tests on every push/PR touching
`backend/contracts/**`:

1. Install Rust `1.98.1` + `wasm32v1-none` (must match `rust-toolchain.toml` so
   published WASM hashes reproduce).
2. Build dependency contracts (`agent-registry`, `device-registry`) **before**
   `payment_escrow` (required by `contractimport!`).
3. Run `cargo test` on the host target.

The job reports a `test` status check, which gates merges into protected branches.

---

## 13. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Account … does not exist on-chain` | Source account unfunded — fund via Friendbot (testnet) before invoking. |
| `Error(Contract, #3)` on `authorize` | `AgentNotAuthorized` — agent/asset/cap/expiry failed `check_payment`, or agent was revoked. |
| `Error(Contract, #6)` on `authorize` | `DuplicateAuth` — nonce not strictly greater than the last used for this `(device, agent)`. |
| `Error(Contract, #7)` on `sweep_on_revoke` | `AgentStillActive` — revoke the agent first, then sweep. |
| `Error(Contract, #4)` on `register_agent` | `InvalidPolicy` — negative `max_amount` or a non-zero `expires_at` already in the past. |
| WASM hash mismatch vs. deployed | Build under the pinned toolchain (`1.98.1`, `wasm32v1-none`); other compilers embed different host paths. |
| `cargo test` can't find a target / tries WASM | Ensure `backend/.cargo/config.toml` sets the host build target. |
| Contract IDs changed after redeploy | Expected — each deploy mints new IDs. Re-run with `UPDATE_ENV=1` or copy from the latest `deploy-evidence/` file. |

---

<div align="center">

**Related docs:** [Architecture](architecture.md) · [Deployment Evidence](Evidence/README.md) · [Root README](../README.md)

</div>
