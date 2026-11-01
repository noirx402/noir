# Stellar Wallets Kit module

`noir.module.ts` adds Noir to the
[Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit). It is
written in the kit's conventions (Deno, `deno fmt`, no dependencies, no
polyfills).

- **Patch base:** kit `9db6b36` (v2.8.0, 2026-10-28). It applies cleanly there;
  v2.8.0 only renamed Freighter to Varial and left `ModuleInterface` unchanged.
- **Verified at `6f317cf` (v2.7.1):** `deno test sdk/` (the kit's 28 tests plus
  these 4, 32/32), and `deno check`, `deno lint`, `deno fmt --check` on every
  touched file. Re-run them on v2.8.0 before opening the PR (commands below).
- `npm run test:e2e` in `extension/` runs this module against the real
  extension (passing 2026-11-01).
- The patch leaves out `src/deno.lock`: running the tests adds `@std/assert`
  to it, which upstream's own tests already need and is not ours to commit.

## Opening the PR

```bash
git clone https://github.com/Creit-Tech/Stellar-Wallets-Kit && cd Stellar-Wallets-Kit
git checkout -b feat/noir-wallet-module
git apply /path/to/noir/extension/kit-module/stellar-wallets-kit.patch
cd src && deno test sdk/ \
  && deno check sdk/modules/noir.module.ts sdk/modules/utils.ts \
  && deno lint sdk/modules/noir.module.ts sdk/modules/noir.module.test.ts \
  && deno fmt --check sdk/modules/noir.module.ts sdk/modules/noir.module.test.ts sdk/modules/utils.ts
git checkout src/deno.lock   # test-run noise, keep it out of the PR
git add -A && git commit -m "feat: add Noir wallet module"
gh repo fork --remote && git push -u origin feat/noir-wallet-module
gh pr create -R Creit-Tech/Stellar-Wallets-Kit --title "feat: add Noir wallet module" --body-file /path/to/noir/extension/kit-module/PR_BODY.md
```

Set `productUrl` (step 1 below) in both `extension/kit-module/noir.module.ts`
and the patch first, so the PR ships the store link.

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
   `noir.module.ts` to its store page (it currently points at the Noir site),
   and replace `CHROME_WEB_STORE_URL` in `PR_BODY.md`.
2. Optionally host the icon and use a URL, like most modules
   (`https://stellar.creit.tech/wallet-icons/...`); the module embeds a 1.7 KB
   PNG data URI today, as GHOSTSIG does.
3. Mention in the PR that the module needs no polyfill and that the provider
   follows SEP-43 (that's why it is in `sep43Modules()` too).
