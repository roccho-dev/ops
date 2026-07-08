#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin proof/p2
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck verify-generated --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated > proof/p2/verify_generated.json
./bin/contractcheck validate-jsonschema --ledger ledgers/small_after_fix.contract.jsonl --generated generated > proof/p2/valid_pass.json
if ./bin/contractcheck validate-jsonschema --ledger ledgers/invalid_unknown.contract.jsonl --generated generated > proof/p2/invalid_unknown_unexpected_pass.txt 2>&1; then
  echo 'expected invalid_unknown to fail generated JSON Schema validation' >&2
  exit 1
fi
if ./bin/contractcheck validate-jsonschema --ledger ledgers/invalid_shape.contract.jsonl --generated generated > proof/p2/invalid_shape_unexpected_pass.txt 2>&1; then
  echo 'expected invalid_shape to fail generated JSON Schema validation' >&2
  exit 1
fi
printf '{"phase":"P2","status":"pass","red":"invalid shape/unknown fail generated JSON Schema surface","green":"valid ledger passes generated JSON Schema surface","core":"go"}\n' > proof/p2/receipt.jsonl
