#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin proof/p6
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck receipt-check --receipts fixtures/receipt/valid_receipts.jsonl > proof/p6/receipt_valid_pass.json
if ./bin/contractcheck receipt-check --receipts fixtures/receipt/invalid_missing_output_hash.jsonl > proof/p6/missing_output_hash_unexpected_pass.txt 2>&1; then
  echo 'expected pass receipt without output_hash to fail' >&2
  exit 1
fi
printf '{"phase":"P6","status":"pass","red":"pass receipt without output_hash rejected","green":"validation/projection receipts accepted","core":"go"}\n' > proof/p6/receipt.jsonl
