# Noir Wallet — SCF Instaward Progress

Tracking document for the **Stellar Community Fund Instaward** (30 days, capped at $5,000, paid in XLM).
This maps every weekly deliverable to its status. Measure every commit against the SOW.

- **Project:** Noir Wallet
- **Team:** Noir
- **Repo:** https://github.com/noirx402/noir
- **Network:** Stellar Testnet
- **Branches:** `instaward` (release), `instaward-staging` (staging), `instaward-development` (active work)

## Workflow Rules (binding)

- Work is delivered on the Instaward branches, **not** by pushing freely to `main`.
- **~One scoped deliverable commit per week.** Keep each commit mapped to that week's Expected Output.
- Do not commit unrelated/experimental files into the deliverable commits.

---

## Deliverables

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Soroban Smart Contract Infrastructure (DeviceRegistry, AgentRegistry, PaymentEscrow) | 🟡 In progress |
| 2 | React Native Reference Wallet (Android) | 🟡 Partially built (pre-existing) |
| 3 | Documentation & Open-Source Release (MIT) | 🟡 Reproducibility docs complete (`docs/README.md`, 2026-10-17); final demo video + live `authorize`/`claim` evidence pending |

---

## Weekly Breakdown

### Week 1 — Contract architecture + RN env + wallet create/import + initial deploy  🟡 IN PROGRESS
**Planned:** Finalize architecture of DeviceRegistry, AgentRegistry, PaymentEscrow. Configure RN Android env, implement wallet create/import, deploy initial contracts to Testnet, document architecture.

**Expected output:** Initial contracts deployed to Testnet; RN project configured; wallet create/import operational; architecture documented.

- [x] Create Instaward branches (`instaward`, `instaward-staging`, `instaward-development`)
- [x] Finalize AgentRegistry constrained-authorization design (max_amount, asset, expiration + revocation)
- [x] Implement constrained authorization policy in AgentRegistry
- [x] Enforce policy in PaymentEscrow.authorize (over-limit / wrong-asset / expired rejection)
- [x] Negative-path tests for both contracts (41 contract tests green)
- [x] Build + test all contracts green
- [x] Deploy updated contracts to Testnet, record Contract IDs + WASM hashes — **DONE** (see `deploy-evidence/`)
- [x] Architecture documentation updated (Obsidian: AgentRegistry.md, PaymentEscrow.md, session note)
- [x] Architecture diagrams published — `docs/architecture.md` (system overview, provisioning, tap-to-pay, revocation)
- [x] Captured test-run output as evidence — `deploy-evidence/test-results-*.txt` (41 passed, 0 failed)
- [x] Reconciled Contract IDs to one evidence-backed set across README, `.env.example`, and the Obsidian notes
- [x] Corrected README contract method tables + build guide to match the Rust source
- [x] Week 1 evidence index — `deploy-evidence/WEEK1-EVIDENCE.md`
- [x] Record deploy-time transaction hashes — create + initialize tx links for the current deploy in `deploy-evidence/deploy-testnet-20261007T050558Z.md` (recovered from Horizon / RPC, 2026-10-09)
- [x] Capture wallet create/import evidence — Android release-build screenshots in `docs/Evidence/wallet/` (import → password → wallet → lock); create path on-chain in the Week 2 Testnet run (phrase screens are FLAG_SECURE by design)

### Week 2 — NFC provisioning + register + association + agent auth + escrow fund (wire app ↔ contracts)  🟡 IN PROGRESS
**Planned:** NTAG213 provisioning; device register via DeviceRegistry; wallet-to-device association; delegated payment agent authorization (with constraints); escrow funding; connect RN app to deployed contracts.

**Expected output:** Functional RN wallet demonstrating register + association + delegated auth + escrow fund on Testnet.

