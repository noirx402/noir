# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Design system

All UI follows `DESIGN.md` (wallet-app conventions, logo rules, tokens, shared
components in `components/ui`, `components/popup`, `components/brand`). The
"Noir Wallet Screens" design canvas is the visual reference — update it with
every UI change. Never hand-roll buttons, headers, lists, popups or loaders,
and never use `Alert.alert`.

# Stellar Service (`src/services/stellar-service.ts`)

Unified Stellar/Soroban service used by both the app and the CLI.

**App usage:**
```ts
import { stellarService } from '@/services/stellar-service'

await stellarService.fundAccount(publicKey)          // Friendbot
await stellarService.accountExists(publicKey)         // Check existence
await stellarService.getBalance(publicKey)            // XLM + tokens
await stellarService.invokeContract({ contractId, method, args, signerSecret })
await stellarService.readContract({ contractId, method, args, source })
await stellarService.registerDevice({ contractId, deviceHashHex, walletSecret })
await stellarService.waitForAccount(publicKey)        // Poll until on-chain
```

**CLI (wrapper around the same service):**
```
npm run stellar help
npm run stellar fund <addr>
npm run stellar balance <addr>
npm run stellar invoke <contract> <method> <secret> [type:val...]
npm run stellar register-device <contract> <hash-hex> <secret>
```
Network: `STELLAR_NETWORK=mainnet` for mainnet (default: testnet).

# Known stellar-sdk v16 issues

**1. Auth issue**: `prepareTransaction` doesn't auto-populate `sorobanAuth` entries for contracts using `wallet.require_auth()`. Transactions fail with `sceAuth` error. The simulation returns no auth entries, so the prepared transaction lacks authorization.

**2. XDR serialization bug**: `@stellar/stellar-sdk` v16's `TransactionBase.toXDR()` calls `this.toEnvelope().toXDR().toString('base64')`. In React Native, js-xdr v4's `.toXDR()` returns a native `Uint8Array` whose `.toString('base64')` is ignored — it produces comma-separated byte values instead of base64. The RPC then fails with "Could not unmarshal transaction."

**Fix**: `stellar-service.ts` monkey-patches `TransactionBase.prototype.toXDR` to wrap the bytes in `Buffer.from()` before encoding:

```ts
TransactionBase.prototype.toXDR = function () {
  const raw = this.toEnvelope().toXDR()
  return Buffer.from(raw).toString('base64')
}
```

**4. Ledger-header decoding**: `rpc.Server.getLatestLedger()` decodes the full ledger header XDR, so an SDK older than the network's XDR fails with `XDR Read Error: unknown StellarValueType member for value 3` (Testnet, Nov 2026 — fixed in SDK 16.4.x). Don't call it just to get a ledger number: `invokeContract` reads `simulation.latestLedger` instead. Keep the SDK on the latest 16.x LTS.

**3. HTTP client**: Always import the full SDK from `@stellar/stellar-sdk/axios` (uses real `axios` / XMLHttpRequest instead of feaxios/fetch):

```ts
import { Keypair, TransactionBuilder, Contract, rpc, xdr, ... } from '@stellar/stellar-sdk/axios'
```

