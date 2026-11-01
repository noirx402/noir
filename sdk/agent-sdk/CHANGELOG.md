# Changelog

## Unreleased

Completes `device_registry` coverage (every public function except the admin-only `initialize`).

- `getDevice(deviceHash)` returns `{ owner, agent, active, createdAt }` (or `null`) from `get_device`.
- `isDeviceAuthorized(deviceHash, agent)` wraps `is_authorized`: linked agent and device active.
- `parseDeviceInfo(scVal)` and the `NoirDeviceInfo` type are exported for apps that read `get_device` themselves.

## 0.3.0

Targets the Week 4 contracts redeployed to Testnet on 2026-10-24. **Upgrade from 0.2.0:**
0.2.0 points `TESTNET` at the retired pre-fix contracts.

- `TESTNET` contract IDs updated to the 2026-10-24 deployment (`device_registry` `CAC4…QHU5`,
  `agent_registry` `CCMZ…EBV`, `payment_escrow` `CC7E…BFS`).
- Contract errors named for the Week 4 fixes: `NotOwner` (agent_registry), `DeviceNotRegistered`,
  `InvalidAsset`, `InvalidRecipient`, `InvalidAmount` (payment_escrow).
- New operations `registerDevice`, `revokeDevice` and `sweepOnRevoke`, so the whole card lifecycle runs
  through `execute`.
- `unlinkDevice({ owner, deviceHash })` removes a device in the only order that never strands escrow.
- `getEscrowToken(deviceHash)` and `getDeviceAgent(deviceHash)` reads.
- Node 22.23.4+ / 24.22.1+ (was documented as 20+).

## 0.2.0

First release on npm as `@noirx402/agent-sdk`.

- `noirExtensionSigner()` connects to the Noir browser extension; `walletSigner(wallet, address)` wraps any SEP-43 wallet (Stellar Wallets Kit, Freighter, `window.noir.stellar`).
- `toStroops` / `fromStroops`: exact 7-decimal amount conversion, no floats.
- `execute(signer, op)` runs every Noir write (`authorize`, `claim`, `registerAgent`, `revokeAgent`, `fundEscrow`, `defundEscrow`); `prepare` / `submit` split signing out.
- `listDevices(wallet)` reads a wallet's registered device hashes.
- Runs in Node 20+, browsers and React Native (no `Buffer`).
- `@stellar/stellar-sdk` is a peer dependency, so your app and the SDK share one copy.

## 0.1.0

- `NoirAgentClient`: read policies, device owners, escrow and pending balances; `checkPayment` through the contract's own `check_payment`.
- `authorizePayment` / `claim` for the tap-to-pay flow, with typed `NoirContractError`s.
- Typed contract events, `watch` / `pastEvents`, and an HMAC-signed webhook relay with `verifyWebhookSignature`.
