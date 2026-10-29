# Installation Guide

Set up Noir from a clean machine: build and test the Soroban contracts, then run the React Native Android app against the deployed Testnet contracts. To deploy your own copy of the contracts, continue with the [Deployment guide](deployment.md).

Tested on Linux x86_64. macOS works for the contracts and the app; see the note on `backend/.cargo/config.toml` below.

## Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| Git | any | Clone the repo |
| Rust (rustup) | toolchain `1.98.1` + `wasm32v1-none`, pinned by [`backend/rust-toolchain.toml`](../backend/rust-toolchain.toml) and installed automatically by rustup | Contracts |
| Stellar CLI | 23+ (developed on 28.0.0) | Deploy and invoke contracts |
| Node.js | 22+ (CI uses 22, developed on 26) | App, SDK, tests |
| Java JDK | 17 | Android build |
| Android SDK | platform tools (`adb`) and the SDK platform Expo 57 asks for | Android build |
| Android phone with NFC | NFC hardware switched on | NFC provisioning and taps. **An emulator has no NFC**, and the stock emulator image does not trust `*.stellar.org`'s certificate chain, so use real hardware for anything networked |
| NTAG213 tags | 1 or more | See [NFC hardware](nfc-hardware.md) |

Install Rust and the Stellar CLI:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --locked stellar-cli      # or see https://developers.stellar.org/docs/tools/cli
```

## 1. Clone

```bash
git clone https://github.com/noirx402/noir.git
cd noir
```

| Path | What it is |
|------|------------|
| `backend/contracts/` | The three Soroban contracts (Rust) |
| `frontend/` | React Native / Expo Android app |
| `sdk/agent-sdk/` | TypeScript SDK for other apps (`@noirx402/agent-sdk`) |
| `sdk/noir-api/` | Self-hosted REST gateway |
| `scripts/` | `redeploy-contracts.sh` and helpers |
| `deploy-evidence/` | Deploy records: contract IDs, WASM hashes, transactions |
| `docs/` | This documentation |

## 2. Build and test the contracts

`payment_escrow` imports the other two contracts' WASM at compile time, so build them in this order:

```bash
cd backend

cargo build --release --target wasm32v1-none -p agent-registry -p device-registry
cargo build --release --target wasm32v1-none -p payment-escrow

# Tests run on the host target
HOST=$(rustc -vV | awk '/host/{print $2}')
cargo test -p device-registry -p agent-registry -p payment-escrow --target "$HOST"
```

Expected result: `10 passed` (device_registry), `17 passed` (agent_registry), `18 passed` (payment_escrow), 0 failed. The WASM files land in `backend/target/wasm32v1-none/release/`.

> [!NOTE]
> `backend/.cargo/config.toml` sets the default build target to `x86_64-unknown-linux-gnu`. On macOS or ARM Linux, always pass `--target "$HOST"` as shown above, or edit that file to your host triple.
>
> `cargo test` rewrites the JSON files in `backend/contracts/*/test_snapshots/`. The content does not change; discard them with `git checkout -- backend/contracts/*/test_snapshots`.

## 3. Install the app

```bash
cd frontend
npm install          # CI uses `yarn install --frozen-lockfile`; either works
cp .env.example .env
```

`.env.example` already points at the live Testnet contracts:

| Variable | Value |
|----------|-------|
| `EXPO_PUBLIC_STELLAR_NETWORK` | `testnet` |
| `EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT` | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` |
| `EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT` | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` |
| `EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT` | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` |
| `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_KEY` | Optional backend for notifications; the NFC payment flow does not need it |
| `EXPO_PUBLIC_TERMINAL_ID`, `EXPO_PUBLIC_TERMINAL_PUBLIC_KEY`, `EXPO_PUBLIC_ISSUER_ADDRESS` | Optional; leave empty for the reference flow |

If you deployed your own contracts, put your IDs here instead (`UPDATE_ENV=1` on the deploy script does it for you).

Verify the install:

```bash
npx tsc --noEmit     # type check, no output when clean
npm test             # Vitest unit tests: 306 passed
```

## 4. Run the app on an Android phone

NFC needs native code, so **Expo Go does not work**. Build a development client:

1. On the phone, enable Developer options → USB debugging, and turn on NFC.
2. Connect it over USB and check `adb devices` lists it.
3. Build, install and start Metro:

```bash
cd frontend
npx expo run:android          # first build takes several minutes
```

Later runs only need `npx expo start` while the dev client is installed.

**No build machine?** Install the prebuilt APK from the [Beta-Testing release](https://github.com/noirx402/noir/releases/tag/Beta-Testing) (`app-release.apk`). It uses the same Testnet contracts.

Then follow the [walkthrough](walkthrough.md) to create a wallet, link a tag and run the payment flow.

## 5. Optional: SDK and REST gateway

```bash
cd sdk/agent-sdk && npm install && npm test     # 18 passed; 4 live tests skipped unless NOIR_TESTNET=1
cd ../noir-api  && npm install && npm test      # 18 passed
```

Usage is in [API reference](api-reference.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `error: couldn't read …/agent_registry.wasm` when building `payment_escrow` | Build `agent-registry` and `device-registry` first (step 2). |
| `cargo test` tries to build for `wasm32v1-none` or the wrong host | Pass `--target "$HOST"`; see the `.cargo/config.toml` note. |
| App says NFC is unavailable | Expo Go, or an emulator. Use `npx expo run:android` on a real phone with NFC switched on. |
| Network requests fail in the Android emulator | The emulator image does not trust the Stellar Testnet certificate chain. Use a real phone. |
| `Account … does not exist` | Fund the wallet. The app funds new Testnet wallets with Friendbot; you can also use `https://friendbot.stellar.org/?addr=G…`. |
| Contract calls fail with `MissingValue` or wrong IDs | `.env` points at contracts that no longer exist. Copy the IDs from the newest `deploy-evidence/deploy-testnet-*.md`. |

Next: [Deployment guide](deployment.md) · [Walkthrough](walkthrough.md)
