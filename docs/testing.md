# Automated Test Documentation

How to run every test suite, what each one covers, and which test proves each SOW security requirement.

## Summary (run 2026-10-21)

| Suite | Command | Result |
|-------|---------|--------|
| Soroban contracts | `cargo test` in `backend/` (host target) | **60 passed**, 0 failed (10 + 21 + 29) |
| App unit tests | `npm test` in `frontend/` | **306 passed** in 23 files |
| App type check | `npx tsc --noEmit` in `frontend/` | clean |
| Agent SDK | `npm test` in `sdk/agent-sdk/` | 18 passed; live suites skipped (`npm run test:testnet`, `npm run test:security-matrix`) |
| REST gateway | `npm test` in `sdk/noir-api/` (after `npm run setup`) | 18 passed |
| Live Testnet flow | `npm run test:testnet` in `frontend/` | passing; last evidence [`week2-testnet-flow-20261009T044804Z.md`](../deploy-evidence/week2-testnet-flow-20261009T044804Z.md) |
| Live security matrix | `npm run test:security-matrix` in `sdk/agent-sdk/` | **PASS** on the 2026-10-24 redeploy (15 tests, all 20 outcomes) — [`week4-security-matrix-20261024T131458Z.md`](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) |

Full output of this run: [`deploy-evidence/test-results-20261021T034015Z.txt`](../deploy-evidence/test-results-20261021T034015Z.txt). CI runs the contract, app and SDK suites on every push and PR (`contracts.yml`, `frontend.yml`, `sdk.yml`).

