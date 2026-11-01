# API Reference

Noir exposes four integration layers. Pick the one that fits your app. All of them end up calling the same three Soroban contracts.

| Layer | Use it when | Reference |
|-------|-------------|-----------|
| **Soroban contracts** | You call the chain directly (Rust, any Stellar SDK, the CLI) | [Smart contract reference](contracts.md) |
| **App `x402` module** | You fork or extend the React Native wallet | [Below](#app-x402-module) · [`frontend/src/domain/x402.ts`](../frontend/src/domain/x402.ts) |
| **`@noirx402/agent-sdk`** | A JS/TS app (Node 22.23.4+, browser, React Native) reads policies, checks payments, runs `authorize` → `claim`, or watches events | [Below](#typescript-sdk-noirx402agent-sdk) · [`sdk/agent-sdk/README.md`](../sdk/agent-sdk/README.md) |
| **Noir REST gateway** | A non-JS app, or you want API keys, scopes, rate limits and webhooks | [Below](#rest-gateway-sdknoir-api) · [`sdk/noir-api/README.md`](../sdk/noir-api/README.md) |

Shared conventions: `deviceHash` is the 64-hex-char SHA-256 of the tag UID string ([how](nfc-hardware.md#how-a-tag-becomes-a-device_hash)). Amounts are in the asset's smallest unit (stroops; 1 XLM = `10000000`). Nothing in any layer holds or sends a user's secret key to a server.

---

## App `x402` module

`import { x402 } from '@/domain/x402'` is the orchestration layer the wallet screens use. It keeps per-device **agent wallets** (keypairs in SecureStore, linked to a device hash) and wraps every contract call. Source of truth: [`frontend/src/domain/x402.ts`](../frontend/src/domain/x402.ts). Unit tests: `frontend/tests/01-x402.test.ts`.

### Agent wallets (local)

| Method | Does |
|--------|------|
| `createAgent({ label?, deviceHash? })` | New agent keypair in SecureStore, optionally linked to a device |
| `listAgents()` / `getAgent(index)` / `hasAgent()` | Read local agents |
| `getAgentIndexForDevice(deviceHash)` | Agent linked to a device, or `null` |
| `resolveAgentIndex(deviceHash, agentPublicKey?)` | Find a card's agent: stored link → stored key → HD re-derivation; re-links it |
| `linkAgentToDevice(index, deviceHash)` | Persist the device ↔ agent link |
| `getAgentBalanceXlm(index)` | Agent account XLM balance (Horizon) |
| `topUpAgent(amountXlm, fromSecret, index)` | Owner → agent wallet payment |
| `payWithAgent({ agentIndex, … })` | Pay from the agent wallet (current tap path; see the note below) |
| `sweepAgentFunds(destination, index)` / `retireAgent(index, owner)` | Move an agent's funds out and retire it |

### On-chain operations

| Method | Contract call(s) |
|--------|------------------|
| `registerDeviceAndAgentOnChain({ deviceHashHex, … })` | `device_registry.register` → `agent_registry.register_agent`, waiting for finality between them; skips steps already on-chain |
| `registerDeviceOnChain` / `revokeDeviceOnChain` | `device_registry.register` / `revoke` |
| `registerAgentOnChain` / `revokeAgentOnChain` | `agent_registry.register_agent` / `revoke_agent` |
| `fundEscrow({ … })` | `payment_escrow.fund_escrow`, refused client-side for an unlinked tag |
| `withdrawEscrow({ … })` | `payment_escrow.defund_escrow` |
| `unlinkDevice({ … })` | Safe unlink: `revoke_agent` → `sweep_on_revoke` → `device_registry.revoke`, so escrow is never stranded |
| `getDeviceOwnership(deviceHashHex, walletPub)` | `{ status: 'free' }` or `{ status: 'mine' \| 'other', owner, agent, createdAt, active }` from `device_registry.get_device` |
| `getAgentChainStatus(deviceHashHex, agentPub, source)` | Device and policy status for the UI |
| `getAgentPolicy(deviceHashHex, source)` | `agent_registry.get_policy` |
| `getEscrowBalance(deviceHashHex, source)` | `payment_escrow.balance_of` (`bigint`) |
| `getPendingBalance(merchantAddress)` | `payment_escrow.pending_balance` |
| `getOnChainDevices(walletAddress)` | `wallet_device_count` + `wallet_device_at` |

Errors: `DeviceNotLinkedError`, `DeviceOwnedByOtherWalletError`, `InsufficientFundsError`, and contract errors mapped to text by [`contractErrors.ts`](../frontend/src/domain/contractErrors.ts).

> [!NOTE]
> **Tap-to-pay status.** In the app today, a tap resolves the card's agent and pays with `payWithAgent`: a standard Stellar payment from the per-device agent wallet. The escrow path, `payment_escrow.authorize` on tap followed by merchant `claim`, is implemented and tested in the contracts and in the SDK (`authorizePayment` / `claim`), but **is not yet wired into the app's tap screens**. That is tracked in the [to-do list](README.md#still-to-do).

---

## TypeScript SDK (`@noirx402/agent-sdk`)

```bash
npm install @noirx402/agent-sdk @stellar/stellar-sdk
```

```ts
import { NoirAgentClient, keypairSigner, toStroops } from '@noirx402/agent-sdk'

const noir = new NoirAgentClient()                        // Testnet contract IDs built in

const policy = await noir.getPolicy(deviceHash)           // { agent, maxAmount, asset, expiresAt } | null
const check  = await noir.checkPayment({ deviceHash, agent, asset, amount: toStroops('1') })
// { ok: true } | { ok: false, reason: 'no_agent' | 'wrong_agent' | 'wrong_asset'
//                  | 'invalid_amount' | 'over_limit' | 'expired' | 'insufficient_escrow' }

await noir.authorizePayment({ agent: keypairSigner(AGENT_SECRET), deviceHash, merchant, asset, amount: toStroops('1') })
await noir.claim({ merchant: merchantSigner, token: asset })
```

| Area | Methods |
|------|---------|
| Reads | `getPolicy`, `getDeviceOwner`, `listDevices`, `getEscrowBalance`, `getPendingBalance`, `checkPayment` |
| Writes | `authorizePayment`, `claim`, `execute(signer, { kind: 'registerAgent' \| 'revokeAgent' \| 'fundEscrow' \| 'defundEscrow' \| … })` |
| Split signing | `prepare(source, op)` → sign elsewhere → `submit(signedXdr)` |
| Signers | `keypairSigner(secret)`, `walletSigner(kit, address)` (any SEP-43 wallet), `noirExtensionSigner()` |
| Amounts | `toStroops('1.5')`, `fromStroops(15000000n)` (exact, no floats) |
| Events | `watch({ types, merchant?, deviceHash?, onEvent })`, `pastEvents(fromLedger)`: `device.*`, `agent.*`, `escrow.funded/defunded/swept`, `payment.authorized/claimed` |
| Webhooks | `startWebhookRelay(noir, { url, secret, … })`, `verifyWebhookSignature(secret, rawBody, header)` (HMAC-SHA256, 5-minute replay window) |
| Networks | `new NoirAgentClient({ network: { rpcUrl, networkPassphrase, contracts } })` for your own deploy |

Contract refusals throw `NoirContractError` with the contract's error name (`AgentNotAuthorized`, `DuplicateAuth`, …). Runnable examples: [`sdk/agent-sdk/examples/`](../sdk/agent-sdk/examples/).

---

## REST gateway (`sdk/noir-api`)

A self-hosted, **non-custodial** HTTP gateway. Writes are `prepare` (unsigned XDR) → the caller signs → `submit`.

```bash
cd sdk/noir-api
npm run setup && npm run build
npm run keygen -- my-shop --scopes read,write,webhooks   # prints noir_sk_… once
npm start                                                # :8787, Testnet
```

Auth: `Authorization: Bearer noir_sk_…` (or `X-API-Key`). Scopes are `read`, `write` and `webhooks`. Responses carry `X-RateLimit-*` headers.

| Method & path | Scope | Returns |
|---|---|---|
| `GET /v1/health` | — | `{ ok: true }` |
| `GET /v1/network` | read | RPC URL, passphrase, contract IDs |
| `GET /v1/devices/:hash` | read | `{ deviceHash, owner, policy, escrowBalance }` |
| `GET /v1/devices/:hash/policy` | read | `{ agent, maxAmount, asset, expiresAt }` |
| `GET /v1/wallets/:address/devices` | read | `{ devices }` |
| `GET /v1/merchants/:address/pending` | read | `{ pending }` |
| `POST /v1/payments/check` | read | `{ ok }` or `{ ok: false, reason }` |
| `GET /v1/events` | read | `{ events, cursor, latestLedger }` |
| `POST /v1/transactions/prepare` | write | `{ xdr, networkPassphrase, operation }`; `kind` is `authorize`, `claim`, `registerAgent`, `revokeAgent`, `fundEscrow` or `defundEscrow` |
| `POST /v1/transactions/submit` | write | `{ hash }` once confirmed |
| `POST` / `GET` / `DELETE /v1/webhooks` | webhooks | Manage signed webhook subscriptions |

Errors are `{ "error": { "code", "message", "contractError"? } }` with 400 / 401 / 403 / 404 / 422 (`contract_refused`) / 429 / 502. The full request bodies and the webhook format are in [`sdk/noir-api/README.md`](../sdk/noir-api/README.md).

The same SDK and API docs are published on the project site under `/docs` ([`landing/app/docs/`](../landing/app/docs/)).

Related: [Contract reference](contracts.md) · [Architecture](architecture.md)
