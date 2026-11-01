#!/usr/bin/env bash
#
# redeploy-contracts.sh — Build, deploy, and initialize the three Noir Wallet
# Soroban contracts, then write an evidence file with the deployed addresses,
# WASM hashes, and Stellar Expert links (for the Instaward evidence package).
#
# Contracts (deploy order matters — escrow is initialized last because it
# needs the agent_registry + device_registry IDs):
#   1. device_registry   initialize(admin)
#   2. agent_registry     initialize(admin, device_registry_id)
#   3. payment_escrow     initialize(admin, agent_registry_id, device_registry_id)
#
# Usage:
#   ./scripts/redeploy-contracts.sh                 # testnet, identity "deployer"
#   NETWORK=testnet DEPLOYER=deployer ./scripts/redeploy-contracts.sh
#   UPDATE_ENV=1 ./scripts/redeploy-contracts.sh    # also rewrite frontend/.env
#
# Env vars:
#   NETWORK     stellar network   (default: testnet)
#   DEPLOYER    stellar identity  (default: deployer) — must be funded
#   UPDATE_ENV  if "1", patch frontend/.env with the new IDs (default: off)
#
set -euo pipefail

# ---- Config -----------------------------------------------------------------
NETWORK="${NETWORK:-testnet}"
DEPLOYER="${DEPLOYER:-deployer}"
UPDATE_ENV="${UPDATE_ENV:-0}"

