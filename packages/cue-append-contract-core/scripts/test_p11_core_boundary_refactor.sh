#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p proof/p11

# Characterization: every existing phase must still pass after the boundary split.
echo "P11 running go_test"
go test ./... > proof/p11/go_test.stdout 2> proof/p11/go_test.stderr
echo "P11 running scripts/test_p1_generated_integrity.sh"
bash scripts/test_p1_generated_integrity.sh > proof/p11/p1.stdout 2> proof/p11/p1.stderr
echo "P11 running scripts/test_p2_jsonschema_validator_generation.sh"
bash scripts/test_p2_jsonschema_validator_generation.sh > proof/p11/p2.stdout 2> proof/p11/p2.stderr
echo "P11 running scripts/test_p3_ts_accessor_static_failure.sh"
bash scripts/test_p3_ts_accessor_static_failure.sh > proof/p11/p3.stdout 2> proof/p11/p3.stderr
echo "P11 running scripts/test_p4_admission_gate.sh"
bash scripts/test_p4_admission_gate.sh > proof/p11/p4.stdout 2> proof/p11/p4.stderr
echo "P11 running scripts/test_p5_authority_boundary.sh"
bash scripts/test_p5_authority_boundary.sh > proof/p11/p5.stdout 2> proof/p11/p5.stderr
echo "P11 running scripts/test_p6_receipt_ledger.sh"
bash scripts/test_p6_receipt_ledger.sh > proof/p11/p6.stdout 2> proof/p11/p6.stderr
echo "P11 running scripts/test_p7_graph_checker.sh"
bash scripts/test_p7_graph_checker.sh > proof/p11/p7.stdout 2> proof/p11/p7.stderr
echo "P11 running scripts/test_p8_source_policy.sh"
bash scripts/test_p8_source_policy.sh > proof/p11/p8.stdout 2> proof/p11/p8.stderr
echo "P11 running scripts/test_p9_lineage_impact_closure.sh"
bash scripts/test_p9_lineage_impact_closure.sh > proof/p11/p9.stdout 2> proof/p11/p9.stderr
echo "P11 running scripts/test_p10_partition_snapshot_scale.sh"
bash scripts/test_p10_partition_snapshot_scale.sh > proof/p11/p10.stdout 2> proof/p11/p10.stderr

python3 - <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path('.')
required = [
  'generated/core/jsonschema/contract-event.schema.json',
  'generated/core/jsonschema/schema-catalog.json',
  'generated/core/ts/accessors.ts',
  'generated/core/indexes/contract-index.json',
  'generated/core/manifest.json',
  'generated/projections/lineage/closure.jsonl',
  'generated/projections/lineage/impact_report.json',
  'generated/cache/partitions/stress_500k/partition_manifest.json',
  'tools/contract_kernel.py',
  'proof/python/contract_kernel.py',
]
missing = [p for p in required if not (root/p).exists()]
if missing:
    raise SystemExit('missing required P11 boundary artifacts: '+', '.join(missing))
for legacy in ['generated/jsonschema','generated/ts','generated/indexes','generated/lineage','generated/partitions']:
    if (root/legacy).exists():
        raise SystemExit('legacy generated scope still exists: '+legacy)
wrapper = (root/'tools/contract_kernel.py').read_text()
if 'runpy.run_path' not in wrapper or ('proof/python/contract_kernel.py' not in wrapper and '"proof" / "python"' not in wrapper):
    raise SystemExit('tools/contract_kernel.py is not proof wrapper')
if 'def cmd_generate_artifacts' in wrapper:
    raise SystemExit('tools/contract_kernel.py still contains Python kernel implementation')
manifest = json.loads((root/'generated/core/manifest.json').read_text())
if manifest.get('scope') != 'generated/core':
    raise SystemExit('generated/core manifest has wrong scope')
report = json.loads((root/'proof/p10/stress_500k_fast_report.json').read_text())
if report.get('lines') != 500025 or report.get('semantic_errors'):
    raise SystemExit('P10 scale proof degraded')
receipt = {
  'kind': 'p11.package_boundary_refactor.receipt.v1',
  'status': 'pass',
  'red': 'architecture tests would fail if Python/DuckDB/AJV became core or generated scopes mixed',
  'green': 'P0-P10 behavior preserved with Go+CUE+JSONL core boundary and proof/adapters split',
  'checks': ['go test ./...', 'P1-P10 phase scripts', 'generated scope assertions', 'proof-kernel wrapper assertion'],
  'generated_core_hash': hashlib.sha256((root/'generated/core/manifest.json').read_bytes()).hexdigest(),
  'stress_lines': report['lines'],
}
(root/'proof/p11/receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True)+'\n')
print(json.dumps({'status':'pass','phase':'P11','stress_lines':report['lines']}, sort_keys=True))
PY
