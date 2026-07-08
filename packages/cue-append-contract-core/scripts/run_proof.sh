#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/small_before_fix.contract.jsonl --row-validator both --report proof/report_small_before_fix_both.json >/dev/null
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/small_after_fix.contract.jsonl --row-validator both --report proof/report_small_after_fix_both.json >/dev/null
set +e
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/invalid_shape.contract.jsonl --report proof/report_invalid_shape.json >/dev/null
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/invalid_semantic.contract.jsonl --report proof/report_invalid_semantic.json >/dev/null
./bin/contractcheck validate --meta contracts/meta.cue --ledger ledgers/invalid_unknown.contract.jsonl --row-validator fast --report proof/report_invalid_unknown_fast.json >/dev/null
set -e