- [ ] NTAG213 provisioning flow in app
- [x] Device register via DeviceRegistry (on-chain association) — verified on Testnet 2026-10-03
- [x] Agent authorization UI passes constraints (limit, asset, expiry) to AgentRegistry — per-payment cap + expiry chosen in the provisioning signature sheet (`buildAgentPolicy`), asset = native XLM SAC; policy read back via `get_policy` on Agent Detail (2026-10-06, unit-tested; Testnet run pending)
- [x] Escrow funding wired to PaymentEscrow — `x402.fundEscrow` → `fund_escrow(token, wallet, device_hash, i128)`, amount picker + live `balance_of` on Agent Detail (2026-10-06, unit-tested; Testnet run pending)
- [x] App ↔ deployed Soroban contracts integration verified on Testnet — the app's own `x402` code ran register + constrained agent → foreign-wallet rejection → fund → withdraw → unlink live (`npm run test:testnet`, evidence `deploy-evidence/week2-testnet-flow-20261009T044804Z.md`, 2026-10-09)

### Week 3 — Full x402 flow + tests + security paths + docs  🟡 IN PROGRESS
**Expected output:** Complete x402 flow validated; automated tests passing; positive/negative security validation; developer docs.

- [x] Developer docs (2026-10-17), indexed in `docs/README.md`: installation, deployment, NFC hardware, smart contract reference, API reference, automated test documentation, walkthrough
- [x] Automated tests passing: 45 contract, 306 app, 18 SDK, 18 REST gateway (2026-10-17); 60 contract after the Week 4 fixes (2026-10-21)
- [x] Positive/negative security matrix covered by contract tests (mapped in `docs/testing.md`)
- [ ] **To do:** wire the tap screens to `payment_escrow.authorize` (today taps pay from the agent wallet via `x402.payWithAgent`)
- [ ] **To do:** merchant `claim` in the app (`pending_balance` + claim action)
- [ ] **To do:** button for the escrow deposit screen (`/agent-fund/<id>?mode=escrow`)
- [ ] **To do:** live Testnet run of `authorize` + `claim` and of the reject cases, with tx evidence — runner written in Week 4 (`npm run test:security-matrix`), waiting on the redeploy
- [ ] **To do:** redeploy so the `fund_escrow` check and the Week 4 security fixes are live; propagate new IDs
- [ ] **To do:** physical NTAG213 on-device test

### Week 4 — Final testing + MIT release + evidence package  🟡 IN PROGRESS
**Expected output:** Public MIT repo; published Contract IDs + WASM hashes + Stellar Expert tx links; install/deploy guides; demo video; evidence package.

Evidence index: [`docs/evidence-package.md`](docs/evidence-package.md).