The [2026-10-24 source-verification record](../deploy-evidence/issue24-source-verification-20261024T075044Z.md) covers the guarded matrix runner and current offline checks. No redeployment, live suite, or active contract-ID change is part of that work; [issue #24](https://github.com/noirx402/noir/issues/24) remains open pending live acceptance.

## Running the tests

```bash
# Contracts — build the dependency WASM first (payment_escrow imports it)
cd backend
cargo build --release --target wasm32v1-none -p agent-registry -p device-registry
cargo build --release --target wasm32v1-none -p payment-escrow
HOST=$(rustc -vV | awk '/host/{print $2}')
cargo test -p device-registry -p agent-registry -p payment-escrow --target "$HOST"
git checkout -- contracts/*/test_snapshots     # cargo rewrites these; no real change

# App
cd ../frontend
npx tsc --noEmit
npm test                 # or: npm run test:coverage

# SDK + gateway (the gateway depends on the built SDK)
cd ../sdk/agent-sdk && npm ci && npm test
cd ../noir-api && npm run setup && npm test
```

## Contract tests

Each contract has `tests/integration.rs`. Tests run in the Soroban test `Env` with `env.mock_all_auths()`, a real Stellar Asset Contract token (`register_stellar_asset_contract_v2`) for escrow, and `env.ledger().set_timestamp(...)` to move time for expiry. Negative tests assert the exact contract error with `#[should_panic(expected = "Error(Contract, #N)")]`.

### device_registry (10)

| Test | Proves |
|------|--------|
| `test_initialize_happy_path` | Admin set once |
| `test_initialize_double_init_guard` | Second init → `#1 AlreadyInitialized` |
| `test_register_maps_device` | Hash → owner + agent recorded; wallet index updated |
| `test_unauthorized_register_rejected` | `register` without the wallet's signature fails |
| `test_revoke_removes_entry_enabling_re_registration` | Revoke deletes the entry; the tag can be registered again |
| `test_get_device_after_revoke_panics` | Revoked device is gone → `#2 DeviceNotFound` |
| `test_revoke_only_removes_owned_device` | Index compaction leaves other devices intact |
| `test_is_authorized_false_for_wrong_agent` | Wrong agent → `false` |
| `test_is_authorized_false_for_unknown_device` | Unregistered device → `false` |
| `test_revoke_non_owner_rejected` | Revoke by a non-owner → `#3 NotOwner` |

### agent_registry (21)

| Test | Proves |
|------|--------|
| `test_initialize_happy_path` / `test_initialize_double_init_guard` | Init once → `#1` |
| `test_register_and_get_agent_roundtrip` | Policy stored and read back field by field |
| `test_duplicate_registration_rejected` | Second policy for a device → `#3 AlreadyRegistered` |
| `test_register_with_past_expiry_rejected` | Past `expires_at` → `#4 InvalidPolicy` |
| `test_register_with_negative_max_amount_rejected` | Negative cap → `#4 InvalidPolicy` |
| `test_is_auth_true_for_authorized_agent` | Authorized agent accepted |
| `test_is_auth_false_for_stranger` | Other key refused |
| `test_is_auth_false_after_expiry` | Expired policy refused |
| `test_revoke_removes_authorization` | After `revoke_agent`, `is_auth` is false |
| `test_revoke_unknown_device_panics` | Revoke with no policy → `#2 AgentNotFound` |
| `test_check_payment_accepts_in_policy` | In-policy payment accepted |
| `test_check_payment_rejects_over_limit` | Above `max_amount` refused |
| `test_check_payment_rejects_wrong_asset` | Other token refused |
| `test_check_payment_rejects_nonpositive_amount` | `0` / negative refused |
| `test_check_payment_uncapped_when_max_zero` | `max_amount = 0` means uncapped |
| `test_check_payment_rejects_after_expiry` | Expired policy refused |
| `test_register_for_unowned_device_rejected` | Policy for an unregistered device → `#5 NotOwner` |
| `test_register_for_someone_elses_device_rejected` | Policy for another wallet's device → `#5 NotOwner` |
| `test_revoke_by_stranger_rejected` | Revoke by a wallet that did not grant the policy → `#5 NotOwner` |
| `test_new_owner_replaces_stale_policy` | After the tag changes hands, the new owner's policy replaces the old one |

The agent_registry tests use a small mock `device_registry` (`MockDevices`) that only answers `get_owner`; the escrow tests below use the real one.

### payment_escrow (29)

| Test | Proves |
|------|--------|
| `test_initialize_double_init_guard` | Init once → `#1` |
| `test_balance_of_unfunded_is_zero` | Default balance 0 |
| `test_fund_escrow_increases_balance` | Deposit credits the device |
| `test_fund_unregistered_device_rejected` | Fund for an unknown device → `#8 DeviceNotRegistered` |
| `test_authorize_in_policy_payment` | In-policy tap deducts the balance and creates a pending payment |
| `test_claim_payments` | Merchant batch-claims pending payments |
| `test_claim_nothing_fails` | Nothing pending → `#5 NothingToClaim` |
| `test_defund_escrow_returns_funds` | Owner withdraws part of the balance |
| `test_unauthorized_agent_rejected` | Unknown agent → `#3 AgentNotAuthorized` |
| `test_revoked_agent_rejected` | Agent after `revoke_agent` → `#3` |
| `test_over_limit_payment_rejected` | Above the cap → `#3` |
| `test_wrong_asset_rejected` | Other token → `#3` |
| `test_expired_authorization_rejected` | After `expires_at` → `#3` |
| `test_replayed_nonce_rejected` | Reused nonce → `#6 DuplicateAuth` |
| `test_insufficient_balance_rejected` | More than the balance → `#2 InsufficientBalance` |
| `test_sweep_on_revoke_returns_all_funds_to_owner` | Revoke → full balance back to owner |
| `test_sweep_rejected_while_agent_active` | Sweep with a live agent → `#7 AgentStillActive` |
| `test_sweep_on_empty_escrow_is_noop` | Empty sweep returns 0, no transfer |
| `test_cross_asset_defund_rejected` | Deposit in a junk token withdrawn as the real token → `#9 InvalidAsset` (was a drain) |
| `test_cross_asset_sweep_rejected` | Sweep in another token → `#9` |
| `test_fund_with_second_asset_rejected` | Topping up a funded escrow in another token → `#9` |
| `test_claim_only_pays_the_payment_asset` | Claim in another token pays nothing; the real payment stays claimable |
| `test_agent_hijack_rejected` | Stranger cannot revoke the agent, install their own, or spend the escrow |
| `test_revoked_device_rejected` | Device revoked with its agent policy still on file → `#8 DeviceNotRegistered` |
| `test_stale_policy_after_ownership_change_rejected` | Previous owner's agent cannot spend the new owner's escrow → `#3` |
| `test_escrow_as_merchant_rejected` | Merchant = escrow contract → `#10 InvalidRecipient` |
| `test_nonpositive_fund_rejected`, `test_negative_defund_rejected` | Zero / negative amounts → `#11 InvalidAmount` |
| `test_late_claim_still_pays` | A payment claimed after the temporary-entry TTL still pays (persistent storage) |

## SOW security matrix → tests

| SOW requirement | Test(s) | Status |
|-----------------|---------|--------|
| Registered NFC device accepted | `test_register_maps_device`, `test_fund_escrow_increases_balance` | ✅ |
| Unregistered NFC device rejected | `test_fund_unregistered_device_rejected`, `test_is_authorized_false_for_unknown_device`, `test_register_for_unowned_device_rejected` | ✅ |
| Duplicate device registration handled | `device_registry` `AlreadyRegistered`; `test_duplicate_registration_rejected`; live run step 5 | ✅ |
| Authorized payment agent accepted | `test_authorize_in_policy_payment`, `test_is_auth_true_for_authorized_agent` | ✅ |
| Unauthorized payment agent rejected | `test_unauthorized_agent_rejected`, `test_is_auth_false_for_stranger` | ✅ |
| Expired authorization rejected | `test_expired_authorization_rejected`, `test_check_payment_rejects_after_expiry` | ✅ |
| Revoked device rejected | `test_revoked_device_rejected`, `test_get_device_after_revoke_panics`; `fund_escrow` after revoke → `#8` | ✅ |
| Revoked payment agent rejected | `test_revoked_agent_rejected`, `test_revoke_removes_authorization` | ✅ |
| Payment over spending limit rejected | `test_over_limit_payment_rejected`, `test_check_payment_rejects_over_limit` | ✅ |
| Invalid asset rejected | `test_wrong_asset_rejected`, `test_check_payment_rejects_wrong_asset`, `test_cross_asset_defund_rejected`, `test_cross_asset_sweep_rejected`, `test_fund_with_second_asset_rejected` | ✅ |
| Invalid recipient rejected | `test_escrow_as_merchant_rejected` | ✅ the escrow itself. Any other address is a valid merchant: the policy does not hold a merchant allow-list |
| Agent cannot be hijacked by a stranger | `test_agent_hijack_rejected`, `test_revoke_by_stranger_rejected`, `test_register_for_someone_elses_device_rejected`, `test_stale_policy_after_ownership_change_rejected` | ✅ |
| Replayed payment request rejected | `test_replayed_nonce_rejected` | ✅ |
| Funds never stranded on revoke | `test_sweep_on_revoke_returns_all_funds_to_owner`, `test_sweep_rejected_while_agent_active` | ✅ |
| Funds never stranded unclaimed | `test_late_claim_still_pays` | ✅ |

These run in CI on every push. The live Testnet versions are in the [security matrix runner](#live-security-matrix); it passed against the 2026-10-24 redeploy ([report](../deploy-evidence/week4-security-matrix-20261024T131458Z.md)).

## App unit tests (`frontend/tests/`)

Vitest, with React Native, SecureStore and NFC modules mocked in `tests/setup.ts`.

| File | Covers |
|------|--------|
| `01-x402.test.ts` | Agent budget math, multi-agent logic, `registerDeviceAndAgentOnChain` sequencing, device ownership checks |
| `02-stellar.test.ts` | Stellar service, payment history, balance cache |
| `03-nfc.test.ts` | NFC service and `useNfc` hook logic |
| `04-api.test.ts` | Optional backend API client |
| `05-store.test.ts` | App state store |
| `06-components.test.ts` | Balance card, Testnet faucet banner, other components |
| `07-screens.test.ts` | Device provisioning, agent and dashboard screen logic |
| `08-fxrates.test.ts`, `09-constants.test.ts` | FX rates, theme and config constants, type validation |
| `10-new-features.test.ts` | Sign-out cleanup, explorer links, recovery phrase / key display, profile |
| `11-security.test.ts`, `14-app-password.test.ts` | Wallet password as default unlock, optional phone unlock, app-password fallback |
| `12-send.test.ts`, `12-tx-format.test.ts` | Address validation, reserve and spendable balance, memo limits, amount and transaction formatting |
| `13-flow-helpers.test.ts` | Keypad amount input, receipt route params |
| `13-network-freshness.test.ts` | Per-network contract config, balance freshness |
| `14-logger.test.ts` | Secret redaction, log levels |
| `15-redesign.test.ts` | Browse address bar, default agent policy when linking a card |
| `16-dapp-bridge.test.ts` | In-app browser dApp bridge: request parsing, origins and network, transaction summary |
| `17-incoming-payments.test.ts`, `18-local-activity.test.ts` | Incoming payment notifications, pending activity and history merge |
| `19-payment-qr.test.ts` | SEP-0007 payment QR, `resolveCardRecipient` for tap-to-send |
| `browse-apps.test.ts` | Browse app catalog |

## Live Testnet run

`npm run test:testnet` ([`frontend/testnet/week2-flow.testnet.ts`](../frontend/testnet/week2-flow.testnet.ts)) runs the app's own `walletService` and `x402` code against the deployed contracts. Only native modules are stubbed. It is opt-in and never part of `npm test` or CI, because it spends Friendbot XLM and takes a minute or two.

Steps: create and import a wallet → Friendbot → simulated NTAG213 UID → `register` → `register_agent` → read the policy back → second wallet refused for the same tag → `fund_escrow` → `defund_escrow` → `revoke_agent` → `sweep_on_revoke` → `revoke`. Each transaction hash is written to `deploy-evidence/week2-testnet-flow-<timestamp>.md`.

## CI

| Workflow | Runs on | Steps |
|----------|---------|-------|
| [`contracts.yml`](../.github/workflows/contracts.yml) | push/PR to `main`, `instaward*` | Pinned Rust `1.98.1` + `wasm32v1-none` → build dependency WASM → build escrow → `cargo test` → WASM hash report (informational) |
| [`frontend.yml`](../.github/workflows/frontend.yml) | push/PR to `main`, `instaward*` | Node 22.23.4 → `yarn install --frozen-lockfile` → `tsc --noEmit` → `yarn test` |

Run history: [GitHub Actions](https://github.com/noirx402/noir/actions).

Related: [Contract reference](contracts.md) · [Walkthrough](walkthrough.md)

## Live security matrix

`npm run test:security-matrix` in `sdk/agent-sdk/` ([`tests/security-matrix.testnet.test.ts`](../sdk/agent-sdk/tests/security-matrix.testnet.test.ts)) explicitly opts into the live suite on Windows and POSIX through `npm_lifecycle_event=test:security-matrix`. Direct Vitest invocation can opt in with `NOIR_TESTNET=1`. Ordinary `npm test` keeps live suites skipped when `NOIR_TESTNET` is absent or `0`.

An enabled matrix requires all three explicit variables: `NOIR_DEVICE_REGISTRY`, `NOIR_AGENT_REGISTRY`, and `NOIR_PAYMENT_ESCROW`. It rejects missing/empty values, invalid contract encoding or checksum, duplicate IDs, and any of the three vulnerable [2026-10-07 contract IDs](../deploy-evidence/deploy-testnet-20261007T050558Z.md), even when explicitly supplied under another role. Validation runs before Friendbot funding or RPC requests. Valid IDs alone do not prove that the reviewed fixed WASM is deployed; the release owner must verify artifacts and initialization first.

With approved targets, the suite uses fresh Friendbot accounts and writes `deploy-evidence/week4-security-matrix-<timestamp>.md`: transaction links for accepted steps and contract errors for simulation refusals, which have no accepted transaction hash. Reports are classified `PASS`, `FAIL`, or `INCOMPLETE`. Acceptance requires `PASS` **and** a paired Vitest exit code of 0, completed setup and final verification, no failed assertions, and all 20 required outcomes exactly once: `P1`–`P6`, `N1`–`N6`, `N7a`, `N7b`, `N8`–`N10`, `N11a`, `N11b`, `N12`. Setup rows do not replace outcomes. Every row must match its expected green result; accepted steps need a valid transaction hash. A failed balance assertion makes the report `FAIL` even if its transaction row is green. Missing/duplicate outcomes or unfinished verification cannot produce `PASS`; preflight/setup failure produces no successful live report.

| # | Case | Expected |
|---|------|----------|
| P1–P3 | register device, constrained agent (5 XLM cap, 1 h), fund 20 XLM | accepted |
| P4–P5 | agent authorizes 2 XLM, merchant claims | accepted |
| P6 | revoke agent, sweep the balance back to the owner | accepted |
| N1 | fund an unregistered device | `DeviceNotRegistered` |
| N2 | authorize signed by a key that is not the agent | `AgentNotAuthorized` |
| N3 | 6 XLM against the 5 XLM cap | `AgentNotAuthorized` |
| N4 | non-policy asset | `AgentNotAuthorized` |
| N5 | escrow contract as merchant | `InvalidRecipient` |
| N6 | replayed nonce | `DuplicateAuth` |
| N7a–N7b | stranger revokes the agent / registers their own | `NotOwner` |
| N8 | junk-token deposit withdrawn as XLM | `InvalidAsset` |
| N9 | authorize after `expires_at` | `AgentNotAuthorized` |
| N10 | revoked agent | `AgentNotAuthorized` |
| N11a–N11b | revoked device (agent policy still on file), and funding it | `DeviceNotRegistered` |
| N12 | duplicate device registration | `AlreadyRegistered` |

### Offline expected-failure preflight

Use Node `22.23.4` from the repository's `.nvmrc` for these checks; the file does not switch an already running shell.

From `sdk/agent-sdk/`, clear the targets and run the named command. This check is safe during source verification: it must exit nonzero with `Set NOIR_DEVICE_REGISTRY to a valid explicit contract ID.` before any live request, without creating a matrix report. An exit code of 0 is a failure of this preflight check.

```powershell
Remove-Item Env:NOIR_DEVICE_REGISTRY, Env:NOIR_AGENT_REGISTRY, Env:NOIR_PAYMENT_ESCROW -ErrorAction SilentlyContinue
npm.cmd run test:security-matrix
# Expected: nonzero $LASTEXITCODE and the missing-target error.
```

```bash
(
  unset NOIR_DEVICE_REGISTRY NOIR_AGENT_REGISTRY NOIR_PAYMENT_ESCROW
  npm run test:security-matrix
)
# Expected: nonzero exit code and the missing-target error.
```

Do not supply synthetic IDs to the live runner for offline verification. Target-validation and report-classification tests run offline in `tests/security-matrix-support.test.ts`.

From the repository root, `bash scripts/tests/propagate-contract-ids.sh` checks ID propagation in a synthetic temporary Git repository. It requires Bash, Git, jq, and standard Unix tools, and also runs in SDK CI. Active references must update while the matrix's immutable pre-fix IDs and historical deployment records stay unchanged; it never propagates IDs in the real checkout.

### Deferred: release owner only

After an approved fixed deployment and artifact/initialization verification, run the matrix **before propagating its new IDs**. From `sdk/agent-sdk/`, enter the actual IDs from that deployment's evidence record:

```powershell
$env:NOIR_DEVICE_REGISTRY = Read-Host 'Approved new device_registry contract ID'
$env:NOIR_AGENT_REGISTRY = Read-Host 'Approved new agent_registry contract ID'
$env:NOIR_PAYMENT_ESCROW = Read-Host 'Approved new payment_escrow contract ID'
npm.cmd run test:security-matrix
```

```bash
printf 'Approved new device_registry contract ID: '
read -r NOIR_DEVICE_REGISTRY
printf 'Approved new agent_registry contract ID: '
read -r NOIR_AGENT_REGISTRY
printf 'Approved new payment_escrow contract ID: '
read -r NOIR_PAYMENT_ESCROW
export NOIR_DEVICE_REGISTRY NOIR_AGENT_REGISTRY NOIR_PAYMENT_ESCROW
npm run test:security-matrix
```

The SDK matrix does **not** load `frontend/.env`. The frontend live suite separately loads its `EXPO_PUBLIC_*` configuration; EAS builds additionally use the committed build-profile values in `frontend/eas.json`. Follow the [deferred handoff](deployment.md#deferred-issue-24-release-handoff) before updating them or publishing an APK. Optional gateway credentials are unnecessary for source verification.

The matrix covers the listed outcomes; it does not provide an elapsed-TTL live demonstration of late claims or every amount variant. Retain the contract regression evidence for those fixes. No phone or tag is needed for SDK tests; a real Android NFC phone, NTAG213, and native build are needed later for physical acceptance. Escrow `authorize` and merchant `claim` are exercised through the SDK; they are not fully wired app features.

