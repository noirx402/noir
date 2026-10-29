# Deployment Guide

Deploy your own copy of the three Noir contracts to Stellar Testnet, point the app at them, and record verifiable evidence. Finish the [Installation guide](installation.md) first.

> [!IMPORTANT]
> Every deploy creates **new contract IDs**. It is a clean slate, not an upgrade: devices, policies and escrow balances on the old contracts are not carried over.

## 0. Create a funded deployer identity

```bash
stellar keys generate deployer --network testnet --fund   # creates and funds via Friendbot
stellar keys address deployer                             # G… — becomes the contracts' admin
```

To reuse an existing key: `stellar keys add deployer --secret-key`.

## Option A — scripted (recommended)

[`scripts/redeploy-contracts.sh`](../scripts/redeploy-contracts.sh) builds, hashes, deploys and initializes all three contracts in the right order, then writes an evidence file.

```bash
./scripts/redeploy-contracts.sh                      # testnet, identity "deployer"
UPDATE_ENV=1 ./scripts/redeploy-contracts.sh         # also patch frontend/.env with the new IDs
NETWORK=testnet DEPLOYER=myid ./scripts/redeploy-contracts.sh
```

| Step | What it does |
|------|--------------|
| 1. Build | `agent_registry` + `device_registry` WASM, then `payment_escrow` |
| 2. Hash | SHA-256 of each `.wasm`, for the evidence file |
| 3. Deploy | `stellar contract deploy` for each WASM |
| 4. Initialize | `device_registry.initialize(admin)` → `agent_registry.initialize(admin, device_registry_id)` → `payment_escrow.initialize(admin, agent_registry_id, device_registry_id)` |
| 5. Evidence | Writes `deploy-evidence/deploy-<network>-<UTC timestamp>.md` with IDs, hashes, Stellar Expert links and a ready-to-paste `.env` block |
| 6. Env (optional) | With `UPDATE_ENV=1`, rewrites the three `EXPO_PUBLIC_*_CONTRACT` lines in `frontend/.env` |

### From GitHub Actions (redeploy + APK release)

[`redeploy-release.yml`](../.github/workflows/redeploy-release.yml) does the whole release from the Actions tab (**Redeploy contracts + release APK → Run workflow**):

