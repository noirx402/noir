---
tags: [contract, soroban]
---

# DeviceRegistry

A [[Smart Contracts|Soroban contract]]. Maps hardware device hashes → Stellar wallet addresses.

Source: `backend/contracts/device_registry/src/lib.rs`

## Methods (real signatures — see [[_AI Build Guide - Contracts]])

- `initialize(admin: Address)` — set admin once (`admin.require_auth()`); panics `AlreadyInitialized`
- `register(wallet: Address, device_hash: BytesN<32>, agent: Address)` — `wallet.require_auth()`; panics `AlreadyRegistered`; stores `DeviceInfo{owner, agent, status:0, created_at}` + dense per-wallet index
- `revoke(wallet: Address, device_hash: BytesN<32>)` — `wallet.require_auth()`; owner-only (`NotOwner`); **fully removes** entry + compacts index so hash can be re-registered
- `get_device(device_hash) -> DeviceInfo`
- `wallet_device_count(wallet) -> u32` · `wallet_device_at(wallet, index) -> BytesN<32>`
- `is_authorized(device_hash, agent) -> bool` — device exists & agent matches & status 0
- `get_agent(device_hash) -> Address` · `get_owner(device_hash) -> Address`

`DeviceInfo`: `owner, agent, status (0=active), created_at`. Errors: `AlreadyInitialized=1, DeviceNotFound=2, NotOwner=3, AlreadyRegistered=4`.

> Note: escrow checks [[AgentRegistry]] `is_auth`, not this contract's `agent` field. Keep both in sync.

## Used by

- [[Flow - Device Provisioning]]
- [[soroban.ts]] / [[StellarService]] on the [[Frontend]]

## Deployed IDs

- testnet: `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5`
- mainnet: `CDSURGM4LYYRZ6U4RKBRUQPA7SGLAJZ5XXS65ACYCIU6QOO2NEEA2S45`
