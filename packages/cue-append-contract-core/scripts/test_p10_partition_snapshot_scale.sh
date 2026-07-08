#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
go build -o bin/contractcheck ./cmd/contractcheck
rm -rf generated/cache/partitions/stress_500k proof/p10
mkdir -p proof/p10
./bin/contractcheck partition --ledger ledgers/stress_500k.contract.jsonl.gz --out generated/cache/partitions/stress_500k --chunk-lines 100000 > proof/p10/partition_generate.json
./bin/contractcheck verify-partition --out generated/cache/partitions/stress_500k > proof/p10/partition_verify.json
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/stress_500k.contract.jsonl.gz --row-validator fast --cue-sample 1000 --report proof/p10/stress_500k_fast_report.json > proof/p10/stress_500k_fast_stdout.json
python - <<'PY'
import json, pathlib
manifest = json.loads(pathlib.Path('generated/cache/partitions/stress_500k/partition_manifest.json').read_text())
report = json.loads(pathlib.Path('proof/p10/stress_500k_fast_report.json').read_text())
assert manifest['total_lines'] == 500025, manifest['total_lines']
assert len(manifest['partitions']) >= 5, len(manifest['partitions'])
assert report['lines'] == 500025, report['lines']
assert not report.get('semantic_errors'), report.get('semantic_errors')
pathlib.Path('proof/p10/assertions.json').write_text(json.dumps({'manifest_lines':manifest['total_lines'],'partitions':len(manifest['partitions']),'validator_lines':report['lines'],'peak_alloc_mb':report.get('peak_alloc_mb')},indent=2,sort_keys=True)+'\n')
PY
printf '{"phase":"P10","status":"pass","red":"single unpartitioned scale-only proof rejected by assertions","green":"500025-line stress ledger partitioned, verified, and fast-validated","core":"go"}\n' > proof/p10/receipt.jsonl
