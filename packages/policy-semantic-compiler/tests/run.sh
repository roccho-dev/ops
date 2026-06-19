#!/usr/bin/env bash
set -euo pipefail

pkg_root="$(cd "$(dirname "$0")/.." && pwd)"
policy_root="${POLICY_SEMANTIC_POLICY_ROOT:-/home/nixos/repos/policy}"
work="${1:-$(mktemp -d)}"

mkdir -p "$work/run-a" "$work/run-b" "$work/python-only"
mkdir -p "$work/projected-real" "$work/projected-fixture"
mkdir -p "$work/semantic-review-blocked" "$work/semantic-review-disposition" "$work/semantic-review-accepted"

policy-semantic-compiler check-fixtures \
  --fixtures "$pkg_root/tests/edge-counterexamples.jsonl" > "$work/fixtures.json"
grep -q '"ok": true' "$work/fixtures.json"

policy-semantic-compiler check-counterexamples \
  --fixtures "$pkg_root/tests/edge-counterexamples.jsonl" \
  --datasets "$pkg_root/tests/counterexample-datasets.jsonl" > "$work/counterexamples.json"
grep -q '"ok": true' "$work/counterexamples.json"

policy-semantic-compiler check-fresh-agent-cases \
  --fixtures "$pkg_root/tests/fresh-agent-cases.jsonl" > "$work/fresh-agent-cases.json"
grep -q '"ok": true' "$work/fresh-agent-cases.json"

if policy-semantic-compiler review-semantic-coverage \
  --source-files "$pkg_root/tests/semantic-coverage/source-files.jsonl" \
  --source-spans "$pkg_root/tests/semantic-coverage/source-spans.jsonl" \
  --semantic-nodes "$pkg_root/tests/semantic-coverage/semantic-nodes.jsonl" \
  --semantic-edges "$pkg_root/tests/semantic-coverage/semantic-edges.jsonl" \
  --out-dir "$work/semantic-review-blocked" > "$work/semantic-review-blocked.stdout.json"; then
  echo "semantic coverage review unexpectedly passed without approvals" >&2
  exit 1
fi
grep -q '"acceptedSemanticApprovalCount": 0' "$work/semantic-review-blocked.stdout.json"
grep -q '"totalSourceSpanCount": 2' "$work/semantic-review-blocked.stdout.json"
grep -q '"equivalenceProofPresent": false' "$work/semantic-review-blocked.stdout.json"
grep -q '"cutoverReady": false' "$work/semantic-review-blocked.stdout.json"
grep -q '"reviewPacketCount": 2' "$work/semantic-review-blocked.stdout.json"

if policy-semantic-compiler review-semantic-coverage \
  --source-files "$pkg_root/tests/semantic-coverage/source-files.jsonl" \
  --source-spans "$pkg_root/tests/semantic-coverage/source-spans.jsonl" \
  --source-file-dispositions "$pkg_root/tests/semantic-coverage/source-file-dispositions.jsonl" \
  --semantic-nodes "$pkg_root/tests/semantic-coverage/semantic-nodes.jsonl" \
  --semantic-edges "$pkg_root/tests/semantic-coverage/semantic-edges.jsonl" \
  --out-dir "$work/semantic-review-disposition" > "$work/semantic-review-disposition.stdout.json"; then
  echo "semantic coverage review unexpectedly passed with disposition but without equivalence proof" >&2
  exit 1
fi
grep -q '"acceptedSemanticApprovalCount": 0' "$work/semantic-review-disposition.stdout.json"
grep -q '"totalSourceSpanCount": 2' "$work/semantic-review-disposition.stdout.json"
grep -q '"reviewRequiredSourceSpanCount": 0' "$work/semantic-review-disposition.stdout.json"
grep -q '"fileClassNonNormativeSourceSpanCount": 2' "$work/semantic-review-disposition.stdout.json"
grep -q '"equivalenceProofPresent": false' "$work/semantic-review-disposition.stdout.json"
grep -q '"cutoverReady": false' "$work/semantic-review-disposition.stdout.json"

