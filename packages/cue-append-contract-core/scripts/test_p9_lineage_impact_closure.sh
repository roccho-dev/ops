#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
go build -o bin/contractcheck ./cmd/contractcheck
rm -rf generated/projections/lineage proof/p9
mkdir -p proof/p9
./bin/contractcheck lineage --ledger ledgers/small_after_fix.contract.jsonl --out generated/projections/lineage > proof/p9/lineage_generate.json
python - <<'PY'
import json, pathlib
closure = pathlib.Path('generated/projections/lineage/closure.jsonl').read_text().strip().splitlines()
impact = json.loads(pathlib.Path('generated/projections/lineage/impact_report.json').read_text())
assert len(closure) >= 1, 'closure must have at least one derived row'
assert 'claim.v1#confidence' in impact['affected_queries'], 'deprecated confidence must have affected query'
assert 'q_claim_summary.v1' in impact['affected_queries']['claim.v1#confidence'], 'q_claim_summary.v1 must be impacted'
pathlib.Path('proof/p9/assertions.json').write_text(json.dumps({'closure_rows':len(closure),'confidence_impacted_queries':impact['affected_queries']['claim.v1#confidence']},indent=2,sort_keys=True)+'\n')
PY
printf '{"phase":"P9","status":"pass","red":"deprecated field without impact report would fail assertions","green":"closure and impact are regenerated from direct edges/queries","core":"go"}\n' > proof/p9/receipt.jsonl
