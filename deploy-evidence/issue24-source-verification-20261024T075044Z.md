# Issue #24 source verification; not deployment evidence

Recorded 2026-10-24. This record covers local source checks and the guarded security-matrix runner. **No contract was deployed or initialized, no account was funded, no live contract transaction was sent, and no active contract ID was changed during this work.** [Issue #24](https://github.com/rylsherdamz-rgb/Noir_Wallet/issues/24) remains open until its release acceptance requirements are met.

## Revisions and environment

- Development base and contract source tested: `12db11f0c37e21a53a4e2b2ddd7f7611ce660ffb` (includes merged #22 and #25).
- Runner code tested: `7f82ec81e725debcf339f34db6a1c4e0d7ee0167` (target guard commit `07832f6`, evidence-status commit `7f82ec8`). Later documentation-only commits record these results; they do not change the contract artifacts below.
- Final readiness code revision: `8abec32b5824dd14f874c83199e7944d18726399`, including a narrow propagation compatibility fix after integrating development `e786b41` (merged #27). Rust and app source remain unchanged; the new deployment workflow was not run or modified by this readiness work.
- Final reviewed CI configuration revision: `4cee397a5ff05ce1f997328d0424c3b0e574e061`; SDK CI now uses the same patched Node `22.23.4` as `.nvmrc` and frontend CI.
- Node: `v22.23.4`, from an official portable archive previously verified against its SHA-256 manifest. The machine's older default Node was not used for these checks.
- SDK/gateway: Vitest `4.1.11`, existing lockfile dependencies; no dependency was added.
- Frontend: Yarn `1.22.22`, `yarn install --frozen-lockfile`; no lockfile changed.
- Rust: `rustc 1.98.1 (48a229cea 2026-09-01)`, `cargo 1.98.1 (797e8a9bc 2026-08-05)`.
- Build host: Windows x86_64; tests targeted `x86_64-pc-windows-msvc`; WASM targeted `wasm32v1-none`.
- Build directory: `C:/Users/R O G - S T R I X/.codex/worktrees/887f/Noir Wallet/backend`.

## Local checks

Commands below ran in their named directory using the patched Node runtime or pinned Rust toolchain.

| Directory | Command | Observed result | Exit |
|---|---|---|---|
| `backend` | `cargo build --locked --release --target wasm32v1-none -p device-registry -p agent-registry` | Both dependency WASMs built | 0 |
| `backend` | `cargo build --locked --release --target wasm32v1-none -p payment-escrow` | Escrow WASM built after dependencies | 0 |
| `backend` | `cargo test --locked -p device-registry -p agent-registry -p payment-escrow --target x86_64-pc-windows-msvc` | 60 passed: 10 device, 21 agent, 29 escrow | 0 |
| repository | `bash -n scripts/redeploy-contracts.sh` | Syntax valid; script was not executed | 0 |
| repository | `bash scripts/tests/propagate-contract-ids.sh` | Synthetic repository's active references update; immutable test/deployment history stays unchanged | 0 |
| `sdk/agent-sdk` | `npm run typecheck` | Clean | 0 |
| `sdk/agent-sdk` | `vitest run tests/security-matrix-support.test.ts` | 52 offline tests passed | 0 |
| `sdk/agent-sdk` | `npm test` | 70 passed; all 19 live tests skipped | 0 |
| `sdk/agent-sdk` | `npm run build` | Public SDK builds; test support remains outside published `src`/`dist` API | 0 |
| `sdk/noir-api` | `npm run typecheck` after the SDK build | Clean | 0 |
| `sdk/noir-api` | `npm test` | 18 passed | 0 |
| `frontend` | `tsc --noEmit` | Clean | 0 |
| `frontend` | `npm test -- tests/05-store.test.ts` | 16 passed with original settings | 0 |
| `frontend` | `npm test` on the subsequent isolated run | 306 passed in 23 files with original settings | 0 |

The initial frontend full run had 305 passes and one 10-second `beforeEach` timeout in `tests/05-store.test.ts > useAppStore > exports a function`. Its dynamic store import did not finish within the hook timeout while other checks were active. The targeted original test and then the complete original suite passed without timeout, worker, source, or configuration changes. Resource contention is a possible explanation, not a proven cause. The existing Vite warning about future native config loading also remains. Neither the warning nor the intermittent hook timeout was hidden by changing test settings.

Contract tests rewrote platform-dependent snapshots. Their generated differences were inspected and restored because those directories were clean before the run. No Rust source or snapshot change is part of this readiness work.

## Runner regressions and safe preflight

- Target validation was written test first: a no-validation placeholder produced 29 failing assertions and 4 passes; all 33 target tests then passed with validation implemented.
- Evidence classification was written test first: a PASS-only placeholder produced 17 failing assertions; all 52 support tests then passed after classification was implemented.
- Tests cover both opt-in paths, missing/empty/invalid/duplicate targets, all three October 7 IDs under any role, complete/missing/duplicate outcomes, failed assertions despite green transaction rows, incomplete setup/final verification, mismatched result text, and missing/malformed accepted transaction evidence.
- Configuration tests use synthetic valid addresses and forbid `fetch`; they do not contact Testnet. Synthetic addresses were never passed to the enabled live runner.
- With all three target variables absent, `npm.cmd run test:security-matrix` on the default Windows shell exited **1 as expected**, reporting `Set NOIR_DEVICE_REGISTRY to a valid explicit contract ID.` before test setup. No live evidence file was created.
- The same named-command preflight using Git Bash as npm's script shell also exited **1 as expected** for the same configuration error, without creating live evidence.
- These expected failures prove the preflight guard, **not** the live security matrix. They are not counted as successful Testnet runs.

The newly merged #27 propagator initially rewrote both test-only historical ID arrays to the new IDs. The synthetic-repository regression reproduced that failure (exit 1) before two exact path exclusions were added. The real script then passed the same check (exit 0), updating neighboring SDK references and full/short hashes while preserving the immutable arrays and dated history. The self-check is included in the existing SDK CI job, with triggers for both propagation scripts. It does not invoke a deployer or change real network configuration.

For the local shell check, portable jq `1.8.1` was obtained from the official jqlang release and verified against its published SHA-256 `23cb60a1354eed6bcc8d9b9735e8c7b388cd1fdcb75726b93bc299ef22dd9334`. It is a temporary verification tool, not a new project dependency.

The runner requires all 20 P/N outcome rows exactly once, successful setup/final verification, no failed tests, matching expected results, and valid hashes for accepted steps before reporting `PASS`. Live acceptance additionally requires Vitest exit 0 and verification that the supplied contracts contain the reviewed WASM. An address checksum and a green row list cannot establish that identity.

## CI and review

The following runs passed for source head `4cee397a5ff05ce1f997328d0424c3b0e574e061` on 2026-10-24:

- [SDK CI](https://github.com/rylsherdamz-rgb/Noir_Wallet/actions/runs/40077053960): synthetic propagation self-check, SDK typecheck/build, 70 SDK tests passed with 19 live tests skipped, gateway typecheck and 18 tests passed. Logs confirm Node `22.23.4` was acquired.
- [Frontend CI](https://github.com/rylsherdamz-rgb/Noir_Wallet/actions/runs/40077053982): frozen dependency installation, typecheck, and all 306 tests passed on Node `22.23.4`.
- Vercel and Vercel Preview Comments also reported success. The landing preview is not evidence of a contract or native app deployment.

An earlier successful SDK run selected cached Node `22.23.3` via `node-version: 22` and emitted engine warnings. Its green result was not accepted as patched-runtime verification; the workflow was pinned and the successful run above replaced it.

Independent focused SDK review and fresh full-branch review found no blocking code issues. The final Node pin was reviewed separately. This documentation-only evidence update records those source-equivalent runs; check the [current PR head checks](https://github.com/rylsherdamz-rgb/Noir_Wallet/pull/28/checks) for subsequent verification. Contract CI was not triggered by these paths; the local locked build and 60 contract tests above provide the source check.

## Built artifacts, not deployed artifacts

SHA-256 values captured locally at `2026-10-24T07:50:44Z`:

| WASM | SHA-256 |
|---|---|
| `device_registry.wasm` | `1d8389f014cf5d513003f144ef68dd64151081461624407a25bf33d25ab37788` |
| `agent_registry.wasm` | `b83d9030f478de280c3fce4eff4c40eee4e31814d8b1ee38719e4a86102be072` |
| `payment_escrow.wasm` | `4524bdcf4b5d6ce5782ac8920fa8ceb57c438b170ad5a69261553787cc477658` |

These identify this build only. Build paths affect WASM bytes, so they are not compared with a historical deployment as a pass/fail gate. There are no new contract IDs, create/init transaction hashes, or new live screenshots to publish from this work.

## Remaining acceptance

The active reference remains the [October 7 pre-fix deployment](deploy-testnet-20261007T050558Z.md). The release owner must separately approve and deploy the fixed artifacts, verify their identity/initialization, run the full matrix on explicit new IDs, propagate accepted IDs, run the frontend live flow, and ship an app that embeds those IDs. Follow the [deferred release handoff](../docs/deployment.md#deferred-issue-24-release-handoff).

Historical screenshots and successful old payments remain historical evidence. Phone/NFC captures require the later native app and approved deployment; SDK `authorize`/`claim` proof is not presented as completed tap-screen functionality.

`graphify update .` was attempted but the CLI is unavailable and no graph index exists. It was not reported as refreshed.
