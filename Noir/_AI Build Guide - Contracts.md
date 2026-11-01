---
tags: [guide, contracts, soroban, ai, build, memory]
aliases: [Contract Guide, AI Build Guide, Contract Functions]
---

# 🤖 AI Build Guide — Soroban Contracts (Complete)

> Source-accurate reference for an AI (or human) building/extending Noir Wallet's on-chain layer. Derived directly from the Rust in `backend/contracts/`. The README's contract tables were realigned to this source as of 2026-10-02, so the two now agree — but this note stays the canonical one: if they ever diverge, trust the Rust, then this note. Linked from [[_Context - What We Are Building]], [[Smart Contracts]], and [[_SCF Instaward - Deliverables & Constraints]].

## Ground rules for the AI

- **Never store keys/secrets on the NFC tag.** The tag UID is read, SHA-256 hashed off-chain, and only the 32-byte hash (`BytesN<32>`) touches chain state.
- **Auth is enforced on-chain**, not by the app. Every state-changing call has a `require_auth()` on the party who must consent. If you change who can call something, change the `require_auth` target.
- **`no_std`** everywhere. Use `soroban_sdk` types (`Address`, `BytesN<32>`, `i128`, `u32`, `u64`, `Vec`, `Map`) — no `std`.
- **Amounts are `i128` in stroops-style integers** (token's smallest unit). Never floats on-chain.
- **Errors** are `#[contracterror] #[repr(u32)]` enums raised via `panic_with_error!`. Preserve existing numeric codes — the app and tests match on them.
- **Events** are published on every mutation with `symbol_short!` topics — keep publishing them so indexers/tests can observe flows.
- Contracts **compose**: `payment_escrow` imports `agent_registry` and `device_registry` WASM via `contractimport!` and calls them cross-contract. Build order matters (see below).

## Build & deploy order (dependencies)

`payment_escrow` `contractimport!`s the other two WASM files at compile time:
```rust
mod agent_registry  { contractimport!(file = "../../target/wasm32v1-none/release/agent_registry.wasm"); }
mod device_registry { contractimport!(file = "../../target/wasm32v1-none/release/device_registry.wasm"); }
```
So you MUST build `agent_registry` and `device_registry` **before** `payment_escrow`:
```bash
cd backend
cargo build --release --target wasm32v1-none -p agent-registry -p device-registry
cargo build --release --target wasm32v1-none -p payment-escrow
```
Deploy + init order: device_registry → agent_registry → payment_escrow (escrow init needs both IDs). See [[_Redeploy Contracts]].

---

## Contract 1 — [[DeviceRegistry]] (`device_registry`)

Maps a device hash → `DeviceInfo { owner, agent, status, created_at }` and keeps a **dense per-wallet index** so a wallet can enumerate its devices.

### Storage (`DataKey`)
- `Admin` → `Address` (set once)
- `Device(BytesN<32>)` → `DeviceInfo`
- `WalletDeviceCount(Address)` → `u32`
- `WalletDeviceByIndex(Address, u32)` → `BytesN<32>`

`DeviceInfo`: `owner: Address`, `agent: Address`, `status: u32` (0 = active), `created_at: u64`.

### Errors
`AlreadyInitialized=1`, `DeviceNotFound=2`, `NotOwner=3`, `AlreadyRegistered=4`.

### Functions
| Fn | Signature | Auth | Behavior |
|----|-----------|------|----------|
| `initialize` | `(admin: Address)` | `admin` | Stores admin. Panics `AlreadyInitialized` if run twice. |
| `register` | `(wallet, device_hash, agent)` | `wallet` | Panics `AlreadyRegistered` if the hash exists. Writes `DeviceInfo{owner=wallet, agent, status:0, created_at:now}`, appends hash to wallet's index list, increments count. Emits `("register", device_hash) → agent`. |
| `revoke` | `(wallet, device_hash)` | `wallet` | Loads device (`DeviceNotFound`), checks `owner==wallet` (`NotOwner`). **Fully removes** the device entry + compacts the wallet index list (shifts entries down so list stays dense) and decrements count. Emits `("revoke", device_hash)`. Full removal (not a soft flag) is deliberate so the hash can be **re-registered** later. |
| `get_device` | `(device_hash) -> DeviceInfo` | none (view) | Panics `DeviceNotFound` if absent. |
| `wallet_device_count` | `(wallet) -> u32` | none | 0 if none. |
| `wallet_device_at` | `(wallet, index) -> BytesN<32>` | none | Panics `DeviceNotFound` on bad index. |
| `is_authorized` | `(device_hash, agent) -> bool` | none | `true` iff device exists AND `info.agent==agent` AND `info.status==0`. |
| `get_agent` | `(device_hash) -> Address` | none | Agent for device; panics `DeviceNotFound`. |
| `get_owner` | `(device_hash) -> Address` | none | Owner for device; panics `DeviceNotFound`. Used by escrow's `defund`. |

> ⚠️ AI note: `device_registry` stores its own `agent` field, and `agent_registry` *also* stores an agent per device. They are two independent authorization records. Escrow checks **`agent_registry.is_auth`**, not `device_registry`. Keep them consistent when registering (register the same agent in both) unless you intentionally redesign.

---

## Contract 2 — [[AgentRegistry]] (`agent_registry`)

The authority the escrow trusts for "may this agent spend for this device?".

### Storage (`DataKey`)
- `Admin` → `Address`
- `AgentMap(BytesN<32>)` → `AgentPolicy` (device_hash → constrained authorization)

`AgentPolicy`: `agent: Address`, `max_amount: i128` (`0` = uncapped), `asset: Address` (the only token this agent may spend), `expires_at: u64` (absolute ledger timestamp; `0` = never expires).

### Errors
`AlreadyInitialized=1`, `AgentNotFound=2`, `AlreadyRegistered=3`, `InvalidPolicy=4`, `NotOwner=5`.

### Functions
| Fn | Signature | Auth | Behavior |
|----|-----------|------|----------|
| `initialize` | `(admin: Address)` | `admin` | Store admin once; panic `AlreadyInitialized` otherwise. |
| `register_agent` | `(wallet, device_hash, agent, max_amount, asset, expires_at)` | `wallet` | Panics `NotOwner` unless `wallet` owns the device in device_registry (cross-call `get_owner`). Panics `AlreadyRegistered` if `wallet`'s own policy exists (must `revoke_agent` first to rotate); a stale policy from a previous owner is replaced. Panics `InvalidPolicy` on a negative cap or an already-past expiry. Stores the full `AgentPolicy`. Emits `("agent_reg", device_hash) → agent`. |
| `revoke_agent` | `(wallet, device_hash)` | `wallet` | Panics `AgentNotFound` if none, `NotOwner` unless `wallet == policy.owner`. Removes mapping. Emits `("agent_rev", device_hash)`. |
| `get_agent` | `(device_hash) -> Address` | none | Policy's agent; panics `AgentNotFound` if none. |
| `get_policy` | `(device_hash) -> AgentPolicy` | none | Full policy; panics `AgentNotFound` if none. |
| `is_auth` | `(device_hash, agent) -> bool` | none | `true` iff stored agent == `agent` **and** the authorization has not expired. |
| `check_payment` | `(device_hash, agent, asset, amount) -> bool` | none | **The single enforcement predicate** the escrow calls: agent matches + asset matches + `amount > 0` + within `max_amount` + not expired. |

> ⚠️ Rotating an agent = `revoke_agent` then `register_agent` (register alone panics if one exists).
>
> ⚠️ `check_payment` is the gate `payment_escrow.authorize` uses. `is_auth` is the weaker agent+expiry check used for revocation state (e.g. escrow's `sweep_on_revoke` refuses while `is_auth` is still true).

---

## Contract 3 — [[PaymentEscrow]] (`payment_escrow`)

Pre-funded per-device escrow. Agent authorizes instant deductions (with **replay-protecting nonce**); merchants batch-claim; owner can reclaim.

### Storage (`DataKey`)
- `Admin` → `Address`
- `AgentRegistry` → `Address`, `DeviceRegistry` → `Address` (set at init)
- `EscrowBalance(BytesN<32>)` → `i128` (persistent) — funds per device
- `PendingIndex(Address)` → `u32` (persistent) — per-merchant running index / high-water mark
- `PendingPayment((Address, u32))` → `Payment { device_hash, asset, amount, timestamp }` (**persistent** since 2026-10-21) — one pending authorization
- `EscrowToken(BytesN<32>)` → `Address` — token the device balance is held in; fund/defund/sweep/authorize must match (`InvalidAsset=9`)
- `AuthNonce((BytesN<32>, Address))` → `u64` (persistent) — last used nonce per (device, agent)

`Payment`: `device_hash: BytesN<32>`, `amount: i128`, `timestamp: u64`.

### Errors
`AlreadyInitialized=1`, `InsufficientBalance=2`, `AgentNotAuthorized=3`, `NotDeviceOwner=4`, `NothingToClaim=5`, `DuplicateAuth=6`, `AgentStillActive=7`.

### Functions
| Fn | Signature | Auth | Behavior |
|----|-----------|------|----------|
| `initialize` | `(admin, agent_registry_id, device_registry_id)` | `admin` | Stores admin + both registry IDs. Panic `AlreadyInitialized` if repeated. **Takes BOTH registry IDs.** |
| `fund_escrow` | `(token, wallet, device_hash, amount)` | `wallet` | `token.transfer(wallet → contract, amount)`, then `EscrowBalance[device] += amount`. Emits `("fund", device_hash) → amount`. Any `wallet` can fund any device (funding is permissionless top-up). |
| `authorize` | `(agent, device_hash, merchant, asset, amount, nonce)` | `agent` | **(1)** replay check: `nonce > last_nonce` for (device,agent) else `DuplicateAuth`; store new nonce. **(1b)** `merchant != escrow` else `InvalidRecipient=10`; device registered else `DeviceNotRegistered=8`. **(2)** cross-call `agent_registry.check_payment(device_hash, agent, asset, amount)` — enforces agent + asset + cap + expiry — and `get_policy().owner == device owner`, else `AgentNotAuthorized`; `asset == EscrowToken` else `InvalidAsset`. **(3)** `balance >= amount` else `InsufficientBalance`; deduct. **(4)** bump `PendingIndex[merchant]`, write `Payment` (with asset) to **persistent** storage. Emits `("authorize",(device_hash,merchant)) → amount`. No token transfer here — funds move only on claim. |
| `claim` | `(token, merchant)` | `merchant` | Sums the pending `Payment`s in `token` from index `1..=PendingIndex[merchant]` (other assets stay pending). If total 0 → `NothingToClaim`. Removes claimed entries, resets `PendingIndex[merchant]=0` only when none remain, `token.transfer(contract → merchant, total)`. Emits `("claim", merchant) → total`. |
| `defund_escrow` | `(token, device_hash, amount)` | device **owner** | Looks up owner via `device_registry.get_owner(device_hash)` and requires **that owner's** auth (`NotDeviceOwner` path if registry unset). `balance >= amount` else `InsufficientBalance`; deduct; `token.transfer(contract → owner, amount)`. Emits `("defund", device_hash) → amount`. |
| `sweep_on_revoke` | `(token, device_hash, agent) -> i128` | device **owner** | Resolves owner via `device_registry.get_owner` and requires owner auth. Refuses with `AgentStillActive` if `agent_registry.is_auth(device_hash, agent)` is still true. Otherwise transfers the device's **entire** escrow balance back to the owner and zeroes it; returns the amount swept (0 is a no-op, not an error). |
| `balance_of` | `(device_hash) -> i128` | none | Escrow balance (0 if none). |
| `pending_balance` | `(merchant) -> i128` | none | Sum of merchant's still-present pending payments. |

> ✅ **Resolved 2026-10-21:** pending payments used to live in temporary storage and could expire unclaimed with the funds already debited. They are persistent now (`test_late_claim_still_pays`). Week 4 also bound balances to their token (cross-asset drain) and added ownership checks to agent_registry (agent hijack) — see `docs/contracts.md#week-4-security-fixes`.
>
> ⚠️ **Nonce = replay protection.** `authorize` requires strictly increasing `nonce` per (device, agent). The app/agent must persist and increment its nonce. This is the on-chain half of the SOW's "replayed payment request rejected" requirement.

---

## End-to-end call sequence (the SOW's core proof)

1. `device_registry.initialize(admin)` · `agent_registry.initialize(admin, device_registry_id)` · `payment_escrow.initialize(admin, agent_registry_id, device_registry_id)`
2. Owner: `device_registry.register(wallet, device_hash, agent)`
3. Owner: `agent_registry.register_agent(wallet, device_hash, agent, max_amount, asset, expires_at)`  ← the constrained policy escrow actually enforces
4. Owner: `payment_escrow.fund_escrow(token, wallet, device_hash, amount)`
5. Tap → agent: `payment_escrow.authorize(agent, device_hash, merchant, asset, amount, nonce++)`
6. Merchant: `payment_escrow.claim(token, merchant)`
7. Owner reclaim: `payment_escrow.defund_escrow(token, device_hash, amount)`
8. Revoke: `agent_registry.revoke_agent(wallet, device_hash)` and/or `device_registry.revoke(wallet, device_hash)`
9. Owner sweep after revoke: `payment_escrow.sweep_on_revoke(token, device_hash, agent)` → returns the device's whole remaining escrow balance to the owner

See flows: [[Flow - Device Provisioning]] · [[Flow - Escrow Payment]] · [[Flow - Tap to Pay]].

## Negative paths the AI must keep passing (maps to [[_SCF Instaward - Deliverables & Constraints]])

- unregistered device → `authorize` fails `AgentNotAuthorized` (no agent policy)
- duplicate registration → `register`/`register_agent` fail `AlreadyRegistered`
- unauthorized agent → `AgentNotAuthorized`
- **over-limit payment** → `check_payment` false → `AgentNotAuthorized`
- **wrong asset** → `check_payment` false → `AgentNotAuthorized`
- **expired authorization** → `check_payment`/`is_auth` false → `AgentNotAuthorized`
- underfunded escrow → `InsufficientBalance`
- revoked agent → `authorize` fails `AgentNotAuthorized` after `revoke_agent`
- revoked device → `authorize` fails `DeviceNotRegistered`
- stranger revoke/register agent → `NotOwner`; cross-asset defund/sweep → `InvalidAsset`; escrow as merchant → `InvalidRecipient`
- replayed request (nonce reuse) → `DuplicateAuth`
- claim with nothing pending → `NothingToClaim`
- sweep while the agent is still authorized → `AgentStillActive`
- defund by non-owner → owner `require_auth` fails
- invalid policy at registration (negative cap / past expiry) → `InvalidPolicy`

Integration tests live at `backend/contracts/*/tests/integration.rs` — extend these when adding behavior; do not weaken existing assertions.

## When extending: checklist for the AI

1. Add/modify the `DataKey` variant and keep migrations in mind (persistent vs temporary).
2. Add the right `require_auth()` on the consenting party.
3. Add a `#[contracterror]` code (append; never renumber existing).
4. Publish an event on mutation.
5. If it's cross-contract, wire the registry ID from storage (don't hardcode).
6. Rebuild dependency WASM first (agent/device) before `payment_escrow`.
7. Add positive + negative integration tests; run `cargo test`.
8. Update `frontend/src/lib/soroban.ts` / [[x402]] bindings and the [[_Redeploy Contracts]] runbook.
9. Redeploy → new Contract IDs → update `frontend/.env` + README + evidence pack.