# Resolve repo paths relative to this script so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSET_DIR="$REPO_ROOT/backend"
WASM_DIR="$ASSET_DIR/target/wasm32v1-none/release"
EVIDENCE_DIR="$REPO_ROOT/deploy-evidence"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_FILE="$EVIDENCE_DIR/deploy-$NETWORK-$TS.md"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$*"; }
die()   { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---- Preflight --------------------------------------------------------------
command -v stellar >/dev/null 2>&1 || die "stellar CLI not found. Install: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli"
command -v cargo   >/dev/null 2>&1 || die "cargo not found. Install the Rust toolchain."
command -v sha256sum >/dev/null 2>&1 || die "sha256sum not found."

# Confirm the deployer identity exists and resolve its address.
if ! ADMIN_ADDR="$(stellar keys address "$DEPLOYER" 2>/dev/null)"; then
  die "stellar identity '$DEPLOYER' not found. Create one with:
       stellar keys generate $DEPLOYER --network $NETWORK --fund
     or import an existing secret:
       stellar keys add $DEPLOYER --secret-key"
fi

bold "Noir Wallet — contract redeploy"
echo "  network  : $NETWORK"
echo "  deployer : $DEPLOYER ($ADMIN_ADDR)"
echo "  wasm dir : $WASM_DIR"
echo "  evidence : $EVIDENCE_FILE"
echo

# ---- 1. Build ---------------------------------------------------------------
info "Building release WASM for all three contracts…"
(
  cd "$ASSET_DIR"
  # payment_escrow contractimport!s the other two WASMs, so they must exist
  # before it compiles — one combined cargo build fails on a clean checkout.
  cargo build --release --target wasm32v1-none -p device-registry -p agent-registry
  cargo build --release --target wasm32v1-none -p payment-escrow
)
ok "Build complete."

for f in device_registry agent_registry payment_escrow; do
  [ -f "$WASM_DIR/$f.wasm" ] || die "expected WASM not found: $WASM_DIR/$f.wasm"
done

# Shrink the WASM with wasm-opt before uploading: upload fees scale with code
# size (~25% smaller, ~22 XLM less on mainnet as of 2026-10-22). The raw
# release WASM stays in place because payment_escrow contractimport!s it.
info "Optimizing WASM…"
OPT_DIR="$WASM_DIR/optimized"
mkdir -p "$OPT_DIR"
for f in device_registry agent_registry payment_escrow; do
  stellar contract optimize --wasm "$WASM_DIR/$f.wasm" --wasm-out "$OPT_DIR/$f.wasm" >/dev/null
done
DEVICE_WASM="$OPT_DIR/device_registry.wasm"
AGENT_WASM="$OPT_DIR/agent_registry.wasm"
ESCROW_WASM="$OPT_DIR/payment_escrow.wasm"
ok "Optimized: $(wc -c < "$DEVICE_WASM") + $(wc -c < "$AGENT_WASM") + $(wc -c < "$ESCROW_WASM") bytes"

# ---- 2. Hash (evidence) -----------------------------------------------------
info "Computing WASM SHA-256 hashes…"
DEVICE_HASH="$(sha256sum "$DEVICE_WASM" | awk '{print $1}')"
AGENT_HASH="$(sha256sum "$AGENT_WASM"  | awk '{print $1}')"
ESCROW_HASH="$(sha256sum "$ESCROW_WASM" | awk '{print $1}')"
ok "device_registry  $DEVICE_HASH"
ok "agent_registry   $AGENT_HASH"
ok "payment_escrow   $ESCROW_HASH"

# ---- 3. Deploy --------------------------------------------------------------
deploy() {
  # $1 = human label, $2 = wasm path
  info "Deploying $1…" >&2
  stellar contract deploy \
    --wasm "$2" \
    --source "$DEPLOYER" \
    --network "$NETWORK"
}

# If anything fails after the first deploy, record which contracts went
# on-chain so they are not lost (they are live but may be uninitialized).
DEVICE_REGISTRY_ID="" AGENT_REGISTRY_ID="" ESCROW_ID="" INITIALIZED=""
on_exit() {
  local rc=$?
  [ "$rc" -ne 0 ] && [ -n "$DEVICE_REGISTRY_ID$AGENT_REGISTRY_ID$ESCROW_ID" ] || return 0
  local partial="$EVIDENCE_DIR/deploy-$NETWORK-$TS.partial.md"
  mkdir -p "$EVIDENCE_DIR"
  printf '# PARTIAL deploy (%s, exit %s) — not usable, redeploy from scratch\n\n- admin: %s\n- device_registry: %s\n- agent_registry: %s\n- payment_escrow: %s\n- initialized: %s\n- WASM SHA-256: device %s, agent %s, escrow %s\n' \
    "$TS" "$rc" "$ADMIN_ADDR" "${DEVICE_REGISTRY_ID:-not deployed}" "${AGENT_REGISTRY_ID:-not deployed}" \
    "${ESCROW_ID:-not deployed}" "${INITIALIZED:-none}" "$DEVICE_HASH" "$AGENT_HASH" "$ESCROW_HASH" > "$partial"
  printf '✗ partial deploy recorded in %s\n' "$partial" >&2
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "evidence=${partial#"$REPO_ROOT"/}" >> "$GITHUB_OUTPUT"
  return 0
}
trap on_exit EXIT

DEVICE_REGISTRY_ID="$(deploy device_registry "$DEVICE_WASM")"
AGENT_REGISTRY_ID="$(deploy agent_registry "$AGENT_WASM")"
ESCROW_ID="$(deploy payment_escrow "$ESCROW_WASM")"

ok "device_registry = $DEVICE_REGISTRY_ID"
ok "agent_registry  = $AGENT_REGISTRY_ID"
ok "payment_escrow  = $ESCROW_ID"

# ---- 4. Initialize (order matters) -----------------------------------------
info "Initializing device_registry…"
stellar contract invoke --id "$DEVICE_REGISTRY_ID" --source "$DEPLOYER" --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDR"
INITIALIZED="device_registry"

info "Initializing agent_registry (admin + device_registry_id)…"
stellar contract invoke --id "$AGENT_REGISTRY_ID" --source "$DEPLOYER" --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDR" --device_registry_id "$DEVICE_REGISTRY_ID"
INITIALIZED="$INITIALIZED agent_registry"

info "Initializing payment_escrow (admin + agent_registry_id + device_registry_id)…"
stellar contract invoke --id "$ESCROW_ID" --source "$DEPLOYER" --network "$NETWORK" -- \
  initialize \
    --admin "$ADMIN_ADDR" \
    --agent_registry_id "$AGENT_REGISTRY_ID" \
    --device_registry_id "$DEVICE_REGISTRY_ID"
INITIALIZED="$INITIALIZED payment_escrow"

ok "All three contracts initialized."

# ---- 5. Explorer links ------------------------------------------------------
explorer() {
  case "$NETWORK" in
    testnet) echo "https://stellar.expert/explorer/testnet/contract/$1" ;;
    *)       echo "https://stellar.expert/explorer/public/contract/$1" ;;
  esac
}