- [x] Final contract audit + bug fixes (2026-10-21) — cross-asset escrow drain, agent hijack via unchecked `revoke_agent`/`register_agent`, revoked device still payable, unclaimed payments expiring; regression test for each ([`docs/contracts.md#week-4-security-fixes`](docs/contracts.md#week-4-security-fixes)). 60 contract tests.
- [x] `redeploy-contracts.sh` fixed (clean-checkout build order, new `agent_registry.initialize` arg)
- [x] SDK + gateway CI (`sdk.yml`)
- [x] All suites run and captured — `deploy-evidence/test-results-20261021T034015Z.txt` (60 / 306 / 18 / 18, 0 failed)
- [x] Live security-matrix runner — `sdk/agent-sdk` `npm run test:security-matrix` (approved workflow + 12 reject cases, writes tx evidence)
- [x] Public repo under MIT (GitHub detects `MIT`), community docs, install + deploy guides, architecture diagrams
- [x] Demo video shot list — `docs/demo-video-script.md`
- [x] Demo video published — [https://x.com/Noirx402/status/2109282993588334632](https://x.com/Noirx402/status/2109282993588334632) (2026-10-11), linked from the README and the evidence package
- [x] Week 2 evidence captures merged — `docs/Evidence/week2-evidence/` (from `docs/week2-screens`)
- [ ] **To do (needs Testnet):** redeploy the fixed contracts, run the security matrix against the new IDs, propagate IDs, re-run `npm run test:testnet`
- [ ] **To do (needs a phone):** re-shoot the demo video on the redeployed contracts; physical NTAG213 test
- [ ] Tag the final release and submit the evidence package

---

## CI Status

Workflows live in `.github/workflows/`. Both now run on the Instaward branches (`instaward`, `instaward-staging`, `instaward-development`) as well as `main` — previously `frontend.yml` only triggered on `main`, so no Instaward push ever ran CI.

| Workflow | Scope | Status |
|----------|-------|--------|
| `contracts.yml` | Builds all three contracts to `wasm32v1-none`, runs the 41 contract tests on the host target, then prints a WASM SHA-256 reproducibility report (informational) | ✅ Passing |
| `frontend.yml` | `tsc --noEmit` + Vitest (306 tests) on Node 22 | ✅ Passing |
| `sdk.yml` | Agent SDK + REST gateway: typecheck, tests, build (added 2026-10-21) | ⏳ first run on the Week 4 PR |

**Contract tests in CI: passing.** Run [`37019373910`](https://github.com/noirx402/noir/actions/runs/37019373910) executed 17 + 8 + 16 = 41 tests, 0 failures. This satisfies the SOW metric "automated contract tests passing in CI".

**Resolved — WASM hash step is now informational.** The hash-match assertion used to fail CI. Root cause (diagnosed 2026-10-02): Soroban WASM is **not byte-identical across machines**, independent of compiler version. `soroban-sdk` embeds the absolute source path of the build host into the artifact — a panic-location string pointing at `/home/<user>/.cargo/registry/.../soroban-sdk-25.3.1/src/ledger.rs`. On a GitHub runner that prefix is `/home/runner/...`; on the maintainer's machine it is `/home/richie/...`. Different byte string → different WASM → different SHA-256, even under the pinned `1.98.1` compiler.

Evidence of the divergence:
- CI, `@stable`: device `d26fc268…`, agent `f2d55011…`, escrow `8314a126…`
- CI, pinned `1.98.1` (run `37021650785`): device `f531a8e5…`, agent `9b068271…`, escrow `b8883a60…`
- Local, `1.98.1`, clean rebuild: device `2b258a49…`, agent `2c9ee8f6…`, escrow `068ce429…` ✅ matches published `deploy-evidence/`
- Confirmed path embedding: `strings device_registry.wasm | grep /home` → `/home/richie/.cargo/registry/.../soroban-sdk-25.3.1/src/ledger.rs`

Resolution: the toolchain pin (`backend/rust-toolchain.toml` → `1.98.1` + `wasm32v1-none`) is kept, and the `contracts.yml` hash step is demoted to a **non-blocking reproducibility report** (writes a table to the job summary, never exits non-zero). The published hashes remain reproducible on the maintainer's machine (verified by clean local rebuild) and are the authoritative values in `deploy-evidence/`. The SOW gate — automated contract tests passing in CI — is enforced by the build + test steps, which are green.

Rationale: byte-identical cross-machine WASM would require full `--remap-path-prefix` normalization, which would *change* the hashes away from the already-published/deployed values and force a redeploy + evidence rewrite — a larger, misleading change for no SOW benefit. The hash match is an extra reproducibility proof, not a release gate, so it should not hold CI red.

---

## Security Validation Checklist (positive + negative paths)

Accept:
- [x] Registered device accepted (device_registry tests)
- [x] Authorized agent accepted (escrow `test_authorize_in_policy_payment`)
- [x] In-policy payment accepted (escrow `check_payment` + authorize tests)
- [x] Merchant settlement works (escrow `test_claim_payments`)

Reject (all verified by contract tests):
- [x] Unregistered device rejected
- [x] Duplicate device registration handled (`test_duplicate_registration_rejected`)
- [x] Unauthorized agent rejected (`test_unauthorized_agent_rejected`)
- [x] Expired authorization rejected (`test_expired_authorization_rejected`)
- [x] Over-limit payment rejected (`test_over_limit_payment_rejected`)
- [x] Invalid asset rejected (`test_wrong_asset_rejected`)
- [x] Revoked agent rejected (`test_revoked_agent_rejected`)
- [x] Replayed payment request rejected (`test_replayed_nonce_rejected`)
- [x] Sweep rejected while agent still active (`test_sweep_rejected_while_agent_active`)
- [x] On revoke, escrow funds swept back to owner (`test_sweep_on_revoke_returns_all_funds_to_owner`)
- [x] Revoked device rejected by `authorize` (`test_revoked_device_rejected`) — Week 4
- [x] Invalid recipient (escrow itself) rejected (`test_escrow_as_merchant_rejected`) — Week 4
- [x] Stranger cannot revoke/replace an agent (`test_agent_hijack_rejected`, `test_revoke_by_stranger_rejected`) — Week 4
- [x] Cross-asset withdrawal rejected (`test_cross_asset_defund_rejected`, `test_cross_asset_sweep_rejected`) — Week 4
- [x] Unclaimed payments do not expire (`test_late_claim_still_pays`) — Week 4
- [ ] Live Testnet run of all of the above (`npm run test:security-matrix`) — after redeploy

---

## Gap Analysis (as of Week 1 start)

| Contract | Current state | SOW requires | Gap |
|----------|---------------|--------------|-----|
| **device_registry** | register / revoke / lookup / wallet-device index | device registration + wallet association + revocation | ✅ complete |
| **agent_registry** | `AgentMap(device_hash) -> Address`, register / revoke / is_auth | **constrained** auth: max_amount, approved asset, expiration + revocation | ⚠️ no limits/asset/expiry stored |
| **payment_escrow** | fund / authorize (nonce replay guard) / claim / defund | enforce the authorization policy on `authorize` | ⚠️ does not check limit/asset/expiry |

**Week 1 contract work:** extend `agent_registry` to store an authorization policy (max_amount, asset, expiration) and have `payment_escrow.authorize` enforce it. Replay protection (nonce) already exists.

---

## Deployed Contract IDs

### Testnet (redeployed 2026-10-24 — Week 4 security fixes, clean state; WASM hashes in deploy-evidence/deploy-testnet-20261024T131024Z.md)
Admin / deployer: `GA33JXYPD5H3KVYEFDS6DPAHPASEN7QUHSTJ5XU6BG4TUONKXIUB4RDP` (identity `deployer`)
Full evidence (tx links, init args): `deploy-evidence/deploy-testnet-20261024T131024Z.md`
Live security matrix against these IDs: `deploy-evidence/week4-security-matrix-20261024T131458Z.md` — **PASS**

| Contract | ID | WASM SHA-256 |
|----------|----|--------------|
| device_registry | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` | `f2c758eb82b5844b333363b5fd793104106dcafa3f570a5c89d59b4bff580d55` |
| agent_registry | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` | `064024177246a27709854cc1da45b79be363cd99b84f0d2e74b1b841579c84ab` |
| payment_escrow | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` | `e430f8ab443103b75a0821612f8fc91d1e7491ac49b2f1e7ddd7698a8073a0a2` |

> Admin changed from `noir-deployer` (`GCDAAT6G…`) to `deployer` (`GA33JXYP…`) in this redeploy. README and `frontend/.env.example` still list the 2026-10-01 IDs.

<details><summary>Previous: 2026-10-01 (superseded)</summary>

Admin `GCDAAT6G6BUANDLY432YEAFY2MHUDP4PVEQ6ODMKWMUL6THLDY4GY2KD` · evidence `deploy-evidence/deploy-testnet-20261002T235948Z.md`

| Contract | ID |
|----------|----|
| device_registry | `CCSW6R7ATZJNBGNQVXOTQNVBGBAHOSFR2RXUG32DLRU6I2LUQHVJKION` |
| agent_registry | `CBP6KC6IFBQQHOGKVYYDPHXPSHTYUKKHV5EGHSSNPRTJQ6G4M545NFUC` |
| payment_escrow | `CAHYPZNULA67IALHHBWTHDYGXG6DIVQNQGENWLEBMCEH5QS3JVX7DIWH` |

</details>

Redeploy script: `scripts/redeploy-contracts.sh` (build → hash → deploy → initialize → write evidence).

---

## Session Log — 2026-10-21 (Week 4: audit, fixes, evidence package)

- **Contract audit found four exploitable bugs on the live code** (each reproduced by a failing test first):
  - cross-asset drain — fund own device with a self-issued token, `defund_escrow` the same amount in XLM;
  - agent hijack — `revoke_agent` / `register_agent` had no ownership check, so a stranger could install their own agent and `authorize` the owner's escrow away;
  - revoked device still payable via a leftover agent policy;
  - pending payments in temporary storage expired unclaimed with funds already debited.
  Fixed in source, 60 contract tests. **Breaking:** `agent_registry.initialize(admin, device_registry_id)`. Needs a redeploy.
- `redeploy-contracts.sh`: two-step build (one combined build fails on a clean checkout), new init arg.
- SDK + gateway CI added; live security-matrix runner in `sdk/agent-sdk`.
- Evidence index `docs/evidence-package.md`, demo shot list `docs/demo-video-script.md`.
- Not done here: the build environment had no route to Stellar Testnet and no phone, so the redeploy, the live matrix run and the video are left to the maintainer (steps in the evidence package).

## Session Log — 2026-10-09 (Week 1–2 gaps)

- **Week 2 Testnet gate run** — `frontend/testnet/week2-flow.testnet.ts` drives the
  app's `walletService` + `x402` against the deployed contracts with a simulated
  NTAG213 UID; all 5 steps pass. Tx links: `deploy-evidence/week2-testnet-flow-20261009T044804Z.md`.
- **Bugs that run found (fixed):**
  - Registration returned before `register` / `register_agent` were final, so
    provisioning could report success early and an immediate ownership read said
    "free". Both now wait for finality.
  - `fund_escrow` accepted an unregistered device hash; the deposit is then
    unrecoverable (withdraw/sweep resolve the owner via device_registry). The app
    now refuses (`DeviceNotLinkedError`), and the contract fix
    (`DeviceNotRegistered = 8`, 45 contract tests) is committed — **needs a
    redeploy to take effect on Testnet**.
  - `accountExists` cached "missing" for 30s, so a freshly Friendbot-funded wallet
    looked absent; `fundAccount` reported failure on slow Friendbot responses even
    when funding succeeded.
- **Deploy tx hashes** for the current deploy recovered from Horizon/RPC and added
  to `deploy-evidence/deploy-testnet-20261007T050558Z.md`.
- **Wallet create/import** verified at the service level on Testnet (same keys
  after import, account funded) in the same run.
- **App lock:** wallet password is now the default unlock; phone unlock is an
  opt-in toggle (Security). Landing page redesigned to the app's design system.

## Session Log — 2026-10-03 (app ↔ contracts wiring)

Branch `instaward-development`, 8 local commits (not pushed). `tsc` clean, Vitest 226/226.

**Fixes**
- `register_agent` failed with `MismatchingParameterLen` — app sent 3 args, contract takes 6. App now sends the policy args (`max_amount=0`, native XLM SAC, `expires_at=0` → uncapped, no expiry). Verified on-chain via `get_policy`. (`abdd5f4`)
- Provisioning hung on "Writing to NFC tag…" — `writeTag()` had no timeout. Now 15s, optional, reports real result. (`6017c86`)
- Tag owned by another wallet was reported as success (`AlreadyRegistered` swallowed). Now raises `DeviceOwnedByOtherWalletError`; nothing is signed. (`abdd5f4`)
- Payment Agents showed "1 agent" and "No agents yet" at once — orphaned agent keys were counted. Now counts only device-linked agents. (`96928bc`)

**Features**
- Provisioning checks on-chain ownership before the signature prompt, with dedicated "Already linked to you" / "Linked to another wallet" screens, a 4-step progress tracker, and categorized errors. (`4c04e80`)
- Transaction history (Transactions, Dashboard, Blockchain) loads from Horizon via `stellarService.getPaymentHistory` instead of the parked backend; date-grouped, searchable by hash. (`3fe2334`)
- Centered NFC scan pulse (`NfcScanPulse`) on Link Device and Receive. (`ad00137`)
- Layout fixes across 8 screens: keyboard covering forms, overflowing addresses, non-scrolling Receive, small touch targets. (`cc826b1`)

**Week 2 checklist impact**
- Device register via DeviceRegistry — working end-to-end on Testnet.
- Agent authorization passes constraints — wired, but with fixed defaults; no UI yet for limit / asset / expiry.
- Escrow funding — not yet wired (app never calls `fund_escrow`).

**Open**
- Push the local commits.
- Constraint UI for agent policy; wire `fund_escrow` / `authorize`.
- Unlink/revoke flow so a tag can move between wallets.
- Not yet tested on device: NFC write timeout, ownership screens, scan animation.

Update 2026-10-03 (later): README, `frontend/.env.example`, `docs/stellar-development-guide.md`,
and `docs/Evidence/README.md` were still pointing at the 2026-10-01 Contract IDs
(`CCSW6R7A…` / `CBP6KC6I…` / `CAHYPZNU…`) even though `frontend/.env` and the
Obsidian contract notes had already moved to the 2026-10-03 redeploy
(`CAVDDFFT…` / `CCFR7FTY…` / `CBMAP5SO…`). Propagated the current IDs to all
four files; the WASM hashes are unchanged between the two deploys (confirmed
byte-identical in `deploy-evidence/`), so only the IDs needed updating.
`docs/Evidence/` explorer screenshots still show the old IDs in their
filenames (not retaken) — flagged with a note in that file.

## Session Log — 2026-10-06/07 (Week 2: policy UI, escrow, safe unlink, Play Store hardening)

**Done (unit-tested; not yet exercised on Testnet or on hardware)**
- Constrained agent policy in the provisioning Signature Request sheet: max per
  payment (No cap / 10 / 25 / 50 / 100 XLM) + expiry (Never / 7 / 30 / 90 days),
  asset = native XLM SAC. `x402.buildAgentPolicy` mirrors register_agent's
  `InvalidPolicy` checks. Agent Detail reads the policy back via `get_policy`.
- Escrow: `fundEscrow` (reserve-aware pre-check, waits for finality, user
  confirmation), `withdrawEscrow` (`defund_escrow`), `getEscrowBalance` decoded
  correctly (was `Number(ScVal)`) and simulated from the owner wallet.
- **Fund-safety fix — unlink/revoke:** "Revoke Device & Agent" used to revoke the
  agent and the device but never swept escrow. Device revoke deletes the entry,
  so `get_owner` fails afterwards and the escrow was stranded permanently.
  New `x402.unlinkDevice`: revoke_agent → sweep_on_revoke → device revoke,
  read-gated, aborts before the device revoke on any failure, retry-safe.
- **Error-code fix:** registration treated `Error(Contract, #4)` as
  "already registered" for both registries; on agent_registry #4 is
  `InvalidPolicy`, which would have been reported as success. Codes now handled
  per contract; user-facing text centralised in `domain/contractErrors.ts`.
- **Secret leak fix:** `invokeContract` logged the first 8 chars of the signer's
  secret seed via `logger.error` (kept in release builds). Now logs the public key.
- Balance cache no longer caches a failed Horizon load as 0 XLM; invalidated
  after the wallet sends.

**Play Store release hardening**
- `eas.json`: shared `base` profile carries the public Testnet contract IDs —
  `frontend/.env` is gitignored, so EAS cloud builds previously shipped with
  empty contract IDs. Production → `app-bundle`; submit → internal track, draft.
  Secrets (`EXPO_PUBLIC_API_KEY`) must be set with `eas env:create`, not committed.
- `app.json`: `allowBackup: false`; blocked unused permissions (RECORD_AUDIO,
  SYSTEM_ALERT_WINDOW, storage, FOREGROUND_SERVICE[_MEDIA_PLAYBACK],
  MODIFY_AUDIO_SETTINGS). Removed unused `expo-audio` (its media-playback
  foreground service would require a Play Console FGS declaration).

**Tests:** `tsc --noEmit` clean · Vitest 243/243.

**Open**
- Testnet run of provision-with-policy → fund → withdraw → unlink (Week 2 gate).
- On-device NTAG213 check, incl. the taller signature sheet on small screens.
- Store listing prerequisites outside the code: privacy policy URL, Data safety
  form, content rating, release signing via EAS credentials.
- App ships pointed at **Testnet** (Instaward scope); Mainnet is out of scope.