1. Checks out `base_branch` (default `instaward-development`) and runs the preflight checks: the previous deploy must resolve (`propagate-contract-ids.sh --check`), and no `redeploy/testnet-*` branch may be left on origin (merge the last ID PR, then delete its branch). It then runs the contract tests and `scripts/redeploy-contracts.sh` on Testnet. The evidence file is saved as a run artifact, so it survives a later failure. If the script fails partway, it writes a `.partial.md` record of the contracts that did go on-chain.
2. **Acceptance gate:** a separate job, with no secrets, a read-only token and no stored git credentials (it runs third-party npm code), runs the [guarded security matrix](testing.md#deferred-release-owner-only) against the three new IDs. It requires Vitest exit code 0 and a report that says `**Status: PASS**` (all 20 outcomes exactly once) and lists exactly the three IDs just deployed ([`scripts/check-matrix-report.sh`](../scripts/check-matrix-report.sh)). If the gate fails, the run stops: no IDs are propagated, no PR is opened and no APK is built. The deploy evidence and the report are pushed to a `redeploy/testnet-<timestamp>-rejected` branch, because those contracts are live on Testnet. The same happens if a later step fails or the run is cancelled after the deploy. The ID-propagation job re-checks the report and the evidence file in its own fresh checkout before it changes anything. Preflight then blocks the next run until that branch is reviewed and deleted.
3. [`scripts/propagate-contract-ids.sh`](../scripts/propagate-contract-ids.sh) replaces the previous deploy's contract IDs and WASM hashes with the new ones. It reads the previous deploy from `frontend/eas.json` and checks every value before editing. Records of past runs are left alone: `deploy-evidence/`, `docs/walkthrough.md`, `docs/evidence-package.md` and the `Noir/Session - *` logs. `.github/` is skipped too, because the workflow token cannot push workflow changes, so update the expected hashes in `contracts.yml` by hand.
4. Commits only those files plus the new evidence file and the matrix report, pushes a `redeploy/testnet-<timestamp>` branch and opens a PR into `base_branch`. The PR lists the prose that still needs a hand edit, such as deploy dates and evidence pointers.
5. Checks that the IDs in `frontend/eas.json` have a committed `PASS` matrix report, then builds the `preview` APK on EAS from that branch, so the APK uses the new contracts.
6. Uploads `Noir.apk`, the evidence file and the matrix report to the release (`Beta-Test` by default; it is created as a pre-release if missing), replacing an existing `Noir.apk`. A marked block in the release notes is rewritten with the commit and contract IDs of the APK. The rest of the notes is kept.

Turn off the `redeploy` input to only rebuild the APK from `base_branch`. The same acceptance check applies there: the build is refused unless `deploy-evidence/` holds a `PASS` report for the contract IDs in `frontend/eas.json`. A hand-run report only counts if its `npm run test:security-matrix` command also exited 0.

A rejected run can't be retried on the same contracts. A re-run redeploys from scratch, and the rejected contracts stay recorded on their branch.

One-time setup: add the repository secrets `STELLAR_DEPLOYER_SECRET` (secret key of the funded deployer/admin) and `EXPO_TOKEN` (expo.dev access token). Also add `RELEASE_PR_TOKEN`, a fine-grained PAT with contents and pull-requests write. A PR opened with the default `GITHUB_TOKEN` does not start CI, so the required `test` check never reports on it. Without the PAT, enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**, then close and reopen the ID PR to start its CI.

## Option B — manual

### 1. Build

```bash
cd backend
cargo build --release --target wasm32v1-none -p agent-registry -p device-registry
cargo build --release --target wasm32v1-none -p payment-escrow
sha256sum target/wasm32v1-none/release/*.wasm
```

### 2. Deploy

```bash
W=target/wasm32v1-none/release
DEVICE=$(stellar contract deploy --wasm $W/device_registry.wasm --source deployer --network testnet)
AGENT=$(stellar contract deploy  --wasm $W/agent_registry.wasm  --source deployer --network testnet)
ESCROW=$(stellar contract deploy --wasm $W/payment_escrow.wasm  --source deployer --network testnet)
ADMIN=$(stellar keys address deployer)
```

### 3. Initialize (order matters)

```bash
stellar contract invoke --id $DEVICE --source deployer --network testnet -- initialize --admin $ADMIN
stellar contract invoke --id $AGENT  --source deployer --network testnet -- initialize --admin $ADMIN --device_registry_id $DEVICE
stellar contract invoke --id $ESCROW --source deployer --network testnet -- \
  initialize --admin $ADMIN --agent_registry_id $AGENT --device_registry_id $DEVICE
```

`agent_registry` must receive the `device_registry` ID (it checks device ownership there before accepting or revoking a policy). `payment_escrow` must receive **both** registry IDs. It reads policies from `agent_registry` and owners from `device_registry`. Each `initialize` can run only once (`AlreadyInitialized = 1`).

### 4. Smoke test

```bash
stellar contract invoke --id $DEVICE --source deployer --network testnet --send=no -- \
  wallet_device_count --wallet $ADMIN            # → 0
stellar contract invoke --id $ESCROW --source deployer --network testnet --send=no -- \
  balance_of --device_hash 0000000000000000000000000000000000000000000000000000000000000000   # → "0"
```

## Point the app at the new contracts

1. Set the three IDs in `frontend/.env` (or use `UPDATE_ENV=1`).
2. For EAS / Play Store builds, also update the `base` profile in [`frontend/eas.json`](../frontend/eas.json). `.env` is gitignored, so EAS builds take the contract IDs from there. Secrets go in `eas env`, never in `eas.json`.
3. Restart Metro (`npx expo start -c`). `EXPO_PUBLIC_*` values are inlined at bundle time.
4. Run the live Testnet check against your contracts (see [Testing](testing.md#live-testnet-run)):

```bash
cd frontend && npm run test:testnet
```

## Propagate new IDs through the docs

The script only patches `frontend/.env`. After a redeploy passes live acceptance and should become the public reference deploy, search for all three old IDs and replace active references; preserve dated historical evidence:

```bash
git grep -l CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5
```

Files that carry the IDs: `README.md`, `frontend/.env.example`, `frontend/eas.json`, `docs/*.md`, `docs/Evidence/README.md`, `landing/lib/site.ts`, `sdk/agent-sdk/src/networks.ts`, `PROGRESS.md`.

## Building the Android release

```bash
cd frontend
npx eas build --platform android --profile preview      # installable APK (internal distribution)
npx eas build --platform android --profile production   # Play Store app bundle (AAB)
```

Or build locally with `npx expo run:android --variant release`. [`app.json`](../frontend/app.json) requests only the `NFC` permission (plus what Expo needs), blocks unused permissions and sets `allowBackup: false`. Keep it that way.

## Verifying a deploy

Anyone can check a deploy without trusting this repo:

1. Open each contract ID on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet) and confirm the create and `initialize` transactions.
2. Rebuild the WASM with the pinned toolchain and compare `sha256sum` against the evidence file.

> [!NOTE]
> The WASM hashes reproduce only on the **same build path** (for example the maintainer's machine). `soroban-sdk` embeds the absolute path of the cargo registry in the binary, so a build under a different home directory produces different bytes. CI prints its hashes as an informational report rather than failing on them. See [`PROGRESS.md` → CI Status](../PROGRESS.md#ci-status).

Reference deploy currently in use: [`deploy-evidence/deploy-testnet-20261024T131024Z.md`](../deploy-evidence/deploy-testnet-20261024T131024Z.md) (2026-10-24, Week 4 fixes; [security matrix PASS](../deploy-evidence/week4-security-matrix-20261024T131458Z.md)). The 2026-10-07 deploy ([`deploy-testnet-20261007T050558Z.md`](../deploy-evidence/deploy-testnet-20261007T050558Z.md)) is retired.

## Deferred issue #24 release handoff

On 2026-10-24 the release owner redeployed the fixed contracts ([deploy record](../deploy-evidence/deploy-testnet-20261024T131024Z.md)), ran the guarded security matrix against the new IDs ([PASS](../deploy-evidence/week4-security-matrix-20261024T131458Z.md)) and propagated the IDs. The [source-verification record](../deploy-evidence/issue24-source-verification-20261024T075044Z.md) covers the offline phase before that. Steps 1–4 below are done; the APK build/publish (5) and the on-phone evidence (6) remain before [issue #24](https://github.com/noirx402/noir/issues/24) closes.

The combined Actions workflow above runs the guarded security matrix between the deploy and the ID propagation, and stops unless it reports `PASS` for the new IDs (step 2 above). It automates the deploy, the matrix, the ID swap and the APK build in that order. These steps below stay manual:

- approving the source commit (1)
- verifying the deployed artifacts against the build (2)
- the hand pass on the ID PR, rebuilding the SDK/gateway and the frontend live Testnet flow (4)
- checking the installed APK's target and the tester notice (5)
- linking the evidence (6)

The workflow uploads the APK to the release as soon as the matrix passes. Treat that upload as a beta candidate until the manual parts of steps 4–5 are done.

1. Approve the exact source commit and deployment window. Decide how testers will retire the old contracts and balances. A new deployment is a clean slate: it does not migrate device links, policies, pending payments, or escrow balances. Preserve the old deployment records.
2. Build and deploy the reviewed artifacts with the pinned toolchain. Record source SHA, toolchain/build host, public admin address, new IDs, actual deployed WASM hashes, and explorer links for **each create and initialize transaction**. Verify deployed artifacts against that build, accounting for the build-path limitation above; syntax-valid IDs are insufficient. Initialize `device_registry(admin)`, then `agent_registry(admin, device_registry_id)`, then `payment_escrow(admin, agent_registry_id, device_registry_id)` and verify those registry references. The changed agent-registry signature requires the device-registry argument.
3. Pass all three new IDs explicitly to the [guarded SDK security matrix](testing.md#deferred-release-owner-only) before propagation. Require a complete `PASS` report, all 20 outcomes exactly once, and Vitest exit code 0. Keep its transaction/error evidence alongside the deployment record; retain local regression proof for fixes outside the live matrix's coverage.
4. Propagate the accepted IDs together through `frontend/.env`, `frontend/.env.example`, `frontend/eas.json`, `sdk/agent-sdk/src/networks.ts`, `landing/lib/site.ts`, README, current contract/installation/deployment/evidence docs, `PROGRESS.md`, and active `Noir/` deployment notes. Search for all three old IDs to find other consumers, leaving dated historical records intact. Rebuild the SDK/gateway where deployed, restart/rebundle the app, and rerun the frontend live Testnet flow with its separate public-ID configuration.
5. Build and install an Android app containing the accepted IDs; verify its actual target before publishing the APK. Editing `.env` cannot update an installed binary. Publish the new beta build and tester notice retiring the old IDs and explaining any required device relinking.
6. Link the new contract/init pages, complete matrix report and command summary, `authorize`, merchant `claim`, revoke/sweep transaction pages, frontend Testnet summary, and app build/version evidence from the Week 4 docs. Keep simulation refusals as error evidence, without fabricated transaction hashes. Add dated captures under `docs/Evidence/week4-security/` when they exist. Leave the physical NFC demo and broader release/submission work tracked by [#23](https://github.com/noirx402/noir/issues/23).

A phone and NTAG213 are needed only for later physical acceptance with a native Android build. The SDK matrix can validate escrow `authorize` and merchant `claim`; current tap screens and merchant UI do not fully implement those flows.

Next: [Walkthrough](walkthrough.md) · [Contract reference](contracts.md)