# ---- 6. Write evidence file -------------------------------------------------
mkdir -p "$EVIDENCE_DIR"
cat > "$EVIDENCE_FILE" <<EOF
# Noir Wallet — Contract Deployment Evidence

- **Network:** $NETWORK
- **Deployed (UTC):** $TS
- **Deployer / admin:** \`$ADMIN_ADDR\` (identity: \`$DEPLOYER\`)

## Contract IDs

| Contract | ID | Explorer |
|----------|----|----------|
| device_registry | \`$DEVICE_REGISTRY_ID\` | [$NETWORK]($(explorer "$DEVICE_REGISTRY_ID")) |
| agent_registry | \`$AGENT_REGISTRY_ID\` | [$NETWORK]($(explorer "$AGENT_REGISTRY_ID")) |
| payment_escrow | \`$ESCROW_ID\` | [$NETWORK]($(explorer "$ESCROW_ID")) |

## WASM SHA-256 hashes

| Contract | SHA-256 |
|----------|---------|
| device_registry.wasm | \`$DEVICE_HASH\` |
| agent_registry.wasm | \`$AGENT_HASH\` |
| payment_escrow.wasm | \`$ESCROW_HASH\` |

## Initialization

- device_registry: \`initialize(admin=$ADMIN_ADDR)\`
- agent_registry: \`initialize(admin=$ADMIN_ADDR, device_registry_id=$DEVICE_REGISTRY_ID)\`
- payment_escrow: \`initialize(admin=$ADMIN_ADDR, agent_registry_id=$AGENT_REGISTRY_ID, device_registry_id=$DEVICE_REGISTRY_ID)\`

## Env (paste into frontend/.env)

\`\`\`
EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT=$DEVICE_REGISTRY_ID
EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT=$AGENT_REGISTRY_ID
EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT=$ESCROW_ID
\`\`\`
EOF
ok "Evidence written: $EVIDENCE_FILE"
trap - EXIT   # the full evidence file exists now; no partial record needed
# In GitHub Actions, hand the evidence path and the new IDs to later steps.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "evidence=${EVIDENCE_FILE#"$REPO_ROOT"/}"
    echo "device=$DEVICE_REGISTRY_ID"
    echo "agent=$AGENT_REGISTRY_ID"
    echo "escrow=$ESCROW_ID"
  } >> "$GITHUB_OUTPUT"
fi

# ---- 7. Optional: patch frontend/.env --------------------------------------
if [ "$UPDATE_ENV" = "1" ]; then
  ENV_FILE="$REPO_ROOT/frontend/.env"
  if [ -f "$ENV_FILE" ]; then
    info "Updating $ENV_FILE…"
    set_kv() { # $1=key $2=value
      if grep -q "^$1=" "$ENV_FILE"; then
        sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
      else
        printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
      fi
    }
    set_kv EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT "$DEVICE_REGISTRY_ID"
    set_kv EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT  "$AGENT_REGISTRY_ID"
    set_kv EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT  "$ESCROW_ID"
    ok "frontend/.env updated."
  else
    info "frontend/.env not found — skipping env update (evidence file still has the values)."
  fi
fi

echo
bold "Done. Screenshot the evidence file or the summary below:"
echo "  device_registry = $DEVICE_REGISTRY_ID"
echo "  agent_registry  = $AGENT_REGISTRY_ID"
echo "  payment_escrow  = $ESCROW_ID"
echo "  explorer (device): $(explorer "$DEVICE_REGISTRY_ID")"
echo "  explorer (agent) : $(explorer "$AGENT_REGISTRY_ID")"
echo "  explorer (escrow): $(explorer "$ESCROW_ID")"
