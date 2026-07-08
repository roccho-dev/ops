#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin proof/p5
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck authority-check --attempts fixtures/authority/valid_decision_attempts.jsonl > proof/p5/authority_valid_pass.json
if ./bin/contractcheck authority-check --attempts fixtures/authority/invalid_projection_decision.jsonl > proof/p5/projection_decision_unexpected_pass.txt 2>&1; then
  echo 'expected projection accepted decision to fail authority check' >&2
  exit 1
fi
printf '{"phase":"P5","status":"pass","red":"projection accepted decision rejected","green":"governance accepted decision with receipt allowed","core":"go"}\n' > proof/p5/receipt.jsonl
