@AGENTS.md

# Noir Wallet — project memory

Read this instead of re-reading the Obsidian vault (`Noir/*.md`) — it's the condensed version.
If you need more depth than this file, read the specific Obsidian note by name, not the whole vault.

## What this is

Open-source reference implementation for the **Stellar Community Fund Instaward** grant
(30 days, capped $5,000, paid in XLM). Shows how to wire NFC device registration +
constrained delegated payment authorization + an x402 tap-to-pay flow on **Stellar
Testnet** using Soroban contracts. Not a consumer wallet competitor. MIT license.

Full binding contract: `Noir/_SCF Instaward - Deliverables & Constraints.md`.
Full vision/scope: `Noir/_Context - What We Are Building.md`.

In scope: Android, one NTAG213 tag, Testnet, 3 contracts, one x402 flow, docs+tests+MIT.
Out of scope: Mainnet, iOS, other NFC hardware, fiat ramp, multisig, multi-chain, audits.

## Workflow rules (binding — read before committing)

- Work happens on `instaward-development` → PR into `instaward` → PR into `main`.
  Never push straight to `main`.
- **Always commit after making changes** (user rule, 2026-10-09) — once the change
  is done and tests/`tsc` pass, commit it on `instaward-development`. Stage only the
  files that change touched (never sweep in unrelated dirty files like `landing/`,
  `promo/` or `.graphify/`). Conventional-commit subject + a body that details what
  changed and why. Committing is not pushing and not a PR — push/PR only when asked.
- **Every commit carries these co-authors** (only people who contribute to the repo):
  ```
  Co-Authored-By: Johnrick Rabara <jrabara101@gmail.com>
  Co-Authored-By: Jefferson Tuparan <jeffersontuparanst@gmail.com>
  ```
- Keep commits scoped: one logical change per commit, mapped where possible to the
  week's Expected Output in `Noir/_SCF Instaward - Deliverables & Constraints.md`.

## Architecture

- **On-chain** (`backend/contracts/`, Soroban/Rust): `device_registry`, `agent_registry`,
  `payment_escrow`. Full function-level reference: `Noir/_AI Build Guide - Contracts.md`
  (source-accurate as of 2026-10-02 — trust the Rust first, this note second).
- **App** (`frontend/`, React Native/Expo/TS): wallet, NFC provisioning, SHA-256 hashing,
  Stellar SDK, x402 orchestration. See `frontend/AGENTS.md` for stellar-sdk v16 gotchas
  (XDR serialization bug, missing sorobanAuth, axios transport).
- **Backend** (`backend/`, Rust Axum): API + PDAX fiat bridge — supporting, out of
  Instaward scope, currently parked.

Call order: `device_registry.register` → `agent_registry.register_agent` (constrained
policy: max_amount/asset/expiry) → `payment_escrow.fund_escrow` → tap →
`payment_escrow.authorize` → `payment_escrow.claim`. Revoke → `sweep_on_revoke` returns
device's full escrow balance to owner.

Build order matters: `agent_registry` + `device_registry` WASM before `payment_escrow`
(it `contractimport!`s them). See `Noir/_Redeploy Contracts.md` for the redeploy runbook.

## Current state (as of 2026-10-24)

- **Deployed Testnet Contract IDs** (current — matches `frontend/.env`):
  - device_registry: `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5`
  - agent_registry: `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV`
  - payment_escrow: `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS`
  - Evidence: `deploy-evidence/deploy-testnet-20261024T131024Z.md` (redeployed
    2026-10-24 with the Week 4 security fixes; WASM SHA-256 hashes listed there). Deployer/admin
    unchanged. Screenshots: `docs/Evidence/week4-security/`.
  - **Every redeploy mints brand-new IDs** (clean slate, not an upgrade). After any
    redeploy, grep the repo for the old IDs and propagate the new ones everywhere
    (README, `frontend/.env` + `.env.example`, `docs/stellar-development-guide.md`,
    `docs/Evidence/README.md`, `Noir/DeviceRegistry.md`/`AgentRegistry.md`/`PaymentEscrow.md`,
    `landing/lib/site.ts`, `sdk/agent-sdk/src/networks.ts`,
    PROGRESS.md). `scripts/redeploy-contracts.sh UPDATE_ENV=1` auto-patches `frontend/.env`
    only — the docs above are manual.
