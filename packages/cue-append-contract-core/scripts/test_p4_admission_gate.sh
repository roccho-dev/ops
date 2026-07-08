#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
go build -o bin/contractcheck ./cmd/contractcheck
rm -rf runtime proof/p4
mkdir -p runtime proof/p4
./bin/contractcheck admit --draft ledgers/small_after_fix.contract.jsonl --canonical runtime/canonical.contract.jsonl --receipt runtime/admission_receipts.jsonl --generated generated > proof/p4/admit_accept.json
./bin/contractcheck verify-canonical --canonical runtime/canonical.contract.jsonl --receipt runtime/admission_receipts.jsonl > proof/p4/verify_canonical_pass.json
cp runtime/canonical.contract.jsonl /tmp/canonical.before
head -n 1 ledgers/small_after_fix.contract.jsonl >> runtime/canonical.contract.jsonl
if ./bin/contractcheck verify-canonical --canonical runtime/canonical.contract.jsonl --receipt runtime/admission_receipts.jsonl > proof/p4/direct_append_unexpected_pass.txt 2>&1; then
  echo 'expected direct append without admission receipt to fail' >&2
  exit 1
fi
mv /tmp/canonical.before runtime/canonical.contract.jsonl
if ./bin/contractcheck admit --draft ledgers/invalid_semantic.contract.jsonl --canonical runtime/bad_canonical.contract.jsonl --receipt runtime/admission_receipts.jsonl --generated generated > proof/p4/admit_invalid_unexpected_pass.txt 2> proof/p4/admit_invalid_expected_fail.stderr; then
  echo 'expected invalid draft admission to fail' >&2
  exit 1
fi
if [ -e runtime/bad_canonical.contract.jsonl ]; then
  echo 'invalid draft must not create canonical ledger' >&2
  exit 1
fi
printf '{"phase":"P4","status":"pass","red":"direct append and invalid draft rejected","green":"admitted canonical has matching receipt","core":"go"}\n' > proof/p4/receipt.jsonl
