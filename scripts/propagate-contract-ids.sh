#!/usr/bin/env bash
#
# propagate-contract-ids.sh — After a redeploy, replace the previous deploy's
# contract IDs and WASM hashes with the new ones across the repo. Prints the
# files it changed, one per line, on stdout.
#
# It only swaps values. Prose around them (deploy dates, "see <evidence file>",
# status notes) still needs a human pass — the workflow's PR says so.
#
# Usage:
#   ./scripts/propagate-contract-ids.sh deploy-evidence/deploy-testnet-<ts>.md
#   ./scripts/propagate-contract-ids.sh --check   # validate the previous deploy only
#
# Run --check BEFORE deploying: if the previous deploy can't be resolved, the
# post-deploy run would fail too, leaving fresh contracts nobody points at.
#
# The previous deploy is the one frontend/eas.json points at (the EAS build
# reads its contract IDs from there). Records of past runs keep their old
# values: deploy-evidence/, docs/walkthrough.md + docs/evidence-package.md (tx
# links from live runs) and the Noir/Session - *.md logs. .github/ is skipped
# too: the default GITHUB_TOKEN cannot push workflow changes (contracts.yml's
# expected hashes are updated by hand).
# Security-matrix history stays immutable so pre-fix contracts remain blocked.
#
set -euo pipefail

NEW_EVIDENCE="${1:?usage: $0 <new deploy-evidence file> | --check}"
CHECK=0
[ "$NEW_EVIDENCE" = "--check" ] && CHECK=1 NEW_EVIDENCE=""
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
[ "$CHECK" = 1 ] || [ -f "$NEW_EVIDENCE" ] || die "evidence file not found: $NEW_EVIDENCE"

is_id()   { [[ "$1" =~ ^C[A-Z2-7]{55}$ ]]; }
is_hash() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }

# $1 = evidence file, $2 = EXPO_PUBLIC_* key
env_id() { grep -m1 "^$2=" "$1" | cut -d= -f2 || true; }
# $1 = evidence file, $2 = wasm name (e.g. device_registry)
wasm_hash() { grep -m1 "^| $2.wasm |" "$1" | grep -oE '[0-9a-f]{64}' || true; }

KEYS=(EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT)
WASMS=(device_registry agent_registry payment_escrow)

OLD_IDS=() NEW_IDS=()
for k in "${KEYS[@]}"; do
  old="$(jq -r ".build.base.env.$k // empty" frontend/eas.json)"
  is_id "$old" || die "frontend/eas.json: $k is not a contract ID: '$old'"
  OLD_IDS+=("$old")
  [ "$CHECK" = 1 ] && continue
  new="$(env_id "$NEW_EVIDENCE" "$k")"
  is_id "$new" || die "$NEW_EVIDENCE: $k is not a contract ID: '$new'"
  [ "$old" != "$new" ] || die "$k is unchanged ($new) — nothing to propagate"
  NEW_IDS+=("$new")
done

# The previous deploy's evidence file is the one that lists its device ID.
# Exactly one may match — two would leave it ambiguous which hashes are live.
mapfile -t MATCHES < <(grep -l "^${KEYS[0]}=${OLD_IDS[0]}$" deploy-evidence/deploy-*.md || true)
[ "${#MATCHES[@]}" -gt 0 ] || die "no deploy-evidence file lists the current IDs from frontend/eas.json"
[ "${#MATCHES[@]}" -eq 1 ] || die "several deploy-evidence files list the current IDs: ${MATCHES[*]}"
OLD_EVIDENCE="${MATCHES[0]}"
OLD_HASHES=()
for w in "${WASMS[@]}"; do
  h="$(wasm_hash "$OLD_EVIDENCE" "$w")"
  is_hash "$h" || die "$OLD_EVIDENCE: no SHA-256 for $w.wasm"
  OLD_HASHES+=("$h")
done
if [ "$CHECK" = 1 ]; then
  echo "ok: previous deploy is $OLD_EVIDENCE (${OLD_IDS[*]})"
  exit 0
fi

SED=() PATTERNS=()
for i in 0 1 2; do
  old="${OLD_HASHES[$i]}"
  new="$(wasm_hash "$NEW_EVIDENCE" "${WASMS[$i]}")"
  is_hash "$new" || die "$NEW_EVIDENCE: no SHA-256 for ${WASMS[$i]}.wasm"
  # Docs show hashes in full and shortened as first8…last6.
  for pair in "${OLD_IDS[$i]}|${NEW_IDS[$i]}" "$old|$new" "${old:0:8}…${old: -6}|${new:0:8}…${new: -6}"; do
    SED+=(-e "s|$pair|g") PATTERNS+=(-e "${pair%%|*}")
  done
done

# One sed call over all matching files. The expressions still run in order on
# each line, but no new value can equal another contract's old ID or hash.
mapfile -t CHANGED < <(git -c core.quotePath=false grep -lF "${PATTERNS[@]}" -- . \
  ':!deploy-evidence/' ':!.github/' ':!docs/walkthrough.md' \
  ':!docs/evidence-package.md' ':!Noir/Session - *' \
  ':!sdk/agent-sdk/tests/security-matrix-support.ts' \
  ':!sdk/agent-sdk/tests/security-matrix-support.test.ts' || true)
[ "${#CHANGED[@]}" -gt 0 ] && sed -i "${SED[@]}" "${CHANGED[@]}"

[ "${#CHANGED[@]}" -gt 0 ] || die "no files referenced the previous deploy"
printf '%s\n' "${CHANGED[@]}"
