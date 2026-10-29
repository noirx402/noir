# @noirx402/agent-sdk

[![npm](https://img.shields.io/npm/v/@noirx402/agent-sdk)](https://www.npmjs.com/package/@noirx402/agent-sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
![network: Stellar Testnet](https://img.shields.io/badge/network-Stellar%20Testnet-black)

Tap-to-pay on Stellar, from any app. Noir links an NFC card to a constrained
payment **agent**: the card's owner decides which key may spend, which asset,
how much per payment, and until when. This SDK lets your app read those
policies, check a payment before trying it, run the tap-to-pay
`authorize` → `claim` flow, manage the whole card lifecycle, and react to
every change through events or signed webhooks.

Everything lives in Noir's three Soroban contracts, so there's **no Noir
server and no API key**. It runs in Node, the browser and React Native, and it
never handles a user's secret key: writes go through the user's own wallet.

> **Testnet only.** The contracts are deployed to Stellar Testnet and have not
> had a third-party audit. Don't point this at real funds.

**Used by** the [Noir Android app](https://github.com/noirx402/noir/tree/main/frontend)
and the [Noir Chrome extension](https://github.com/noirx402/noir/tree/main/extension),
both of which encode their contract calls with this package.

## Contents

- [Install](#install)
- [How a Noir payment works](#how-a-noir-payment-works)
- [Quick start: accept a Noir tap in a dApp](#quick-start-accept-a-noir-tap-in-a-dapp)
- [Read a policy and check a payment](#read-a-policy-and-check-a-payment)
- [Pay and claim](#pay-and-claim)
- [The card lifecycle](#the-card-lifecycle)
- [Events](#events) · [Webhooks](#webhooks) · [Networks](#networks)
- [React Native](#react-native) · [Troubleshooting](#troubleshooting) · [Develop](#develop)

## Install

```bash
npm install @noirx402/agent-sdk @stellar/stellar-sdk
```

`@stellar/stellar-sdk` (v16) is a peer dependency, so your app and the SDK share
one copy.

**Node:** `^22.23.4`, `^24.22.1` or `>=26.12.1`. These are the releases patched for
the Node2Shell advisory. npm only warns on other versions, but **yarn refuses to
install**. Run `node -v` first if `yarn add` fails with *"The engine "node" is
incompatible"*. Browsers and React Native are unaffected.

## How a Noir payment works

```
 card owner                         agent key                    merchant
 ──────────                         ─────────                    ────────
 registerDevice (tag → wallet)
 registerAgent  (cap, asset, expiry)
 fundEscrow     (XLM into escrow)
                        ── card is tapped ──▶ authorizePayment ──▶ pending balance
                                                                   claim ──▶ XLM
 unlinkDevice   (escrow comes back)
```

- **Device hash:** the 64-character hex SHA-256 of the NFC tag's UID. It's the
  only thing the chain knows about the card.
- **Agent:** a Stellar key the owner delegates to. It can only spend from that
  device's escrow, and only within its policy.
- **Asset:** a Soroban token contract ID. On Testnet that's native XLM's Stellar
  Asset Contract (see below).
- **Amounts:** `bigint` in stroops (1 XLM = 10,000,000). Use `toStroops` and
  `fromStroops` instead of floats.

Getting the values the examples use:

```ts
import { Asset, Networks } from '@stellar/stellar-sdk'
import { NoirAgentClient } from '@noirx402/agent-sdk'

const noir = new NoirAgentClient()                        // Testnet by default
const asset = Asset.native().contractId(Networks.TESTNET) // XLM's token contract
const deviceHash = '…'                                    // from the tap (64 hex chars)
const agent = (await noir.getPolicy(deviceHash))?.agent   // the card's agent key
```

## Quick start: accept a Noir tap in a dApp

```ts
import { NoirAgentClient, noirExtensionSigner, walletSigner, toStroops, fromStroops } from '@noirx402/agent-sdk'

const noir = new NoirAgentClient()

// Who signs: the Noir extension…
const merchant = await noirExtensionSigner()
// …or any wallet from the Stellar Wallets Kit (Freighter, xBull, Lobstr, Noir, …)
// const { address } = await StellarWalletsKit.getAddress()
// const merchant = walletSigner(StellarWalletsKit, address)

const check = await noir.checkPayment({ deviceHash, agent, asset, amount: toStroops('2.5') })
if (!check.ok) throw new Error(`Card refused: ${check.reason}`)

console.log(fromStroops(await noir.getPendingBalance(merchant.publicKey)), 'XLM to claim')
await noir.claim({ merchant, token: asset })
```

| Helper | Does |
|---|---|
| `noirExtensionSigner()` | connects to the Noir browser extension (one approval per site) and returns a signer |
| `noirExtension()` | the extension's `window.noir.stellar` provider, or `null` when it isn't installed |
| `walletSigner(wallet, address)` | wraps any SEP-43 wallet: the Stellar Wallets Kit, Freighter's API, `window.noir.stellar` |
| `keypairSigner(secret)` | a signer from a secret key, for servers and agents that hold their own key |
| `toStroops('1.5')` / `fromStroops(15000000n)` | exact conversion between XLM strings and stroops (7 decimals, no floats) |

## Read a policy and check a payment

```ts
const policy = await noir.getPolicy(deviceHash)
// { agent: 'G…', maxAmount: 50000000n, asset: 'C…', expiresAt: Date | null } or null

const check = await noir.checkPayment({ deviceHash, agent, asset, amount: 10_000_000n })
// { ok: true } or { ok: false, reason: 'no_agent' | 'wrong_agent' | 'wrong_asset'
//   | 'invalid_amount' | 'over_limit' | 'expired' | 'insufficient_escrow' }
```

`checkPayment` asks the contract's own `check_payment`, so it can never
disagree with what `authorize` will enforce. Reads need no account and no signer.

| Method | Returns |
|---|---|
| `getPolicy(deviceHash)` | the agent policy, or `null` |
| `getDeviceOwner(deviceHash)` | owner wallet address, or `null` |
| `getDeviceAgent(deviceHash)` | agent recorded in `device_registry`, or `null` |
| `listDevices(wallet)` | device hashes registered to a wallet |
| `getEscrowBalance(deviceHash)` | escrowed amount (`bigint`, smallest unit) |
| `getEscrowToken(deviceHash)` | token the escrow is bound to, or `null` before the first fund |
| `getPendingBalance(merchant)` | what the merchant can claim |
| `checkPayment({...})` | `{ ok }` or `{ ok: false, reason }` |

## Pay and claim

Writes take a **signer**: anything with `publicKey` and
`signTransaction(xdr, { networkPassphrase })`. That's the Freighter and
Stellar Wallets Kit shape, so a connected browser wallet works as-is and the
secret key never reaches this SDK.

```ts
import { keypairSigner } from '@noirx402/agent-sdk'

// The agent key spends from the device's escrow, within its policy.
const { hash } = await noir.authorizePayment({
  agent: keypairSigner(process.env.AGENT_SECRET!),
  deviceHash, merchant, asset, amount: 10_000_000n,
})

// The merchant collects everything pending.
await noir.claim({ merchant: walletKitSigner, token: asset })
```

Refusals throw `NoirContractError` with the contract's own error name:

```ts
import { NoirContractError } from '@noirx402/agent-sdk'

try {
  await noir.authorizePayment({ /* … */ })
} catch (e) {
  if (e instanceof NoirContractError && e.errorName === 'InsufficientBalance') askOwnerToTopUp()
  else throw e
}
```

| Contract | Errors |
|---|---|
| `deviceRegistry` | `DeviceNotFound`, `NotOwner`, `AlreadyRegistered` |
| `agentRegistry` | `AgentNotFound`, `AlreadyRegistered`, `InvalidPolicy`, `NotOwner` |
| `paymentEscrow` | `InsufficientBalance`, `AgentNotAuthorized`, `NotDeviceOwner`, `NothingToClaim`, `DuplicateAuth`, `AgentStillActive`, `DeviceNotRegistered`, `InvalidAsset`, `InvalidRecipient`, `InvalidAmount` |

## The card lifecycle

`execute(signer, op)` runs any Noir write. The signer is the acting account:
the agent for `authorize`, the merchant for `claim`, and the device owner for
everything else. In call order:

```ts
// 1. Link the tag to the wallet with its agent key.
await noir.execute(ownerWallet, { kind: 'registerDevice', deviceHash, agent })
// 2. Give the agent a constrained policy (maxAmount 0n = no cap, expiresAt null = never).
await noir.execute(ownerWallet, {
  kind: 'registerAgent', deviceHash, agent, asset,
  maxAmount: 50_000_000n, expiresAt: new Date('2027-01-01'),
})
// 3. Fund the card, or take some back.
await noir.execute(ownerWallet, { kind: 'fundEscrow', deviceHash, token: asset, amount: 100_000_000n })
await noir.execute(ownerWallet, { kind: 'defundEscrow', deviceHash, token: asset, amount: 20_000_000n })
// 4. Stop the agent without unlinking the card.
await noir.execute(ownerWallet, { kind: 'revokeAgent', deviceHash })
```

An escrow is bound to the token it was first funded with. Any other token is
refused with `InvalidAsset`.

**Unlinking a card.** Never send `revokeDevice` while the escrow holds funds:
the escrow finds its owner through `device_registry`, so the funds would be
stranded. `unlinkDevice` runs the safe order (revoke the agent, then
`sweepOnRevoke` returns the whole escrow, then revoke the device) and picks up
where it left off if a step failed:

```ts
const { escrowReturned } = await noir.unlinkDevice({ owner: ownerWallet, deviceHash })
```

**Signing somewhere else** (a hardware key, another service, your own
transaction pipeline): split it in two.

```ts
const unsignedXdr = await noir.prepare(ownerAddress, op) // simulated, fees set
const hash = await noir.submit(signedXdr)                 // waits for confirmation
```

Or just take the contract call and build the transaction yourself:

```ts
import { toCall } from '@noirx402/agent-sdk'

const { contract, method, args } = toCall(ownerAddress, op)
// contract: 'deviceRegistry' | 'agentRegistry' | 'paymentEscrow'
// method:   e.g. 'fund_escrow'; args: xdr.ScVal[] in the contract's order
```

## Events

| Type | Fields |
|---|---|
| `device.registered` / `agent.registered` | `deviceHash`, `agent` |
| `device.revoked` / `agent.revoked` | `deviceHash` |
| `escrow.funded` / `escrow.defunded` / `escrow.swept` | `deviceHash`, `amount` |
| `payment.authorized` | `deviceHash`, `merchant`, `amount` |
| `payment.claimed` | `merchant`, `amount` |

Each also carries `id` (unique), `contractId`, `ledger`, `ledgerClosedAt` and `txHash`.

```ts
const stop = noir.watch({
  types: ['payment.authorized'],
  merchant: myMerchantAddress,
  onEvent: (e) => markOrderPaid(e),
})

const { sequence } = await noir.server.getLatestLedger()
const lastDay = await noir.pastEvents(sequence - 17_000) // RPC keeps about 7 days
```

## Webhooks

Run a relay that POSTs each event to your endpoint, signed with HMAC-SHA256:

```ts
import { startWebhookRelay } from '@noirx402/agent-sdk'

startWebhookRelay(noir, { url: 'https://your.app/noir-hook', secret, deviceHash })
```

Your endpoint receives `{ "event": { ... } }` (amounts as decimal strings) with
an `X-Noir-Signature: t=<unix>,v1=<hex>` header. Verify it against the **raw**
body before trusting anything:

```ts
import { verifyWebhookSignature } from '@noirx402/agent-sdk'

if (!(await verifyWebhookSignature(secret, rawBody, req.headers['x-noir-signature']))) return 401
```

Deliveries older than 5 minutes are rejected (replay protection). Delivery is
at-least-once, with retries on network errors, 429 and 5xx, so dedupe on
`event.id`. Ready-to-run examples are in [`examples/`](https://github.com/noirx402/noir/tree/main/sdk/agent-sdk/examples):
`check-and-pay.ts`, `webhook-relay.ts` and `webhook-receiver.ts`.

Apps that can't run JavaScript, or want API keys and rate limits in front of
Noir, can use the REST gateway in [`sdk/noir-api`](https://github.com/noirx402/noir/tree/main/sdk/noir-api).

## Networks

The Testnet deployment is built in as `TESTNET`:

| Contract | Testnet ID |
|---|---|
| `device_registry` | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` |
| `agent_registry` | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` |
| `payment_escrow` | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` |

A contract redeploy mints new IDs, and a new SDK version ships them (see the
[changelog](./CHANGELOG.md)). For your own deployment, or to pin IDs yourself:

```ts
new NoirAgentClient({
  network: { rpcUrl, networkPassphrase, contracts: { deviceRegistry, agentRegistry, paymentEscrow } },
})
new NoirAgentClient({ rpcUrl: 'https://your-rpc.example' }) // Testnet IDs, your own RPC
```

## React Native

The SDK itself has no Node-only code, but stellar-sdk v16 needs two fixes in
React Native (this is how the Noir app does it, in `frontend/src/services/stellar-service.ts`):

- **XDR encoding.** `TransactionBase.toXDR()` produces comma-separated bytes
  instead of base64 under Hermes. Wrap it in `Buffer.from(...).toString('base64')`.
- **HTTP.** Import stellar-sdk from `@stellar/stellar-sdk/axios` so requests go
  through XMLHttpRequest.

If you'd rather keep your own transport, use `toCall` for the encoding and
`parseContractError` for the errors, and submit with your existing code.
`startWebhookRelay` and `verifyWebhookSignature` need `crypto.subtle`, which
React Native doesn't have. They're meant for servers anyway.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `yarn add` fails: *engine "node" is incompatible* | Your Node is outside the supported range. See [Install](#install). |
| `deviceHash must be 32 bytes of hex` | Pass the SHA-256 of the tag UID as 64 hex characters, not the raw UID. |
| `NoirContractError … AgentNotAuthorized` | No agent, wrong agent key, over the cap, or expired. Call `checkPayment` first for the exact reason. |
| `NoirContractError … InvalidAsset` | The escrow is bound to a different token than the one you passed. Check `getEscrowToken`. |
| Reads return `null` for a card you just linked | You're on a different deployment. Compare `noir.contracts` with the IDs above. |

## Develop

```bash
npm test                      # unit tests
npm run test:testnet          # live reads, a refused claim and event paging on Testnet
npm run test:security-matrix  # every contract refusal, live on Testnet
npm run build
```

## License

[MIT](./LICENSE)
