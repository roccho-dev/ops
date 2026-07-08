#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin proof/p8
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck source-policy-check --ledger fixtures/source/valid_source_policy.jsonl > proof/p8/source_policy_valid_pass.json
if ./bin/contractcheck source-policy-check --ledger fixtures/source/invalid_missing_raw_ref.jsonl > proof/p8/missing_raw_ref_unexpected_pass.txt 2>&1; then
  echo 'expected raw evidence without raw_ref to fail' >&2
  exit 1
fi
printf '{"phase":"P8","status":"pass","red":"raw evidence without raw_ref rejected","green":"source/raw/extraction minimum policy accepted","core":"go"}\n' > proof/p8/receipt.jsonl
