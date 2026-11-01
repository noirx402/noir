# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- `payment_escrow`: escrow balances are bound to the token they were funded in. Previously a deposit in any token could be withdrawn in another (cross-asset drain). New errors `InvalidAsset = 9`, `InvalidRecipient = 10`, `InvalidAmount = 11`.
- `agent_registry`: `register_agent` requires device ownership in `device_registry`; `revoke_agent` requires the wallet that granted the policy (`NotOwner = 5`). Previously anyone could replace a device's agent.
- `payment_escrow.authorize` refuses revoked or unregistered devices and policies not granted by the device's current owner.
- Pending merchant payments moved to persistent storage so they cannot expire unclaimed.

### Changed
- **Breaking:** `agent_registry.initialize(admin, device_registry_id)`. `AgentPolicy` gains `owner`; `Payment` gains `asset`.
- `scripts/redeploy-contracts.sh` builds the escrow after its dependencies and passes the new init argument.

### Added
- Live Testnet security matrix: `npm run test:security-matrix` in `sdk/agent-sdk`.
- `sdk.yml` CI for the agent SDK and REST gateway.
- Week 4 evidence package (`docs/evidence-package.md`) and demo video shot list (`docs/demo-video-script.md`).
- Demo video on X (https://x.com/Noirx402/status/2109282993588334632), linked from the README and the evidence docs.
- Week 2 evidence captures (`docs/Evidence/week2-evidence/`).
- Vercel Web Analytics on the landing site (synced from `main`, #21).
- Open-source community docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- GitHub issue templates (bug report, feature request) and a pull request template.
- Web-based pubmat editor (`promo/pubmat/editor.html`) — live text editing, logo upload, accent-color and aspect-ratio controls, and PNG export.
- Brand-exact promotional material and a Playwright render pipeline under `promo/pubmat/`.

## [1.0.0] - 2026-07-25

### Added
- x402 zero-interaction tap-to-pay flow — wallet debited on hardware tap, no unlock/app/confirm.
- Three Soroban smart contracts: `device_registry`, `agent_registry`, `payment_escrow`.
- Wallet-authorized device registration via `wallet.require_auth()`.
- Per-device x402 agent wallets with independent balances.
- Escrow-based instant settlement with batch merchant claims.
- NFC device provisioning directly from the app.
- React Native (Expo 57) mobile app for iOS and Android with the noir/gold design system.
- PDAX fiat-bridge integration (optional PHP cash-out).
- Testnet deployment of all three contracts.

[Unreleased]: https://github.com/noirx402/noir/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/noirx402/noir/releases/tag/v1.0.0
