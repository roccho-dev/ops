#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/.proof"}
POLICYCTL=${POLICYCTL:-policyctl}
POLICY_REF=${POLICY_REF:-0123456789abcdef0123456789abcdef01234567}
BASE_TREE=${BASE_TREE:-git-tree-sha1:1111111111111111111111111111111111111111}
CANDIDATE_TREE=${CANDIDATE_TREE:-git-tree-sha1:2222222222222222222222222222222222222222}
command -v "$POLICYCTL" >/dev/null 2>&1 || {
  printf 'policyctl not found: %s\n' "$POLICYCTL" >&2
  exit 127
}
mkdir -p "$OUT"
POLICY_HASH=$("$POLICYCTL" hash --bundle "$ROOT/policy")
"$POLICYCTL" proof \
  --bundle "$ROOT/policy" \
  --fixtures "$ROOT/fixtures" \
  --policy-ref "$POLICY_REF" \
  --base-tree "$BASE_TREE" \
  --candidate-tree "$CANDIDATE_TREE" \
  --out-dir "$OUT/proof"
cmp "$OUT/proof/receipt.1.json" "$OUT/proof/receipt.2.json"
"$POLICYCTL" verify \
  --receipt "$OUT/proof/receipt.1.json" \
  --policy-sha256 "$POLICY_HASH" \
  --base-tree "$BASE_TREE" \
  --candidate-tree "$CANDIDATE_TREE"
POLICYCTL="$POLICYCTL" bash "$ROOT/tests/git-write-admission.sh"
POLICYCTL_BIN="$POLICYCTL" node "$ROOT/tests/local-e2e.mjs" > "$OUT/local-e2e.json"
grep -q '"status":"PASS"' "$OUT/local-e2e.json"
