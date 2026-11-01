---
tags: [runbook, contracts, deploy, memory]
aliases: [Redeploy, Redeploy Contracts, Deploy Runbook]
---

# 🚀 Redeploy Contracts — Runbook

> Reference commands for redeploying the Soroban contracts after code changes. **Do not run automatically** — this is a manual runbook. Linked from [[_Context - What We Are Building]] and [[Smart Contracts]].

Contracts: [[DeviceRegistry]] · [[AgentRegistry]] · [[PaymentEscrow]]
Location: `backend/` · WASM target: `wasm32v1-none` · CLI: `stellar` v28 (soroban merged in)
Cargo package names: `device-registry`, `agent-registry`, `payment-escrow`

## 0. Prereqs (one-time)

```bash
# Configure an identity to deploy with (funded on the target network)
stellar keys generate deployer --network testnet --fund
# or import an existing secret:
# stellar keys add deployer --secret-key
export DEPLOYER=deployer
export ADMIN_ADDR=$(stellar keys address $DEPLOYER)
```

## 1. Build all WASM (release)

```bash
cd backend
cargo build --release --target wasm32v1-none \
  -p device-registry -p agent-registry -p payment-escrow
```

Optional sanity check + WASM hashes for evidence:

```bash
cargo check -p device-registry -p agent-registry -p payment-escrow
sha256sum target/wasm32v1-none/release/device_registry.wasm \
          target/wasm32v1-none/release/agent_registry.wasm \
          target/wasm32v1-none/release/payment_escrow.wasm
```

## 2. Deploy each contract to testnet

```bash
DEVICE_REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/device_registry.wasm \
  --source $DEPLOYER --network testnet)

AGENT_REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/agent_registry.wasm \
  --source $DEPLOYER --network testnet)

ESCROW_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/payment_escrow.wasm \
  --source $DEPLOYER --network testnet)

echo "device_registry = $DEVICE_REGISTRY_ID"
echo "agent_registry  = $AGENT_REGISTRY_ID"
echo "payment_escrow  = $ESCROW_ID"
```

## 3. Initialize (order matters — agent_registry needs device_registry id, escrow needs both)

```bash
stellar contract invoke --id $DEVICE_REGISTRY_ID --source $DEPLOYER --network testnet -- \
  initialize --admin $ADMIN_ADDR

stellar contract invoke --id $AGENT_REGISTRY_ID --source $DEPLOYER --network testnet -- \
  initialize --admin $ADMIN_ADDR --device_registry_id $DEVICE_REGISTRY_ID

stellar contract invoke --id $ESCROW_ID --source $DEPLOYER --network testnet -- \
  initialize --admin $ADMIN_ADDR --agent_registry_id $AGENT_REGISTRY_ID \
  --device_registry_id $DEVICE_REGISTRY_ID
```

Since the Week 4 fixes (2026-10-21) `agent_registry.initialize` takes the
`device_registry_id` (it checks device ownership there).

## 4. Wire the new IDs into the app

Update `frontend/.env` (and `.env.example` if IDs are meant to be public):

```
EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT=<DEVICE_REGISTRY_ID>
EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT=<AGENT_REGISTRY_ID>
EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT=<ESCROW_ID>
```

Also update the Contract IDs table in `README.md` and record WASM hashes + Stellar Expert links for the [[_SCF Instaward - Deliverables & Constraints]] evidence package.

## 5. Verify

```bash
# Look up a registered wallet, check escrow balance, etc.
stellar contract invoke --id $DEVICE_REGISTRY_ID --network testnet -- get_wallet --device_hash <HASH>
stellar contract invoke --id $ESCROW_ID --network testnet -- balance_of --device_hash <HASH>
```

Explorer: `https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>`

## Notes

- **Redeploy = new Contract IDs** unless you use `stellar contract install` + `upgrade` for a code-upgrade pattern. If the contracts have an `upgrade` entrypoint, prefer upgrading to preserve state and IDs; otherwise a fresh deploy resets state and requires re-init + re-wiring the app.
- Current testnet IDs live in `frontend/.env.example` and `README.md`.
- For **mainnet**, swap `--network testnet` for `--network mainnet` and use a funded mainnet key — mainnet is **out of Instaward scope**.
