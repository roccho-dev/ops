#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin proof/p3 tmp
go build -o bin/contractcheck ./cmd/contractcheck
./bin/contractcheck verify-generated --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated > proof/p3/verify_generated.json
tsc --strict --target ES2020 --module CommonJS --noEmit examples/projection_ok.ts > proof/p3/tsc_ok.stdout 2> proof/p3/tsc_ok.stderr
rm -rf tmp/removed_generated
./bin/contractcheck generate-artifacts --ledger fixtures/removed_confidence.contract.jsonl --meta contracts/meta.cue --out tmp/removed_generated > proof/p3/generate_removed.json
cat > tmp/removed_field_check.ts <<'TS'
import { accessors, ClaimV1 } from "./removed_generated/core/ts/accessors";
const claim: ClaimV1 = { text: "x", confidence_level: "low" };
accessors.claim_v1.confidence(claim);
TS
if tsc --strict --target ES2020 --module CommonJS --noEmit tmp/removed_field_check.ts > proof/p3/removed_unexpected_pass.stdout 2> proof/p3/removed_expected_fail.stderr; then
  echo 'expected removed field accessor to fail TypeScript compile' >&2
  exit 1
fi
printf '{"phase":"P3","status":"pass","red":"removed field accessor failed tsc","green":"current generated accessor compiles","core":"go"}\n' > proof/p3/receipt.jsonl
