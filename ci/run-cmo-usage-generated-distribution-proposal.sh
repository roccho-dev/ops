#!/usr/bin/env bash
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$HERE/_common.sh"
ROOT="$(resolve_root "${1:-}")"
ensure_aliases "$ROOT"
python3 - "$ROOT" <<'PY'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1])
contracts=[json.loads(l) for l in (root/'governance-records-main/records/specs/package-contract.v1.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
ids={r['packageId'] for r in contracts}
required={'cmo-usage-generated-distribution-system','jsonl-replay-visual-surface','shareable-governance-room','governance-template-marketplace-ledger','customer-policy-passport','public-status-badge-projection','publishable-moment-detector','anonymized-governance-benchmark-index','destructive-case-community-league','integration-surface-growth-cards','artifact-level-peer-review-ledger'}
missing=sorted(required-ids)
if missing: raise SystemExit('missing package contracts: '+','.join(missing))
print(json.dumps({'kind':'canonicalCore.cmoUsageGeneratedDistributionProposalCi.v1','status':'pass','packages':len(required),'generatedAuthority':'forbidden; generated distribution remains replay evidence only'}, sort_keys=True))
PY