- Contract tests: 60 passing, 0 failed (`cargo test` from `backend/`, 10 + 21 + 29).
  Week 4 security fixes (2026-10-21) are **live** since the 2026-10-24 redeploy. **Breaking:**
  `agent_registry.initialize(admin, device_registry_id)`. Details: `docs/contracts.md#week-4-security-fixes`.
- Live security matrix: `cd sdk/agent-sdk && npm run test:security-matrix` (override IDs with
  `NOIR_DEVICE_REGISTRY`/`NOIR_AGENT_REGISTRY`/`NOIR_PAYMENT_ESCROW`). **PASS** on 2026-10-24
  (`deploy-evidence/week4-security-matrix-20261024T131458Z.md`).
- Frontend: `tsc --noEmit` clean, Vitest 306/306 passing (as of 2026-10-24). SDK 18, gateway 18
  (gateway needs `npm run setup` first — it depends on the built SDK).
  `npm run test:testnet` (opt-in, live Testnet) runs the Week 2 path through the app's own
  `x402` code and writes tx evidence to `deploy-evidence/week2-testnet-flow-*.md` — passing.
- App lock: wallet password is the default unlock; phone unlock is an opt-in toggle
  (`security.deviceUnlockEnabled`, `services/appLock.ts`). No app PIN (`pinLock.ts` is gone).
- **Play Store target:** contract IDs for EAS builds live in `frontend/eas.json`
  (`base` profile) because `frontend/.env` is gitignored — update them there too on
  redeploy. Secrets go in `eas env`, never in eas.json. `app.json` blocks unused
  permissions and sets `allowBackup: false`; keep it that way.
- CI: `contracts.yml` and `frontend.yml` both green on Instaward branches; `sdk.yml` added 2026-10-21. WASM hash
  cross-machine check is informational only (soroban embeds the build host's absolute
  path in the binary, so hashes legitimately differ CI vs local — not a bug).

### Deliverables status — see `PROGRESS.md` for the full weekly checklist

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Soroban contracts (device/agent/escrow registry) | ✅ Week 4 fixes live; redeployed 2026-10-24, security matrix PASS |
| 2 | React Native wallet (Android) | 🟡 register+associate+auth working on Testnet; agent-policy UI, escrow fund/withdraw, safe unlink wired + unit-tested (2026-10-07), Testnet + on-device run pending |
| 3 | Docs & MIT release | 🟡 architecture.md, AI build guide, dev guide, evidence pack started; not finalized |

### Open items (don't re-derive these — just pick up here)

- **Week 4 next steps** are in `docs/evidence-package.md#5-remaining-steps-maintainer-needs-testnet-access-and-a-phone`:
  redeploy ✅ → security matrix ✅ → propagate IDs ✅ → `npm run test:testnet` ✅ (all 2026-10-24)
  → build/publish APK with the new IDs → demo video re-shoot → tag release.
- Week 1–2 Testnet/evidence gaps closed 2026-10-09 (deploy tx hashes, wallet create/import
  screenshots in `docs/Evidence/wallet/`, Week 2 live run). The Android emulator image does
  not trust `*.stellar.org`'s Sectigo chain — use Node or hardware for anything networked.
- NTAG213 provisioning flow still needs on-device testing (NFC write timeout,
  ownership screens, scan animation, taller policy signature sheet).
- Escrow invariant: never call `device_registry.revoke` while escrow > 0 — it
  strands funds. Use `x402.unlinkDevice` (see `Noir/Flow - Escrow Payment.md`).
- `authorize` (tap-to-pay) is Week 3.
- Week 3 (full x402 flow + security test matrix) and Week 4 (final release + evidence
  package + demo video) not started.

## Where to look for more (don't blanket-read the vault)

- `Noir/_AI Build Guide - Contracts.md` — exact function signatures/errors/events for
  all 3 contracts, negative-path list, extension checklist.
- `Noir/_Redeploy Contracts.md` — manual redeploy runbook.
- `Noir/Flow - *.md` — step-by-step flow docs (provisioning, escrow payment, tap-to-pay,
  fiat cash-out).
- `Noir/Session - *.md` — dated session logs if you need the history behind a decision.
- `docs/stellar-development-guide.md` — SDK/auth/events/build/deploy/testing walkthrough.
- `docs/architecture.md` — Mermaid diagrams.
