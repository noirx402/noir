# Noir Documentation

Everything a developer needs to reproduce, verify and extend Noir: NFC device registration, constrained delegated payment authorization and an x402 tap-to-pay flow on Stellar Testnet, built on three Soroban contracts and a React Native Android app. Released under the [MIT License](../LICENSE).

## Start here

| I want to… | Read |
|------------|------|
| Install and run everything locally | [Installation guide](installation.md) |
| Deploy my own contracts to Testnet | [Deployment guide](deployment.md) |
| Follow the whole payment flow, with Testnet transactions | [Walkthrough](walkthrough.md) |
| Understand the design | [Architecture](architecture.md) (Mermaid diagrams) |
| Call the contracts | [Smart contract reference](contracts.md) |
| Integrate from my own app (SDK, REST, app module) | [API reference](api-reference.md) |
| Know which NFC tags work and how they are hashed | [Supported NFC hardware](nfc-hardware.md) |
| Run the tests and see what they prove | [Automated test documentation](testing.md) |
| Go deeper on Stellar SDK, auth, events and CI | [Stellar development guide](stellar-development-guide.md) |
| Check deploys and transactions | [`deploy-evidence/`](../deploy-evidence/) · [Evidence pack](Evidence/README.md) |
| See the final Instaward evidence | [Week 4 evidence package](evidence-package.md) · [Demo video shot list](demo-video-script.md) |

## Deliverable 3 — reproducibility evidence

What the SOW's Deliverable 3 asks for, and where each item lives.

| Evidence item | Where | Status |
|---------------|-------|--------|
| MIT-licensed public repository | [`LICENSE`](../LICENSE) · [github.com/noirx402/noir](https://github.com/noirx402/noir) | ✅ |
| Complete source code | [`backend/contracts/`](../backend/contracts/) · [`frontend/`](../frontend/) · [`sdk/`](../sdk/) · [`scripts/`](../scripts/) | ✅ |
| Installation instructions | [installation.md](installation.md) | ✅ |
| Deployment documentation and scripts | [deployment.md](deployment.md) · [`scripts/redeploy-contracts.sh`](../scripts/redeploy-contracts.sh) | ✅ |
| Supported NFC hardware documentation | [nfc-hardware.md](nfc-hardware.md) | ✅ |
| Architecture diagrams | [architecture.md](architecture.md) | ✅ |
| Smart contract documentation | [contracts.md](contracts.md) | ✅ |
| API references | [api-reference.md](api-reference.md) · [`sdk/agent-sdk/README.md`](../sdk/agent-sdk/README.md) · [`sdk/noir-api/README.md`](../sdk/noir-api/README.md) | ✅ |
| Developer documentation | [stellar-development-guide.md](stellar-development-guide.md) · [`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`SECURITY.md`](../SECURITY.md) | ✅ |
| Automated test documentation | [testing.md](testing.md): 60 contract tests, 306 app tests, 36 SDK/gateway tests, CI · [results](../deploy-evidence/test-results-20261021T034015Z.txt) | ✅ |
| Contract IDs, WASM hashes, Testnet tx links | [`deploy-evidence/deploy-testnet-20261024T131024Z.md`](../deploy-evidence/deploy-testnet-20261024T131024Z.md) · [`week2-testnet-flow-…md`](../deploy-evidence/week2-testnet-flow-20261009T044804Z.md) | 🟡 published, but the live deploy predates the Week 4 security fixes — redeploy pending |
| Walkthrough of the NFC delegated payment workflow | [walkthrough.md](walkthrough.md) | 🟡 steps 1–5 and 8 have live evidence; `authorize` / `claim` still to do |
| Demo video | [`assets/noir-demo.mp4`](../assets/noir-demo.mp4) · [`assets/x-demo.mp4`](../assets/x-demo.mp4) · [promo on X](https://x.com/Noirx402/status/2109282993588334632) | ✅ [demo on X](https://x.com/Noirx402/status/2109282993588334632) published 2026-10-11 · 🟡 re-shoot on the redeployed contracts — [shot list](demo-video-script.md) |

## Still to do

Left for later on purpose. The docs above already describe these as not done yet.

- [ ] **Tap → `payment_escrow.authorize` in the app.** Today a tap pays from the agent wallet (`x402.payWithAgent`). Wire the tap screens to `authorize` (agent-signed, nonce per device + agent). The SDK's `authorizePayment` is the reference implementation.
- [ ] **Merchant `claim` in the app.** Show `pending_balance` and a claim action for the receiving wallet.
- [ ] **Escrow deposit entry point.** Link a button to `/agent-fund/<id>?mode=escrow` (the screen and `x402.fundEscrow` already exist).
- [ ] **Redeploy contracts** so the Week 4 security fixes are live ([contracts.md](contracts.md#week-4-security-fixes)); the live deploy has a cross-asset drain and an agent-hijack bug. Then propagate the new IDs ([deployment.md](deployment.md#propagate-new-ids-through-the-docs)) and re-run `npm run test:testnet`.
- [ ] **Live Testnet run of `authorize` + `claim` and every reject case.** The runner is written: `cd sdk/agent-sdk && npm run test:security-matrix` ([testing.md](testing.md#live-security-matrix)). Run it against the new deploy and commit its evidence file.
- [ ] **Physical NTAG213 on a real Android phone**: provisioning, write timeout, ownership screens.
- [ ] **Final demo video**: steps 1–8 of the walkthrough on a real phone.
