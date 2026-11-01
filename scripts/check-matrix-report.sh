#!/usr/bin/env bash
#
# check-matrix-report.sh — Succeed only if a security-matrix report
# (deploy-evidence/week4-security-matrix-*.md, written by
# `npm run test:security-matrix`) is a PASS run against exactly these three
# contract IDs. Used by redeploy-release.yml as the issue #24 acceptance gate.
#
# Usage:
#   ./scripts/check-matrix-report.sh <report> <device_registry> <agent_registry> <payment_escrow>
#
set -euo pipefail

REPORT="${1:?usage: $0 <report> <device_registry> <agent_registry> <payment_escrow>}"
DEVICE="${2:?missing device_registry ID}"
AGENT="${3:?missing agent_registry ID}"
ESCROW="${4:?missing payment_escrow ID}"

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
[ -f "$REPORT" ] || die "report not found: $REPORT"

# matrixRunStatus() only prints PASS for a complete, all-green 20-outcome run.
grep -qx '\*\*Status: PASS\*\*' "$REPORT" || die "$REPORT: status is not PASS"

# The Contract table must hold exactly these three rows, each once.
ROWS="$(grep -cE '^\| (deviceRegistry|agentRegistry|paymentEscrow) \|' "$REPORT" || true)"
[ "$ROWS" = 3 ] || die "$REPORT: expected 3 contract rows, found $ROWS"
for pair in "deviceRegistry:$DEVICE" "agentRegistry:$AGENT" "paymentEscrow:$ESCROW"; do
  name="${pair%%:*}" id="${pair#*:}"
  # The row itself must start with this name and ID, not just contain it.
  awk -v p="| $name | [\`$id\`]" 'index($0, p) == 1 { f = 1 } END { exit !f }' "$REPORT" \
    || die "$REPORT: not run against $name $id"
done

echo "ok: $REPORT is a PASS run against $DEVICE $AGENT $ESCROW"
