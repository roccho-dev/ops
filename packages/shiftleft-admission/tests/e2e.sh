#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/.proof"}
POLICY_REF=${POLICY_REF:-0123456789abcdef0123456789abcdef01234567}
BASE_TREE=${BASE_TREE:-git-tree-sha1:1111111111111111111111111111111111111111}
CANDIDATE_TREE=${CANDIDATE_TREE:-git-tree-sha1:2222222222222222222222222222222222222222}
mkdir -p "$OUT"
go build -trimpath -ldflags='-s -w' -o "$OUT/policyctl" "$ROOT/cmd/policyctl"
"$OUT/policyctl" proof \
  --bundle "$ROOT/policy" \
  --fixtures "$ROOT/fixtures" \
  --policy-ref "$POLICY_REF" \
  --base-tree "$BASE_TREE" \
  --candidate-tree "$CANDIDATE_TREE" \
  --out-dir "$OUT/proof"
cmp "$OUT/proof/receipt.1.json" "$OUT/proof/receipt.2.json"
