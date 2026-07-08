#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin proof/p7
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck graph-check --ledger ledgers/small_after_fix.contract.jsonl > proof/p7/graph_valid_pass.json
if ./bin/contractcheck graph-check --ledger fixtures/graph/invalid_forbidden_flow.contract.jsonl > proof/p7/forbidden_flow_unexpected_pass.txt 2>&1; then
  echo 'expected projection->decision forbidden flow to fail' >&2
  exit 1
fi
if ./bin/contractcheck graph-check --ledger fixtures/graph/invalid_cycle.contract.jsonl > proof/p7/cycle_unexpected_pass.txt 2>&1; then
  echo 'expected acyclic graph cycle to fail' >&2
  exit 1
fi
printf '{"phase":"P7","status":"pass","red":"forbidden flow and cycle rejected","green":"valid direct-edge graph accepted","core":"go"}\n' > proof/p7/receipt.jsonl
