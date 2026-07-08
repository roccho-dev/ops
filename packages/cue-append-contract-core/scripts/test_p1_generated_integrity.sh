#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
go build -o bin/contractcheck ./cmd/contractcheck
rm -rf generated proof/p1
mkdir -p proof/p1
./bin/contractcheck generate-artifacts --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated | tee proof/p1/generate.json
./bin/contractcheck verify-generated --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated | tee proof/p1/verify_pass.json
cp generated/core/ts/accessors.ts /tmp/accessors.before
printf '\n// tamper\n' >> generated/core/ts/accessors.ts
if ./bin/contractcheck verify-generated --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated > proof/p1/tamper_unexpected_pass.txt 2>&1; then
  echo 'expected generated tamper to fail' >&2
  exit 1
fi
mv /tmp/accessors.before generated/core/ts/accessors.ts
./bin/contractcheck verify-generated --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated > proof/p1/verify_after_restore.json
printf '{"phase":"P1","status":"pass","red":"generated tamper failed","green":"generated hash clean","core":"go"}\n' > proof/p1/receipt.jsonl
