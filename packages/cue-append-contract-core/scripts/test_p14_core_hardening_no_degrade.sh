#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${GOPROXY:-}" && -n "${CAAS_ARTIFACTORY_GO_REGISTRY:-}" && -n "${CAAS_ARTIFACTORY_READER_USERNAME:-}" && -n "${CAAS_ARTIFACTORY_READER_PASSWORD:-}" ]]; then
  export GOPROXY="https://${CAAS_ARTIFACTORY_READER_USERNAME}:${CAAS_ARTIFACTORY_READER_PASSWORD}@${CAAS_ARTIFACTORY_GO_REGISTRY}"
  export GONOSUMDB="*"
fi
mkdir -p bin proof/p14 tmp/p14

go test ./... > proof/p14/go_test.stdout 2> proof/p14/go_test.stderr
go build -o bin/contractcheck ./cmd/contractcheck

head -n 8 ledgers/small_after_fix.contract.jsonl > tmp/p14/base.contract.jsonl
{ cat tmp/p14/base.contract.jsonl; sed -n '9,12p' ledgers/small_after_fix.contract.jsonl; } > tmp/p14/candidate_append.contract.jsonl
{ sed '1s/contract.schema.v1/contract.schema_rewritten.v1/' tmp/p14/base.contract.jsonl; sed -n '9,12p' ledgers/small_after_fix.contract.jsonl; } > tmp/p14/candidate_rewrite.contract.jsonl

./bin/contractcheck append-only-check --base tmp/p14/base.contract.jsonl --candidate tmp/p14/candidate_append.contract.jsonl > proof/p14/append_only_pass.json
if ./bin/contractcheck append-only-check --base tmp/p14/base.contract.jsonl --candidate tmp/p14/candidate_rewrite.contract.jsonl > proof/p14/append_only_unexpected_pass.json 2> proof/p14/append_only_expected_fail.stderr; then
  echo 'expected append-only rewrite check to fail' >&2
  exit 1
fi

scripts/test_p10_partition_snapshot_scale.sh > proof/p14/p10.stdout 2> proof/p14/p10.stderr

python3 - <<'PY'
import json, pathlib, subprocess, time
root = pathlib.Path('.')
try:
    head = subprocess.check_output(['git','rev-parse','HEAD'], text=True, stderr=subprocess.DEVNULL).strip()
except Exception:
    head = 'nix-build-source'
append_pass = json.loads((root/'proof/p14/append_only_pass.json').read_text())
p10_assertions = json.loads((root/'proof/p10/assertions.json').read_text())
receipt = {
  'kind': 'p14.core_hardening_receipt.v1',
  'phase': 'P14',
  'status': 'pass',
  'created_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
  'head_commit': head,
  'checks': [
    'go test ./...',
    'no dot imports',
    'validate/artifacts package split size limits',
    'append-only positive and rewrite-negative checks',
    'P10 fully automated partition/snapshot/scale script'
  ],
  'append_only': append_pass,
  'p10': p10_assertions,
  'note': 'Receipt is generated after the code commit so head_commit can match the worktree HEAD without self-referential commit hashing.'
}
(root/'proof/p14/receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True)+'\n')
PY

echo 'P14 core hardening proof PASS'
