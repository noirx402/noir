# Stellar Wallets Kit module

`noir.module.ts` adds Noir to the
[Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit). It is
written in the kit's conventions (Deno, `deno fmt`, no dependencies, no
polyfills) and was verified inside a clone of the kit at `6f317cf` (v2.7.1):

- `deno test sdk/` — the kit's 28 tests plus these 4 pass (32/32)
- `deno check`, `deno lint` and `deno fmt --check` pass on every touched file
- `npm run test:e2e` in `extension/` runs this module against the real extension

## Opening the PR

```bash
git clone https://github.com/Creit-Tech/Stellar-Wallets-Kit && cd Stellar-Wallets-Kit
git checkout -b feat/noir-wallet-module
git apply /path/to/noir/extension/kit-module/stellar-wallets-kit.patch
cd src && deno test sdk/ && deno fmt --check sdk/modules/noir.module.ts
```

The patch:

| File | Change |
|---|---|
| `src/sdk/modules/noir.module.ts` | the module (`NoirModule`, `NOIR_ID = "noir"`) |
| `src/sdk/modules/noir.module.test.ts` | Deno tests with a fake provider |
| `src/sdk/modules/utils.ts` | added to `defaultModules()` and `sep43Modules()` |
| `src/deno.json`, `src/build_npm.ts` | `./modules/noir` export |
| `docs/files/wallets/supported-wallets.md` | table row |

Usage once merged:

```ts
import { NoirModule } from "@creit-tech/stellar-wallets-kit/modules/noir";
```

## Before you open it

The maintainers review modules for wallets people can install. Do these first:

1. Publish the extension on the Chrome Web Store, then set `productUrl` in
   `noir.module.ts` to its store page (it currently points at the Noir site).
2. Optionally host the icon and use a URL, like most modules
   (`https://stellar.creit.tech/wallet-icons/...`); the module embeds a 1.7 KB
   PNG data URI today, as GHOSTSIG does.
3. Mention in the PR that the module needs no polyfill and that the provider
   follows SEP-43 (that's why it is in `sep43Modules()` too).
