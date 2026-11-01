# Noir — Google Play listing

Package: `com.noirx402.wallet` · Play Console app "Noir" (developer account Rylsher).
Regenerate the graphics with `store/play/build.sh`.

## Graphics

| Play Console field | File |
|--------------------|------|
| App icon (512×512) | `icon-512.png` |
| Feature graphic (1024×500) | `feature-graphic-1024x500.png` (source: `src/feature-graphic.html`) |
| Phone screenshots (1080×1920, 8) | `screenshots/01-wallet.png` … `08-activity.png` |
| Promo video (YouTube URL) | upload `promo/videos/noir-wallet-promo/renders/noir-wallet-promo-with-voice.mp4` to YouTube |

## App name

Noir

## Short description (80 max)

Tap-to-pay Stellar wallet: link an NFC card and set spending limits.

## Full description (4000 max)

Noir is a self-custody Stellar wallet built around tap-to-pay. Link a simple NFC card or sticker to your wallet, give it a spending limit, and pay by tapping — no unlocking, no copying addresses.

Noir currently runs on the Stellar Testnet. Everything uses free test XLM, so you can try every feature without spending real money.

TAP TO PAY WITH NFC
• Link an NFC card or sticker (NTAG213) to your wallet in a few seconds
• Each card gets its own agent wallet with rules you set: a maximum amount per payment, which asset it can spend, and when it expires
• Top up a card, tap to pay, and withdraw what's left whenever you want
• Unlink a card at any time and its remaining balance returns to you automatically

ACCEPT PAYMENTS
• Merchant mode turns your phone into a point of sale: enter an amount and let the customer tap their card
• Every payment comes with a receipt you can save or share

SEND AND RECEIVE
• Send XLM and Stellar assets by address, QR code, or by tapping a recipient's card
• Show a QR code to receive payments
• Full transaction history with details for every payment

YOUR KEYS, YOUR WALLET
• Create a new wallet or import one with your recovery phrase
• Your keys never leave your phone and are stored in secure device storage
• Protected by your wallet password, with optional fingerprint or face unlock

BUILT ON OPEN CONTRACTS
Card registration, spending limits and payments are enforced by open-source Soroban smart contracts on Stellar, not by a company server. Noir is open source under the MIT license.

Noir is an independent project and is not affiliated with the Stellar Development Foundation.

## App access (reviewer instructions)

Restricted features to tick: QR codes, biometric authentication, actions carried out on another device.

> No login or account is needed. On first launch tap **Create wallet**, set any password, and confirm the recovery phrase. The wallet runs on the Stellar **Testnet** and is funded with free test XLM; no real money is used. Phone (biometric) unlock is optional and off by default. Linking a card and tap-to-pay need an NFC tag (NTAG213); every other feature — send, receive, QR scan — works without one.
