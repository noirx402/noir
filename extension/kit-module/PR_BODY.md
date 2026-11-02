- **What kind of change does this PR introduce?**

  Feature: a new wallet module, `NoirModule` (`NOIR_ID = "noir"`, `ModuleType.HOT_WALLET`).

- **What is the current behavior?**

  The kit has no module for [Noir](https://noirx402.com), an open-source (MIT) Stellar wallet: a
  Chrome extension plus an Android app that links NFC cards to Soroban contracts for tap-to-pay,
  built under a Stellar Community Fund Instaward.

  - Chrome Web Store: https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl
  - Source: https://github.com/noirx402/noir (extension in `extension/`)

- **What is the new behavior (if this is a feature change)?**

  Noir shows up in the kit's wallet list and can be imported on its own:

  ```ts
  import { NoirModule } from "@creit-tech/stellar-wallets-kit/modules/noir";
  ```

  | File | Change |
  |---|---|
  | `src/sdk/modules/noir.module.ts` | the module |
  | `src/sdk/modules/noir.module.test.ts` | 4 Deno tests against a fake provider |
  | `src/sdk/modules/utils.ts` | added to `defaultModules()` and `sep43Modules()` |
  | `src/deno.json`, `src/build_npm.ts` | `./modules/noir` export |
  | `docs/files/wallets/supported-wallets.md` | table row |

  The extension injects a SEP-43 provider at `window.noir.stellar` (`isNoir: true`) with
  `requestAccess`, `getAddress`, `getNetwork`, `signTransaction`, `signAuthEntry` and
  `signMessage`. Provider calls resolve with the SEP-43 result or with
  `{ error: { code, message } }` and never reject; the module turns that error into a throw.
  `getAddress({ skipRequestAccess: true })` uses `getAddress` instead of prompting.

- **Other information**:

  - No dependencies and no polyfill: the module only talks to the injected provider. It
    follows SEP-43, which is why it is also listed in `sep43Modules()`.
  - The icon is an embedded 1.7 KB PNG data URI, as `GhostsigModule` does. Happy to switch to
    a hosted URL if you prefer.
  - Testing: `deno test sdk/` (existing tests plus the 4 new ones), and `deno check`,
    `deno lint`, `deno fmt --check` on every touched file. The Noir repo also runs this module
    against the real extension in headless Chrome (`npm run test:e2e` in `extension/`:
    connect, sign transaction, sign auth entry, network-mismatch refusal).
  - `src/deno.lock` is left untouched. Running the tests locally adds `jsr:@std/assert`, which
    the existing module tests already import.
