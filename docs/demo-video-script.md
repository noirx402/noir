# Demo Video — Shot List

The Week 4 demo video: one take of the reference workflow on Stellar Testnet, on a real Android phone with one NTAG213 tag. Target length: 5–7 minutes. Every on-chain step ends on its Stellar Expert page, so the video doubles as transaction evidence.

Published so far: the [demo on X](https://x.com/Noirx402/status/2109282993588334632) (2026-10-11, mirrored in [`assets/x-demo.mp4`](../assets/x-demo.mp4)). It was shot before the Week 4 contract fixes; this shot list is for the re-shoot on the redeployed contracts.

## Before recording

- Contracts redeployed with the Week 4 fixes and the new IDs propagated ([evidence-package.md → Remaining steps](evidence-package.md#5-remaining-steps-maintainer-needs-testnet-access-and-a-phone)). A video against the 2026-10-07 contracts would show code with known bugs.
- Release build installed (`npx eas build --platform android --profile preview`), fresh install, Testnet.
- One blank NTAG213 tag. A second phone or a laptop with Stellar Expert open.
- A terminal in `sdk/agent-sdk` for the steps the app does not do yet (marked **SDK** below). Say so on camera. Do not present them as app features.
- Screen recording: `adb shell screenrecord` or scrcpy `--record`. Recovery-phrase screens are `FLAG_SECURE` and record black; that is expected, say so.

## Shots

| # | Show | Say | Proof on screen |
|---|------|-----|-----------------|
| 1 | Repo README, `LICENSE`, `docs/README.md` | "MIT-licensed reference implementation: three Soroban contracts, an Android wallet, an SDK." | GitHub page |
| 2 | Create wallet → set password → Friendbot funding | Wallet create, Testnet | Account on Stellar Expert |
| 3 | Lock and unlock with the wallet password | App lock | — |
| 4 | Link Device → tap the NTAG213 | The UID is hashed (SHA-256) on the phone; only the hash goes on-chain | Scan animation, device hash |
| 5 | Signature sheet: cap 5 XLM, expiry 7 days → sign | `device_registry.register` + `agent_registry.register_agent` with a constrained policy | Both txs on Stellar Expert |
| 6 | Agent Detail: policy read back via `get_policy` | Cap, asset, expiry are on-chain | Agent Detail screen |
| 7 | Fund escrow 20 XLM (`/agent-fund/<id>?mode=escrow`; no button links there yet, open it by deep link) | `payment_escrow.fund_escrow` | Escrow balance, tx |
| 8 | **SDK:** `authorizePayment` 2 XLM to a merchant key, then `claim` | Tap-to-pay authorization and merchant settlement. The app's tap screens are not wired to `authorize` yet. | Both txs, merchant balance |
| 9 | **SDK:** run `npm run test:security-matrix`, open the evidence file | Every reject case: unregistered device, unauthorized agent, over limit, wrong asset, escrow as merchant, replay, hijack, cross-asset, expired, revoked agent, revoked device | `deploy-evidence/week4-security-matrix-*.md` |
| 10 | Second wallet taps the same tag | Refused: "Linked to another wallet", nothing signed | Ownership screen |
| 11 | Unlink device | `revoke_agent` → `sweep_on_revoke` → `revoke`; escrow returns to the owner | Three txs, wallet balance back |
| 12 | `cargo test`, `npm test` output, CI page | 60 contract tests, 306 app tests, CI green | Terminal, Actions tab |

## After recording

- Export 1080p MP4. Commit it as `assets/noir-walkthrough.mp4` if it is under ~50 MB, otherwise upload (YouTube unlisted or a GitHub release asset) and link it.
- Link the video from `README.md`, `docs/README.md` (Demo video row) and `docs/evidence-package.md` (Summary table), and list every tx hash shown in a `deploy-evidence/demo-<date>.md`.
