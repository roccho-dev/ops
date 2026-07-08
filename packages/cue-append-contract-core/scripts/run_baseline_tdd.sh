#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${GOPROXY:-}" && -n "${CAAS_ARTIFACTORY_GO_REGISTRY:-}" && -n "${CAAS_ARTIFACTORY_READER_USERNAME:-}" && -n "${CAAS_ARTIFACTORY_READER_PASSWORD:-}" ]]; then
  export GOPROXY="https://${CAAS_ARTIFACTORY_READER_USERNAME}:${CAAS_ARTIFACTORY_READER_PASSWORD}@${CAAS_ARTIFACTORY_GO_REGISTRY}"
  export GONOSUMDB="*"
fi

mkdir -p bin proof/tdd

go test ./...
go build -o bin/contractcheck ./cmd/contractcheck

./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/small_before_fix.contract.jsonl --row-validator both --report proof/tdd/report_small_before_fix_both.json >/dev/null
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/small_after_fix.contract.jsonl --row-validator both --report proof/tdd/report_small_after_fix_both.json >/dev/null

assert_fails() {
  local name="$1"
  shift
  set +e
  "$@" >/tmp/contractcheck_${name}.out 2>/tmp/contractcheck_${name}.err
  local code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    echo "expected failure but got success: $name" >&2
    cat /tmp/contractcheck_${name}.out >&2 || true
    cat /tmp/contractcheck_${name}.err >&2 || true
    exit 1
  fi
  printf '{"case":"%s","exit_code":%d,"status":"expected_failure"}\n' "$name" "$code" >> proof/tdd/negative_exit_assertions.jsonl
}

: > proof/tdd/negative_exit_assertions.jsonl
assert_fails invalid_shape ./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/invalid_shape.contract.jsonl --report proof/tdd/report_invalid_shape.json
assert_fails invalid_semantic ./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/invalid_semantic.contract.jsonl --report proof/tdd/report_invalid_semantic.json
assert_fails invalid_unknown ./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/invalid_unknown.contract.jsonl --row-validator fast --report proof/tdd/report_invalid_unknown_fast.json

python3 - <<'PY'
import hashlib, json, pathlib, time
root = pathlib.Path('.')
paths = [
    'contracts/meta.cue',
    'ledgers/small_before_fix.contract.jsonl',
    'ledgers/small_after_fix.contract.jsonl',
    'proof/tdd/report_small_before_fix_both.json',
    'proof/tdd/report_small_after_fix_both.json',
    'proof/tdd/report_invalid_shape.json',
    'proof/tdd/report_invalid_semantic.json',
    'proof/tdd/report_invalid_unknown_fast.json',
    'proof/tdd/negative_exit_assertions.jsonl',
]
items = []
for p in paths:
    b = (root / p).read_bytes()
    items.append({'path': p, 'sha256': hashlib.sha256(b).hexdigest(), 'bytes': len(b)})
receipt = {
    'kind': 'main_baseline_receipt.v1',
    'created_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'status': 'pass',
    'scope': 'current_poc_as_main_baseline',
    'checks': ['go test ./...', 'positive fixture validation', 'negative fixture fail-closed assertions'],
    'artifacts': items,
}
out = root / 'proof' / 'main_baseline_receipt.json'
out.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
PY

echo "baseline TDD proof PASS"