policy-semantic-compiler review-semantic-coverage \
  --source-files "$pkg_root/tests/semantic-coverage/source-files.jsonl" \
  --source-spans "$pkg_root/tests/semantic-coverage/source-spans.jsonl" \
  --semantic-nodes "$pkg_root/tests/semantic-coverage/semantic-nodes.jsonl" \
  --semantic-edges "$pkg_root/tests/semantic-coverage/semantic-edges.jsonl" \
  --approvals "$pkg_root/tests/semantic-coverage/approvals.jsonl" \
  --equivalence-proofs "$pkg_root/tests/semantic-coverage/equivalence-proofs.jsonl" \
  --out-dir "$work/semantic-review-accepted" > "$work/semantic-review-accepted.stdout.json"
grep -q '"acceptedSemanticApprovalCount": 2' "$work/semantic-review-accepted.stdout.json"
grep -q '"totalSourceSpanCount": 2' "$work/semantic-review-accepted.stdout.json"
grep -q '"equivalenceProofPresent": true' "$work/semantic-review-accepted.stdout.json"
grep -q '"cutoverReady": true' "$work/semantic-review-accepted.stdout.json"

policy-semantic-compiler compile \
  --policy-root "$policy_root" \
  --out-dir "$work/run-a" > "$work/run-a.stdout.json"

policy-semantic-compiler compile \
  --policy-root "$policy_root" \
  --out-dir "$work/run-b" > "$work/run-b.stdout.json"

rm -f "$work/run-a/semantic.duckdb" "$work/run-a/duckdb-runner.sql"
rm -f "$work/run-b/semantic.duckdb" "$work/run-b/duckdb-runner.sql"
diff -ru "$work/run-a" "$work/run-b" > "$work/reproducible.diff"

if policy-semantic-compiler compile \
  --policy-root "$policy_root" \
  --out-dir "$work/python-only" \
  --python-only > "$work/python-only.stdout.json"; then
  echo "python-only compiler unexpectedly passed" >&2
  exit 1
fi
grep -q 'DuckDB gate not executed' "$work/python-only.stdout.json"

grep -q '"gate_id":"duckdb-executed","status":"pass"' "$work/run-a/duckdb-gates.jsonl"
grep -q '"gate_id":"semantic-cutover-blocked","status":"blocked"' "$work/run-a/duckdb-gates.jsonl"
grep -q '"candidateArtifactValid": true' "$work/run-a.stdout.json"
grep -q '"cutoverReady": false' "$work/run-a.stdout.json"
grep -q '"policyDeletionApproved": false' "$work/run-a.stdout.json"
grep -q '"cutoverReady": false' "$work/run-a/manifest.json"
grep -q '"policyDeletionApproved": false' "$work/run-a/manifest.json"

policy-semantic-compiler project-policy-entry \
  --native-rows "$work/run-a/native_rows.jsonl" \
  --out-dir "$work/projected-real" > "$work/projected-real.stdout.json"
grep -q '"accepted": false' "$work/projected-real.stdout.json"
grep -q 'POLICY_ENTRY_ACCEPTED=false' "$work/projected-real/policy-entry.accepted.env"
policy-semantic-compiler check-projected-policy-entry \
  --dir "$work/projected-real" > "$work/projected-real.check.json"
grep -q '"ok": true' "$work/projected-real.check.json"

policy-semantic-compiler project-policy-entry \
  --out-dir "$work/projected-fixture" \
  --fixture-accepted \
  --fixture-reason "bootstrap projected-mode contract test" > "$work/projected-fixture.stdout.json"
grep -q '"accepted": true' "$work/projected-fixture.stdout.json"
grep -q 'POLICY_ENTRY_ACCEPTED=true' "$work/projected-fixture/policy-entry.accepted.env"
policy-semantic-compiler check-projected-policy-entry \
  --dir "$work/projected-fixture" \
  --expect-accepted > "$work/projected-fixture.check.json"
grep -q '"ok": true' "$work/projected-fixture.check.json"

printf '{"ok":true,"workDir":"%s"}\n' "$work"
