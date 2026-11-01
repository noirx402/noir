---
tags: [moc, context, memory]
aliases: [Project Context, What We Are Building, Vision]
---

# 🧭 Context — What We Are Building

> Read this first. This note is the durable memory of *what Noir Wallet is*, *why it exists*, and *what "done" means*. Linked from [[Noir Wallet]].

## One-liner

Noir Wallet is an **open-source reference implementation** showing developers how to combine **NFC device registration**, **constrained delegated payment authorization**, and an **x402 payment workflow** on **Stellar** using **Soroban** smart contracts.

It is **not** a consumer wallet competitor (Freighter / Lobstr / Apple Pay). It is a *reproducible developer reference* — smart contracts + a React Native app + docs + tests that others can study, fork, and extend under the MIT License.

## The problem we solve

Stellar has fast, cheap payments and Soroban smart contracts, but there is **no documented end-to-end example** wiring together:

- NFC hardware (device UID → SHA-256 hash → on-chain identity)
- Wallet-to-device association recorded on-chain
- Delegated payment agents constrained by policy (limit, asset, expiry, revocation)
- Escrow-funded instant authorization + batch merchant settlement
- An x402 tap-to-pay flow that produces a verifiable Testnet transaction

Every project reinvents this today. We publish the reusable pattern.

## The end-to-end workflow (the core proof)

Create/import Testnet wallet → provision one NTAG213 tag → register via [[DeviceRegistry]] → authorize a constrained agent via [[AgentRegistry]] → fund escrow via [[PaymentEscrow]] → tap NFC to trigger x402 → complete a Testnet payment within policy → revoke device or agent.

See flows: [[Flow - Device Provisioning]] · [[Flow - Escrow Payment]] · [[Flow - Tap to Pay]] · [[Flow - Fiat Cash-out]]

## Architecture at a glance

- **On-chain** ([[Smart Contracts]], Soroban/Rust): [[DeviceRegistry]], [[AgentRegistry]], [[PaymentEscrow]]
- **App** ([[Frontend]], React Native / Expo / TS): wallet, NFC provisioning, SHA-256 hashing, Stellar SDK, x402 orchestration ([[x402]])
- **Backend** ([[Backend]], Rust Axum): API + PDAX fiat bridge (supporting, out of Instaward scope)

Key on-chain rule: all owner-initiated calls use `wallet.require_auth()`. Agent payments are validated against [[AgentRegistry]] `is_auth`.

## Scope discipline (Instaward)

In scope: Android, one NTAG213 tag, Stellar **Testnet**, the 3 contracts, one full x402 flow, docs + tests + MIT release.

Out of scope: Mainnet deploy, iOS, other NFC hardware, fiat on/off-ramp, multisig, multi-account, multi-chain, merchant dashboards, offline pay, desktop, wearables, third-party audit, marketing.

See [[_SCF Instaward - Deliverables & Constraints]] for the binding delivery contract, and [[_Redeploy Contracts]] for the redeploy runbook.

## Team

- Fullstack: Richie Christian De Guzman
- Backend: Johnrick Rabara
- UI/UX: Jefferson Tuparan (primary SCF contact — jeffersontuparan0@gmail.com)
- Chapter: Philippines
- Repo: https://github.com/noirx402/noir
- Mainnet XLM wallet: `GBLRRNEIJHU7YDJGXK5CC4WVQQWZ2WZCNY6F7ABLZIPNAYP3TDRH323Y`
