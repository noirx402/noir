# Instaward Evidence Package — Week 4

The final evidence index for the Stellar Community Fund Instaward: every Week 4 expected output, where its proof lives, and what is still open. Status is as of **2026-10-24**. The rule for this page: an item is ✅ only if the linked artifact exists and can be checked by a reviewer today.

**Repository:** [github.com/noirx402/noir](https://github.com/noirx402/noir) — public, [MIT](../LICENSE) (GitHub detects the license as `MIT`).

## Summary

| Week 4 output | Status | Evidence |
|---------------|--------|----------|
| Final testing + bug fixes | ✅ | [Security audit fixes](#1-final-testing-and-bug-fixes) — 4 exploitable contract bugs fixed, 60 contract tests; live matrix [PASS](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) |
| Public MIT repository | ✅ | [`LICENSE`](../LICENSE), public repo, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md), [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) |
| Deployment scripts + docs | ✅ | [`scripts/redeploy-contracts.sh`](../scripts/redeploy-contracts.sh), [deployment.md](deployment.md), [installation.md](installation.md) |
| Published Contract IDs + WASM hashes + tx links | ✅ | 2026-10-24 deploy with the Week 4 fixes ([record](../deploy-evidence/deploy-testnet-20261024T131024Z.md)) · explorer captures in [`Evidence/week4-security/`](Evidence/week4-security/) |
| Architecture diagrams | ✅ | [architecture.md](architecture.md) |
| Automated test results + CI | ✅ | [2026-10-24 source verification](../deploy-evidence/issue24-source-verification-20261024T075044Z.md), live [security matrix](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) + [frontend Testnet flow](../deploy-evidence/week2-testnet-flow-20261024T131654Z.md), [CI runs](#3-ci-build-results) |
| Positive- and negative-path validation | ✅ | [Security matrix](#2-positive-and-negative-path-validation) — all 20 outcomes live on Testnet ([report](../deploy-evidence/week4-security-matrix-20261024T131458Z.md)) |
| Transaction evidence | ✅ | Week 1 deploy + Week 2 flow; 2026-10-24 `authorize` → `claim`, revoke/sweep and reject cases in the [matrix report](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) |
| Screenshots | ✅ | [`docs/Evidence/wallet/`](Evidence/wallet/), [`docs/Evidence/`](Evidence/README.md) |
| Demo video | ✅ published · 🟡 re-shoot | [Demo on X](https://x.com/Noirx402/status/2109282993588334632) (posted 2026-10-11) · [`assets/x-demo.mp4`](../assets/x-demo.mp4) · [`assets/noir-demo.mp4`](../assets/noir-demo.mp4). It predates the Week 4 contract fixes; a re-shoot on the redeployed contracts follows the [shot list](demo-video-script.md) |

## 1. Final testing and bug fixes

A Week 4 review of the three contracts found four exploitable bugs on the code that is live on Testnet. Each was reproduced with a test that failed, then fixed (commit `fix(contracts): close escrow drain, agent hijack and revoked-device payment`). Full detail: [contracts.md → Week 4 security fixes](contracts.md#week-4-security-fixes).

| Severity | Bug | Fix |
|----------|-----|-----|
| Critical | **Cross-asset drain.** Escrow balances were plain numbers. Fund your own device with a self-issued token, withdraw the same amount in XLM. | Balance bound to its token; every movement must use it (`InvalidAsset = 9`) |
| Critical | **Agent hijack.** `revoke_agent` / `register_agent` did not check device ownership. A stranger could swap in their own agent and spend the owner's escrow. | Ownership checked in `device_registry` (`NotOwner = 5`); escrow checks the policy owner is the current device owner |
| High | **Revoked device still payable** while its agent policy was on file. | `authorize` requires a registered device (`DeviceNotRegistered = 8`) |
| Medium | **Unclaimed payments expired** (temporary storage) with funds already debited. | Persistent storage |
| Low | Escrow as merchant locks funds; zero/negative amounts reached the token. | `InvalidRecipient = 10`, `InvalidAmount = 11` |

Also fixed: `redeploy-contracts.sh` built all three contracts in one cargo call, which fails on a clean checkout (escrow imports the other two WASMs). The SDK and gateway had tests but no CI; `sdk.yml` now runs them.

**Breaking change:** `agent_registry.initialize(admin, device_registry_id)`. The 2026-10-24 redeploy minted new contract IDs; the 2026-10-07 IDs are retired.

[PR #22](https://github.com/noirx402/noir/pull/22) (contract fixes) and [PR #25](https://github.com/noirx402/noir/pull/25) (runtime/dependency security updates) are merged into development. The [2026-10-24 source-verification record](../deploy-evidence/issue24-source-verification-20261024T075044Z.md) records the reviewed source, offline checks, and artifact hashes. The fixes were redeployed on 2026-10-24 ([record](../deploy-evidence/deploy-testnet-20261024T131024Z.md)) and the live matrix passed against the new IDs ([report](../deploy-evidence/week4-security-matrix-20261024T131458Z.md)).

## 2. Positive- and negative-path validation

Every SOW case, with the contract test that proves it (CI, every push) and the live Testnet case in the [security matrix runner](testing.md#live-security-matrix).

| SOW case | Expected | Contract test | Live case |
|----------|----------|---------------|-----------|
| Approved payment workflow | register → agent → fund → authorize → claim | `test_authorize_in_policy_payment`, `test_claim_payments` | P1–P5 |
| Revocation returns funds | sweep pays the owner | `test_sweep_on_revoke_returns_all_funds_to_owner` | P6 |
| Unregistered device | `DeviceNotRegistered` | `test_fund_unregistered_device_rejected`, `test_register_for_unowned_device_rejected` | N1 |
| Unauthorized agent | `AgentNotAuthorized` | `test_unauthorized_agent_rejected`, `test_agent_hijack_rejected` | N2, N7 |
| Expired authorization | `AgentNotAuthorized` | `test_expired_authorization_rejected`, `test_check_payment_rejects_after_expiry` | N9 |
| Revoked device | `DeviceNotRegistered` | `test_revoked_device_rejected`, `test_stale_policy_after_ownership_change_rejected` | N11 |
| Revoked agent | `AgentNotAuthorized` | `test_revoked_agent_rejected` | N10 |
| Spending limit violation | `AgentNotAuthorized` | `test_over_limit_payment_rejected` | N3 |
| Invalid asset | `AgentNotAuthorized` / `InvalidAsset` | `test_wrong_asset_rejected`, `test_cross_asset_defund_rejected` | N4, N8 |
| Invalid recipient | `InvalidRecipient` | `test_escrow_as_merchant_rejected` | N5 |
| Replayed payment request | `DuplicateAuth` | `test_replayed_nonce_rejected` | N6 |
| Duplicate device registration | `AlreadyRegistered` | `test_duplicate_registration_rejected` (agent), device `AlreadyRegistered` | N12 |

**Scope note on recipients:** the policy has no merchant allow-list. Any address other than the escrow itself is a valid merchant; the agent key is trusted to choose the merchant within its cap and expiry. This is stated in [contracts.md](contracts.md#week-4-security-fixes) rather than claimed as covered.

## 3. CI build results

| Workflow | What it gates | Latest |
|----------|---------------|--------|
| [`contracts.yml`](../.github/workflows/contracts.yml) | WASM build + 60 contract tests | green on Instaward branches (see [PROGRESS.md → CI Status](../PROGRESS.md#ci-status)) |
| [`frontend.yml`](../.github/workflows/frontend.yml) | App typecheck + unit tests | Historical [run 39405833152](https://github.com/noirx402/noir/actions/runs/39405833152) ✅ (main, 2026-10-20; 306 tests) |
| [`sdk.yml`](../.github/workflows/sdk.yml) | SDK + gateway typecheck, tests, build | Merged with #22; current verification and CI links are in the [source record](../deploy-evidence/issue24-source-verification-20261024T075044Z.md) |

Local run, all suites, 2026-10-21: [`deploy-evidence/test-results-20261021T034015Z.txt`](../deploy-evidence/test-results-20261021T034015Z.txt) — 60 contract, 306 app, 18 SDK, 18 gateway, 0 failures.

2026-10-24 offline source checks: 60 contract tests, 70 SDK tests passed with 19 live tests skipped, and 18 gateway tests passed. Exact commits, commands, build hashes, and remaining check status are recorded in [source verification; not deployment evidence](../deploy-evidence/issue24-source-verification-20261024T075044Z.md). These results do not establish live acceptance of a new deployment.

## 4. Contract IDs, WASM hashes and transactions

| Record | Contents |
|--------|----------|
| [`deploy-testnet-20261024T131024Z.md`](../deploy-evidence/deploy-testnet-20261024T131024Z.md) | Current Testnet IDs (2026-10-24, Week 4 fixes), WASM SHA-256, create + initialize tx links |
| [`week4-security-matrix-20261024T131458Z.md`](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) | Live security matrix against the current IDs — **PASS**, 20 outcomes |
| [`week2-testnet-flow-20261024T131654Z.md`](../deploy-evidence/week2-testnet-flow-20261024T131654Z.md) | Frontend live Testnet flow re-run on the current IDs |
| [`deploy-testnet-20261007T050558Z.md`](../deploy-evidence/deploy-testnet-20261007T050558Z.md) | Retired 2026-10-07 deploy (pre-fix code) |
| [`week2-testnet-flow-20261009T044804Z.md`](../deploy-evidence/week2-testnet-flow-20261009T044804Z.md) | Live register → agent → fund → withdraw → unlink, through the app's code |
| [`WEEK1-EVIDENCE.md`](../deploy-evidence/WEEK1-EVIDENCE.md) | Week 1 index |
| [2026-10-24 source verification](../deploy-evidence/issue24-source-verification-20261024T075044Z.md) | Offline source checks and built artifacts; **not deployment evidence** |
| [`docs/Evidence/week2-evidence/`](Evidence/week2-evidence/) | Week 2 captures: beta release, PR #13, the three contracts and the agent top-up tx on Stellar Expert |
| [`week4-security-matrix-20261024T131458Z.md`](../deploy-evidence/week4-security-matrix-20261024T131458Z.md) | ✅ PASS — written by `npm run test:security-matrix` against the 2026-10-24 IDs |

## 5. Remaining steps (deferred release owner)

Deployment is explicitly deferred in the current source-verification phase. Follow the [release handoff](deployment.md#deferred-issue-24-release-handoff) in order; a phone and NTAG213 are needed later for physical acceptance, not for the SDK matrix:

1. ✅ **Redeploy** (done 2026-10-24) with the fixed contracts: `./scripts/redeploy-contracts.sh` (writes a new `deploy-evidence/deploy-testnet-*.md` with IDs, hashes and init args).
2. ✅ **Run the live matrix against the approved new IDs** (PASS, 2026-10-24), before propagating them, using the [release-owner commands](testing.md#deferred-release-owner-only). Require the complete 20-outcome `PASS` report and Vitest exit code 0; valid IDs or green transaction rows alone are insufficient.
3. ✅ **Propagate the IDs** (done 2026-10-24, frontend Testnet flow re-run passing) everywhere listed in [deployment.md](deployment.md#propagate-new-ids-through-the-docs) (README, `frontend/.env*`, `frontend/eas.json`, `sdk/agent-sdk/src/networks.ts`, `landing/lib/site.ts`, docs, Obsidian notes), then re-run `cd frontend && npm run test:testnet`.
4. **Build/install and verify the new app**, publish the accepted APK and tester notice retiring the old IDs. Recreate device links as needed; new contracts do not migrate old state.
5. **Re-shoot the demo video** on a real Android phone with an NTAG213 against the redeployed contracts — [shot list](demo-video-script.md). The published [demo on X](https://x.com/Noirx402/status/2109282993588334632) (2026-10-11) stays linked until then. Label SDK `authorize`/merchant `claim` evidence accurately; those are not fully wired app features.
6. Fill the ⏳ rows above with actual evidence. Keep #24 open until its deployment/live/build requirements are met; broader demo, release tagging and submission remain with [#23](https://github.com/noirx402/noir/issues/23).
