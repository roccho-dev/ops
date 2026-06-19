#!/usr/bin/env bash
set -euo pipefail

pkg_root="$(cd "$(dirname "$0")/.." && pwd)"
policy_root="${POLICY_SEMANTIC_POLICY_ROOT:-/home/nixos/repos/policy}"
work="${1:-$(mktemp -d)}"

mkdir -p "$work/run-a" "$work/run-b" "$work/python-only"

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

printf '{"ok":true,"workDir":"%s"}\n' "$work"
