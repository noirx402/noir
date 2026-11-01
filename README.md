<div align="center">

<img src="frontend/assets/noir-mark.png" width="120" alt="Noir logo">

# Noir Wallet

**Contactless payments powered by Stellar**<br>
Tap any NFC tag, RFID sticker, or wearable to pay — no app opens, no confirmation, just go.

[![Stellar](https://img.shields.io/badge/Stellar-testnet-blue?logo=stellar&logoColor=white)](https://stellar.expert/explorer/testnet)
[![Soroban](https://img.shields.io/badge/Soroban-3%20contracts-blueviolet)](backend/contracts/)
[![Tests](https://img.shields.io/badge/tests-60%20contract%20%7C%20306%20app-brightgreen)](#run-tests)
[![React Native](https://img.shields.io/badge/React%20Native-Expo%2057-61DAFB?logo=expo&logoColor=white)](frontend/)
[![Rust](https://img.shields.io/badge/Rust-nightly-orange?logo=rust&logoColor=white)](backend/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](frontend/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[Docs](docs/README.md) · [View Pitch Deck](ppt/Noir-Wallet-Pitch.pptx) · [Architecture](docs/architecture.md) · [Stellar Dev Guide](docs/stellar-development-guide.md) · [Deployment Evidence](docs/Evidence/README.md) · [PR #10 — Week 1](https://github.com/noirx402/noir/pull/10) · [Run Locally](#getting-started)

</div>

> [!IMPORTANT]
> Noir Wallet is **alpha software on Stellar Testnet**. The x402 tap-to-pay flow, escrow settlement, and constrained agent authorization are implemented and deployed. Mainnet contracts are deployed but **production settlement and PDAX fiat bridge integration are not yet live**. Treat testnet deployments as ephemeral — each redeploy is a clean slate with new contract IDs.

## Screenshots

<div align="center">
<table>
<tr><td align="center"><img src="frontend/assets/screenshots/01-wallet.png" width="160" alt="Wallet"><br><sub>Wallet</sub></td><td align="center"><img src="frontend/assets/screenshots/02-link-card.png" width="160" alt="Link a card"><br><sub>Link a card</sub></td><td align="center"><img src="frontend/assets/screenshots/03-agents.png" width="160" alt="Agents"><br><sub>Agents</sub></td><td align="center"><img src="frontend/assets/screenshots/04-card-detail.png" width="160" alt="Card policy"><br><sub>Card policy</sub></td><td align="center"><img src="frontend/assets/screenshots/05-tap-to-pay.png" width="160" alt="Tap to pay"><br><sub>Tap to pay</sub></td></tr>
<tr><td align="center"><img src="frontend/assets/screenshots/06-receive-nfc.png" width="160" alt="Receive by NFC"><br><sub>Receive by NFC</sub></td><td align="center"><img src="frontend/assets/screenshots/07-send-review.png" width="160" alt="Send"><br><sub>Send</sub></td><td align="center"><img src="frontend/assets/screenshots/08-activity.png" width="160" alt="Activity"><br><sub>Activity</sub></td><td align="center"><img src="frontend/assets/screenshots/09-browse.png" width="160" alt="Browse"><br><sub>Browse</sub></td><td align="center"><img src="frontend/assets/screenshots/10-unlock.png" width="160" alt="Unlock"><br><sub>Unlock</sub></td></tr>
</table>
</div>

## Demo

<div align="center">

<video src="assets/x-demo.mp4" width="100%" controls style="max-width:960px;border-radius:16px;border:1px solid #3A3A3A;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
  Your browser does not support the video tag.
</video>

<em>▶ Demo — tap-to-pay with the x402 protocol, per-device agent wallets, and the full mobile app. [Watch on X](https://x.com/Noirx402/status/2109282993588334632)</em>

<video src="assets/noir-demo.mp4" width="100%" controls style="max-width:960px;border-radius:16px;border:1px solid #3A3A3A;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
  Your browser does not support the video tag.
</video>

<em>▶ A 95-second, Google-style product walkthrough — narrated voiceover, the x402 tap-to-pay flow, per-device agent wallets, and the full mobile app.</em>

</div>

## Project Description

Noir Wallet implements the **x402 protocol** — a zero-interaction payment flow where the wallet is debited immediately upon hardware tap. The user never unlocks their phone, opens an app, or confirms a transaction. The payment terminal reads the device UID, resolves the linked Stellar wallet, and executes the transfer in under 2 seconds.

Built for high-throughput environments: transit turnstiles, campus canteens, event gates, and retail checkout.

## Project Vision

A world where:
- Your wallet is your identity — linked to an RFID sticker, NFC card, or wearable
- Payments happen without friction — no app, no confirmation, no delay
- Settlement is instant — powered by Stellar consensus
- Merchants settle in their preferred currency — via the PDAX fiat bridge

## Key Features

- **Zero-Interaction Payments**: Tap any RFID sticker, NFC card, or wearable to pay instantly
- **x402 Protocol**: Wallet debited on hardware tap — no unlock, no app, no confirmation
- **Stellar-Powered**: Fast, low-cost settlement via the Stellar network
- **Soroban Smart Contracts**: `device_registry` for hardware-to-wallet mapping
- **Wallet-Authorized Registration**: Device owners sign their own registration via `wallet.require_auth()`
- **PDAX Fiat Bridge**: Optional PHP cash-out via PDAX integration
- **Custom Agents**: Per-device agent wallets with independent balances
- **NFC Provisioning**: Link new devices directly from the app
- **Payment Notifications**: Get notified when your wallet or a card receives money, even with the app closed
- **Dark Theme**: Premium noir aesthetic with gold accents
- **Cross-Platform**: React Native Expo app for iOS and Android

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Stellar (testnet / mainnet) |
 | Smart Contracts | Soroban (Rust) — 3 contracts |
| Frontend | React Native, Expo 57, TypeScript |
| Styling | NativeWind, Tailwind CSS |
| State | Zustand |
| NFC | react-native-nfc-manager |
| Wallet SDK | @stellar/stellar-sdk v16 |
| Testing | Vitest |
| Contract Dev | soroban-cli, Rust nightly |

## Architecture

> 📐 **[Full architecture reference](docs/architecture.md)** — rendered diagrams for the system overview, device provisioning, x402 tap-to-pay, and revocation/fund-recovery flows, plus the authorization model and trust boundaries.

```
RFID / NFC Tag
    |
    v
Mobile App / POS Terminal
    |
    ├── NFC read → SHA-256 hash device UID
    ├── x402 Agent (per-device signing key)
    └── Soroban Contracts
           |
           ├── device_registry  ──>  Map device hash → wallet
           ├── agent_registry   ──>  Authorize agent per device
           └── payment_escrow   ──>  Pre-funded escrow → instant authorize
                  |
                  v
           Stellar Network
                  |
           ┌──────┴──────┐
           v             v
     Merchant claim   PDAX Fiat Bridge
     (batch settle)   (PHP Cash-out)
```

### Smart Contracts

 | Contract | Description | Auth | Location |
|----------|-------------|------|----------|
| **device_registry** | Maps hardware device hashes to Stellar wallet addresses | `wallet.require_auth()` | `backend/contracts/device_registry/` |
| **agent_registry** | On-chain agent authorization per device — allows wallet owner to authorize a signing key for tap-to-pay | `wallet.require_auth()` | `backend/contracts/agent_registry/` |
| **payment_escrow** | Escrow-based settlement — wallet pre-funds, agent authorizes payments instantly, merchants claim in batch | agent auth (via `agent_registry`) | `backend/contracts/payment_escrow/` |

**Testnet Contract IDs** (redeployed 2026-10-24 — Week 4 security fixes live; security matrix [PASS](deploy-evidence/week4-security-matrix-20261024T131458Z.md)):

| Contract | ID | WASM SHA-256 | Explorer |
|----------|----|--------------|----------|
| device_registry | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` | `f2c758eb…580d55` | [view](https://stellar.expert/explorer/testnet/contract/CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5) |
| agent_registry | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` | `06402417…1c84ab` | [view](https://stellar.expert/explorer/testnet/contract/CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV) |
| payment_escrow | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` | `e430f8ab…73a0a2` | [view](https://stellar.expert/explorer/testnet/contract/CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS) |

> **About redeployment:** each `./scripts/redeploy-contracts.sh` run deploys **fresh contract instances**, so every deploy produces **new contract IDs** — a redeploy is a clean slate, not an in-place upgrade (prior on-chain state on the old instances is abandoned). The script writes the authoritative IDs, WASM hashes, and init args to a timestamped evidence file in [`deploy-evidence/`](deploy-evidence/), and when run with `UPDATE_ENV=1` it also patches `frontend/.env`. The IDs above are from the latest run ([`deploy-evidence/deploy-testnet-20261024T131024Z.md`](deploy-evidence/deploy-testnet-20261024T131024Z.md)); explorer captures of all three contracts are in [`docs/Evidence/week4-security/`](docs/Evidence/week4-security/README.md), earlier screenshots in [`docs/Evidence/`](docs/Evidence/README.md).

> Full deployment evidence (admin, init args, WASM hashes): [`deploy-evidence/`](deploy-evidence/).

> [!NOTE]
> These IDs run the Week 4 security fixes (cross-asset drain, agent hijack, revoked-device payment, expiring pending payments, unregistered-device funding). The guarded [live security matrix](docs/testing.md#live-security-matrix) passed all 20 outcomes against them, and the app's [live Testnet flow](deploy-evidence/week2-testnet-flow-20261024T131654Z.md) was re-run on them. The 2026-10-07 IDs are retired: they run pre-fix code, and old device links, policies and balances do not carry over. Details: [`docs/contracts.md`](docs/contracts.md#week-4-security-fixes) · [Week 4 evidence package](docs/evidence-package.md).

**Mainnet Contract IDs** (deployed 2026-07-18):

| Contract | ID | Explorer |
|----------|----|----------|
| device_registry | `CDSURGM4LYYRZ6U4RKBRUQPA7SGLAJZ5XXS65ACYCIU6QOO2NEEA2S45` | [view](https://stellar.expert/explorer/public/contract/CDSURGM4LYYRZ6U4RKBRUQPA7SGLAJZ5XXS65ACYCIU6QOO2NEEA2S45) |
| agent_registry | `CDE2Q22BNKHLRNHUXHNL4TYRN5YPCOCO2XD53MAVYG7K2C4KZ2T6NI5T` | [view](https://stellar.expert/explorer/public/contract/CDE2Q22BNKHLRNHUXHNL4TYRN5YPCOCO2XD53MAVYG7K2C4KZ2T6NI5T) |
| payment_escrow | `CCEIB2BLMHK7N7OX23HJ3RCMJBP2NLBMMBGUA6SB5IWJJ6JEWH6ZZPK3` | [view](https://stellar.expert/explorer/public/contract/CCEIB2BLMHK7N7OX23HJ3RCMJBP2NLBMMBGUA6SB5IWJJ6JEWH6ZZPK3) |

### Contract Methods

#### device_registry
| Method | Args | Auth | Description |
|--------|------|------|-------------|
| `initialize` | `admin: Address` | `admin` | Set contract admin (called once) |
| `register` | `wallet: Address, device_hash: BytesN<32>, agent: Address` | `wallet` | Register a device to a wallet with its agent |
| `revoke` | `wallet: Address, device_hash: BytesN<32>` | `wallet` | Remove the device entry (owner only), freeing the hash for re-registration |
| `get_device` | `device_hash: BytesN<32>` | — | Returns `DeviceInfo { owner, agent, status, created_at }` |
| `wallet_device_count` | `wallet: Address` | — | How many devices a wallet has registered |
| `wallet_device_at` | `wallet: Address, index: u32` | — | Enumerate a wallet's device hashes |
| `is_authorized` | `device_hash: BytesN<32>, agent: Address` | — | `true` if the device exists, is active, and maps to this agent |
| `get_agent` | `device_hash: BytesN<32>` | — | Agent for a device |
| `get_owner` | `device_hash: BytesN<32>` | — | Owner for a device |

Errors: `AlreadyInitialized=1`, `DeviceNotFound=2`, `NotOwner=3`, `AlreadyRegistered=4`.

#### agent_registry
| Method | Args | Auth | Description |
|--------|------|------|-------------|
| `initialize` | `admin: Address, device_registry_id: Address` | `admin` | Set admin + link the device registry (called once) |
| `register_agent` | `wallet: Address, device_hash: BytesN<32>, agent: Address, max_amount: i128, asset: Address, expires_at: u64` | `wallet` (must own the device) | Authorize an agent under a constrained policy; replaces a policy left by a previous owner |
| `revoke_agent` | `wallet: Address, device_hash: BytesN<32>` | policy owner | Revoke agent access |
| `get_agent` | `device_hash: BytesN<32>` | — | Look up agent by device hash |
| `get_policy` | `device_hash: BytesN<32>` | — | Returns `AgentPolicy { owner, agent, max_amount, asset, expires_at }` |
| `is_auth` | `device_hash: BytesN<32>, agent: Address` | — | Agent matches and authorization has not expired |
| `check_payment` | `device_hash: BytesN<32>, agent: Address, asset: Address, amount: i128` | — | Full policy predicate: agent + asset + `amount > 0` + within cap + not expired |

`max_amount = 0` means uncapped; `expires_at = 0` means never expires (otherwise an absolute ledger timestamp).

Errors: `AlreadyInitialized=1`, `AgentNotFound=2`, `AlreadyRegistered=3`, `InvalidPolicy=4`, `NotOwner=5`.

#### payment_escrow
| Method | Args | Auth | Description |
|--------|------|------|-------------|
| `initialize` | `admin: Address, agent_registry_id: Address, device_registry_id: Address` | `admin` | Set admin + link both registries |
| `fund_escrow` | `token: Address, wallet: Address, device_hash: BytesN<32>, amount: i128` | `wallet` | Deposit into escrow for a registered device; the first deposit fixes the escrow's token |
| `authorize` | `agent: Address, device_hash: BytesN<32>, merchant: Address, asset: Address, amount: i128, nonce: u64` | `agent` | Instant payment auth, enforced against the agent policy with nonce replay protection |
| `claim` | `token: Address, merchant: Address` | `merchant` | Batch-claim all pending payments |
| `defund_escrow` | `token: Address, device_hash: BytesN<32>, amount: i128` | device owner | Wallet reclaims unused escrow funds |
| `sweep_on_revoke` | `token: Address, device_hash: BytesN<32>, agent: Address` | device owner | After the agent is revoked, return the device's entire escrow balance to the owner |
| `escrow_token` | `device_hash: BytesN<32>` | — | Token the device's escrow is held in (`None` if never funded) |
| `balance_of` | `device_hash: BytesN<32>` | — | Check escrow balance |
| `pending_balance` | `merchant: Address` | — | Check unclaimed payments |

Errors: `AlreadyInitialized=1`, `InsufficientBalance=2`, `AgentNotAuthorized=3`, `NotDeviceOwner=4`, `NothingToClaim=5`, `DuplicateAuth=6`, `AgentStillActive=7`, `DeviceNotRegistered=8`, `InvalidAsset=9`, `InvalidRecipient=10`, `InvalidAmount=11`.

## Project Structure

```
noir/
├── frontend/                # React Native Expo application
│   └── src/
│       ├── screens/         # Dashboard, POS, Device Provisioning, Agents, etc.
│       ├── components/      # BalanceCard, NumericKeypad, ReadyToTap, etc.
│       ├── services/        # Stellar SDK, NFC, API client
│       ├── store/           # Zustand state management
│       ├── hooks/           # useNfc, useProfile, custom hooks
│       ├── lib/             # soroban.ts helpers, x402 auth
│       ├── domain/          # x402 agent logic
│       ├── tasks/           # Background tasks (received-payment alerts)
│       ├── constants/       # Theme (black/gold), network config
│       └── types/           # TypeScript type definitions
├── backend/                 # Soroban smart contracts (Rust)
│   └── contracts/
│       ├── device_registry/
│       ├── agent_registry/
│       └── payment_escrow/
├── assets/                  # Demo video, poster, branding
├── images/                  # Screenshots & diagrams
├── promo/                   # Promotional materials
├── models/                  # ML / design models
├── old/                     # Archived code (backward compat)
├── unused/                  # Parked, not-in-use components
│   └── pdax-backend/        # PDAX fiat-bridge API server (parked — not wired into the app)
└── contextimages/           # Design inspiration and moodboards
```

## Device Provisioning Flow

1. Open the app and tap **Link Device**
2. Hold your NFC tag against the phone
3. App reads the tag UID and writes wallet info to the tag
4. A **signature prompt** appears with transaction details
5. Tap **Sign** — the app SHA-256 hashes your tag UID, calls `device_registry.register()` on Soroban, and polls for confirmation
6. x402 agent wallet is created and funded via Friendbot
7. Wallet owner signs `agent_registry.register_agent()` to authorize the agent for this device
8. Device is linked, agent authorized, and ready for tap-to-pay

## Escrow Payment Flow

1. **Pre-fund:** Wallet owner deposits XLM into `payment_escrow` (one-time, per device)
2. **Tap:** Agent reads NFC → SHA-256 hash → calls `payment_escrow.authorize(merchant, amount)` 
3. **Instant:** Funds are deducted from escrow balance and locked for the merchant — no Horizon submission, no per-tap fee
4. **Settle:** Merchant calls `payment_escrow.claim()` in batch — one transaction claims all pending payments
5. **Reclaim:** Wallet owner can `defund_escrow()` unused balance at any time

## Payment Notifications

Noir Wallet notifies you when money **arrives** at your main wallet or at any card's agent wallet, including when you are not in the app. The app needs no server for this: it reads your accounts' payments from Horizon directly.

| App state | How it checks | Delay |
|-----------|---------------|-------|
| Open | Balances update live on screen; on opening, anything that arrived while you were away is notified | — |
| In the background (still running) | Polls Horizon every 30 seconds | ≤ 30 s |
| Closed or swiped away | `expo-background-task` job (Android WorkManager) | ~15 min or more; Android decides when it runs |

**What notifies:** incoming XLM or asset payments, and `create_account` funding (e.g. Friendbot), from someone else. Each notification reads like *"Received 50.00 XLM — From GSTR…XXX3 to Black card"*.

**What doesn't:** payments you send, failed transactions, and moves between your own accounts (topping up a card from your main wallet, or a card's balance returning to it). Old payments never flood in: the first check for an account only records where it is, and each payment notifies once.

**How it works**

1. `index.ts` (the app entry) imports `src/tasks/paymentTask.ts` before the router, which defines the background task so Android can run it while the app is closed.
2. On launch, `app/_layout.tsx` creates the Android **Payments** notification channel, asks for notification permission, takes a first snapshot of each account, and registers the background task.
3. Every check (`checkIncomingPayments` in `src/services/paymentNotifier.ts`) fetches the latest Horizon payments for the main wallet and each card agent, keeps the ones newer than the last seen `paging_token` (stored per network and account in AsyncStorage), and shows one notification per payment. The filtering and wording live in `src/lib/incomingPayments.ts` and are unit-tested in `tests/17-incoming-payments.test.ts`.

**Limits to know**

- **Closed-app alerts are not real-time.** Android batches background work to save battery; on a phone in Doze it can be longer than 15 minutes. Instant alerts with the app closed need a server that watches Horizon and sends push notifications. The app already registers an Expo push token with the API for that, but no such server is part of this release.
- **Force stop disables it.** If the app is force-stopped in Android settings, background work stops until you open the app again. Some manufacturers (Xiaomi, Huawei, Oppo…) also restrict background apps; allow Noir Wallet to run in the background in battery settings.
- **Native change.** The background task is a native module: rebuild the app (`npx expo prebuild --platform android`, then `npx expo run:android`) after pulling this; a JS reload is not enough.

**Test it:** open the app once so it snapshots your accounts and asks for permission. Leave it in the background and send XLM to your wallet address from another account (e.g. Stellar Laboratory on Testnet); a notification appears within about 30 seconds. To test the closed-app path without waiting, call `BackgroundTask.triggerTaskWorkerForTestingAsync()` from a dev build.

## Getting Started

> [!TIP]
> Full guides: **[Installation](docs/installation.md)** · **[Deployment](docs/deployment.md)** · **[Walkthrough](docs/walkthrough.md)** · **[Contract reference](docs/contracts.md)** · **[API reference](docs/api-reference.md)** · **[NFC hardware](docs/nfc-hardware.md)** · **[Testing](docs/testing.md)**. The summary below is the short version.

### Prerequisites
- Node.js 22.23.4+, 24.22.1+ or 26.12.1+ (patched releases; [`.nvmrc`](.nvmrc) pins 22.23.4)
- Expo CLI (`npm install -g expo-cli`)
- Android device with NFC (or an Android emulator for non-NFC screens)
- Stellar testnet wallet (Freighter extension or custom)
- Rust toolchain + [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) (for contract development)

### Setup

```bash
# Clone and install
git clone https://github.com/noirx402/noir.git
cd noir/frontend
npm install
```

### Environment

Copy `.env.example` to `.env` and configure:

| Variable | Description | Current Value |
|----------|-------------|---------------|
| `EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT` | Soroban device registry contract ID | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` |
| `EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT` | Soroban agent registry contract ID | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` |
| `EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT` | Soroban payment escrow contract ID | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` |
| `EXPO_PUBLIC_STELLAR_MASTER_KEY_ID` | Stellar master key ID | (configure per deployment) |
| `EXPO_PUBLIC_CHANNEL_SECRET_KEY` | Fee channel secret | (configure per deployment) |
| `EXPO_PUBLIC_ISSUER_ADDRESS` | Asset issuer address | (configure per deployment) |
| `EXPO_PUBLIC_PDAX_API_KEY` | PDAX sandbox/prod API key | (optional) |
| `EXPO_PUBLIC_TERMINAL_ID` | x402 Terminal ID | (optional) |

### Run Development Server

```bash
cd frontend
npx expo start
```

NFC needs native code, so Expo Go and emulators can't link or tap cards. On an NFC Android phone, build a development client with `npx expo run:android` (see [Installation](docs/installation.md#4-run-the-app-on-an-android-phone)).

### Smart Contract Development

```bash
cd backend

# Build all WASM (escrow imports the two registries, so build them first)
cargo build --release --target wasm32v1-none -p device-registry -p agent-registry
cargo build --release --target wasm32v1-none -p payment-escrow

# Run checks (host target)
cargo check -p device-registry -p agent-registry -p payment-escrow

# Deploy to testnet (one per contract)
stellar contract deploy \
  --wasm target/wasm32v1-none/release/device_registry.wasm \
  --source <IDENTITY> --network testnet

stellar contract deploy \
  --wasm target/wasm32v1-none/release/agent_registry.wasm \
  --source <IDENTITY> --network testnet

stellar contract deploy \
  --wasm target/wasm32v1-none/release/payment_escrow.wasm \
  --source <IDENTITY> --network testnet

# Initialize contracts
stellar contract invoke --id <DEVICE_REGISTRY_ID> --source <IDENTITY> --network testnet -- \
  initialize --admin <ADMIN_ADDR>

stellar contract invoke --id <AGENT_REGISTRY_ID> --source <IDENTITY> --network testnet -- \
  initialize --admin <ADMIN_ADDR> --device_registry_id <DEVICE_REGISTRY_ID>

stellar contract invoke --id <ESCROW_ID> --source <IDENTITY> --network testnet -- \
  initialize --admin <ADMIN_ADDR> --agent_registry_id <AGENT_REGISTRY_ID> --device_registry_id <DEVICE_REGISTRY_ID>
```

Initialize in this order: device_registry, then agent_registry, then payment_escrow. Or run all of this with `./scripts/redeploy-contracts.sh`; see the [Deployment guide](docs/deployment.md).

### Run Tests

```bash
cd frontend
npm test
```

Contract, SDK and live Testnet tests: see [Testing](docs/testing.md).

## User Feedback

We collected structured feedback from **60 testers** who registered devices, funded escrows, and completed payment flows on Stellar testnet. The results shaped our roadmap — here's what mattered most to them.

**Top requested improvements:**

| Rank | Request | Why it mattered |
|------|---------|-----------------|
| 1 | **Onboarding tutorial** | Step-by-step guide for device provisioning and first payment |
| 2 | **QR code scanner** | Scan wallet addresses on receive and send screens |
| 3 | **Dark mode toggle** | Theme switch for late-night use |
| 4 | **Transaction search & filters** | Find payments by date, amount, or counterparty |
| 5 | **Push notifications** | Payment confirmations and escrow alerts |
| 6 | **Better empty states** | Sample data or guided prompts on first launch |
| 7 | **Haptic feedback** | Vibration on successful NFC tap |
| 8 | **Custom NFC device names** | Rename tags instead of showing hashes |
| 9 | **Multi-currency display** | Show USD/PHP equivalent alongside XLM |
| 10 | **Spending limits per device** | Configurable per-NFC-card budgets |

> 💡 All ten improvements are shortlisted for the v1 roadmap — starting with the onboarding tutorial and NFC device naming.

## Contributing

Contributions are welcome. Before you start, please read:

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, workflow, coding standards, commit & PR conventions
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — community expectations
- **[SECURITY.md](SECURITY.md)** — responsible disclosure for vulnerabilities (do **not** open public issues for security bugs)
- **[CHANGELOG.md](CHANGELOG.md)** — release history

Use the GitHub issue templates to report bugs or request features, and the PR template when opening pull requests.

Promotional assets and a browser-based pubmat editor live in [`promo/pubmat/`](promo/pubmat/README.md).

## Team

| Role | Name |
|------|------|
| Fullstack Developer | Richie Christian De Guzman |
| Backend Developer | Johnrick Rabara |
| UI/UX Designer | Jefferson Tuparan |

## License

MIT
