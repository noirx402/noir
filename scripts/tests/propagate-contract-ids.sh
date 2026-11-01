#!/usr/bin/env bash
# Offline regression: requires Bash, Git, jq and standard Unix tools.
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_ROOT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
FIXTURE="$(mktemp -d "$TEMP_ROOT/noir-propagation-test.XXXXXX")"
cleanup() {
  [[ "$FIXTURE" == "$TEMP_ROOT"/noir-propagation-test.* && -d "$FIXTURE" ]] || return
  rm -rf -- "$FIXTURE"
}
trap cleanup EXIT

mkdir -p "$FIXTURE"/{scripts,frontend,deploy-evidence,docs,.github,Noir,sdk/agent-sdk/tests}
cp "$SOURCE_ROOT/scripts/propagate-contract-ids.sh" "$FIXTURE/scripts/"
cd "$FIXTURE"
git init -q
git config core.autocrlf false

KEYS=(EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT EXPO_PUBLIC_PAYMENT_ESCROW_CONTRACT)
WASMS=(device_registry agent_registry payment_escrow)
OLD_IDS=() NEW_IDS=() OLD_HASHES=() NEW_HASHES=()
for pair in A:D B:E C:F; do
  OLD_IDS+=("C$(printf '%055d' 0 | tr 0 "${pair:0:1}")")
  NEW_IDS+=("C$(printf '%055d' 0 | tr 0 "${pair:2:1}")")
  OLD_HASHES+=("$(printf '%064d' 0 | tr 0 "${pair:0:1}" | tr A-F a-f)")
  NEW_HASHES+=("$(printf '%064d' 0 | tr 0 "${pair:2:1}" | tr A-F a-f)")
done

for i in 0 1 2; do
  printf '%s=%s\n| %s.wasm | %s |\n' "${KEYS[$i]}" "${OLD_IDS[$i]}" "${WASMS[$i]}" "${OLD_HASHES[$i]}" >> deploy-evidence/deploy-old.md
  printf '%s=%s\n| %s.wasm | %s |\n' "${KEYS[$i]}" "${NEW_IDS[$i]}" "${WASMS[$i]}" "${NEW_HASHES[$i]}" >> deploy-evidence/deploy-new.md
  printf '%s %s %s…%s\n' "${OLD_IDS[$i]}" "${OLD_HASHES[$i]}" "${OLD_HASHES[$i]:0:8}" "${OLD_HASHES[$i]: -6}" >> active.txt
  printf '%s %s %s…%s\n' "${NEW_IDS[$i]}" "${NEW_HASHES[$i]}" "${NEW_HASHES[$i]:0:8}" "${NEW_HASHES[$i]: -6}" >> "$FIXTURE/expected.txt"
done
cat > frontend/eas.json <<EOF
{"build":{"base":{"env":{
"${KEYS[0]}":"${OLD_IDS[0]}",
"${KEYS[1]}":"${OLD_IDS[1]}",
"${KEYS[2]}":"${OLD_IDS[2]}"
}}}}
EOF
printf "const PRE_FIX_TESTNET_IDS = new Set(['%s', '%s', '%s'])\n" "${OLD_IDS[@]}" > sdk/agent-sdk/tests/security-matrix-support.ts
printf "const historicalIds = ['%s', '%s', '%s']\n" "${OLD_IDS[@]}" > sdk/agent-sdk/tests/security-matrix-support.test.ts
cp active.txt sdk/agent-sdk/tests/active.txt
for path in docs/walkthrough.md docs/evidence-package.md 'Noir/Session - old.md' .github/history.yml; do
  cp active.txt "$path"
done
git add scripts frontend deploy-evidence docs .github Noir sdk active.txt

bash scripts/propagate-contract-ids.sh --check
bash scripts/propagate-contract-ids.sh deploy-evidence/deploy-new.md
cmp active.txt expected.txt
cmp sdk/agent-sdk/tests/active.txt expected.txt
for i in 0 1 2; do
  [[ "$(jq -r ".build.base.env.${KEYS[$i]}" frontend/eas.json)" == "${NEW_IDS[$i]}" ]]
done
if ! git diff --exit-code -- deploy-evidence docs .github Noir \
  sdk/agent-sdk/tests/security-matrix-support.ts sdk/agent-sdk/tests/security-matrix-support.test.ts; then
  echo 'FAIL: propagation rewrote immutable history' >&2
  exit 1
fi
echo 'PASS: active references updated; test and deployment history preserved'
