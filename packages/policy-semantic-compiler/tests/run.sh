#!/usr/bin/env bash
set -euo pipefail

pkg_root="$(cd "$(dirname "$0")/.." && pwd)"
policy_root="${POLICY_SEMANTIC_POLICY_ROOT:-/home/nixos/repos/policy}"
work="${1:-$(mktemp -d)}"

mkdir -p "$work/run-a" "$work/run-b" "$work/python-only"
mkdir -p "$work/projected-real" "$work/projected-fixture"
mkdir -p "$work/semantic-review-blocked" "$work/semantic-review-disposition" "$work/semantic-review-accepted"
mkdir -p "$work/adrs-projection-accepted" "$work/adrs-projection-missing-proof" "$work/adrs-projection-fake-proof"
mkdir -p "$work/adrs-projection-stale-ref" "$work/adrs-projection-candidate-disposition"
mkdir -p "$work/adrs-projection-fixture-only"

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

python3 "$pkg_root/tests/typed-json-fixture.py" "$work" > "$work/typed-json-fixture.json"
grep -q '"ok": true' "$work/typed-json-fixture.json"

policy-semantic-compiler extract-typed-json   --policy-root "$policy_root"   --out-dir "$work/typed-json-current" > "$work/typed-json-current.stdout.json"
grep -q '"ok": true' "$work/typed-json-current.stdout.json"
grep -q '"cutoverReady": false' "$work/typed-json-current.stdout.json"
grep -q '"policyDeletionApproved": false' "$work/typed-json-current.stdout.json"
grep -q '"gate_id":"role-index-sha256-lock-verified","status":"pass"' "$work/typed-json-current/typed-gates.jsonl"
grep -q '"gate_id":"protocol-command-completeness","status":"pass"' "$work/typed-json-current/typed-gates.jsonl"

if policy-semantic-compiler review-deletion-readiness \
  --policy-root "$policy_root" \
  --repo-root /home/nixos/repos/bootstrap \
  --repo-root /home/nixos/repos/ops/.worktrees/policy-git-boundary-deletion-gates-260619 \
  --repo-root /home/nixos/repos/adrs \
  --out-dir "$work/deletion-readiness" > "$work/deletion-readiness.stdout.json"; then
  echo "deletion readiness unexpectedly passed while policy.git consumers remain" >&2
  exit 1
fi
grep -q '"ok": false' "$work/deletion-readiness.stdout.json"
grep -q '"cutoverReady": false' "$work/deletion-readiness.stdout.json"
grep -q '"policyDeletionApproved": false' "$work/deletion-readiness.stdout.json"
grep -q '"gate_id":"scan-roots-present","status":"pass"' "$work/deletion-readiness/deletion-readiness-gates.jsonl"
grep -q '"gate_id":"active-policy-consumers-zero","status":"blocked"' "$work/deletion-readiness/deletion-readiness-gates.jsonl"
grep -q '"gate_id":"policy-absent-consumers-pass","status":"blocked"' "$work/deletion-readiness/deletion-readiness-gates.jsonl"
grep -q '"gate_id":"deletion-approved","status":"blocked"' "$work/deletion-readiness/deletion-readiness-gates.jsonl"
grep -q '"consumerPassedWithoutPolicyGit": false' "$work/deletion-readiness/absent-simulation.json"

grep -q '"gate_id":"explicit-consumer-proofs-pass","status":"blocked"' "$work/deletion-readiness/deletion-readiness-gates.jsonl"
grep -q '"consumerProofsPass": false' "$work/deletion-readiness.stdout.json"

if policy-semantic-compiler review-deletion-readiness \
  --policy-root "$policy_root" \
  --repo-root /home/nixos/repos/bootstrap \
  --consumer-proof-command 'printf consumer-proof-pass' \
  --out-dir "$work/deletion-readiness-consumer-proof-pass" > "$work/deletion-readiness-consumer-proof-pass.stdout.json"; then
  echo "deletion readiness unexpectedly passed with only consumer proof command" >&2
  exit 1
fi
grep -q '"consumerProofsPass": true' "$work/deletion-readiness-consumer-proof-pass.stdout.json"
grep -q '"gate_id":"explicit-consumer-proofs-pass","status":"pass"' "$work/deletion-readiness-consumer-proof-pass/deletion-readiness-gates.jsonl"
grep -q '"status":"pass"' "$work/deletion-readiness-consumer-proof-pass/consumer-proof-results.jsonl"
grep -q '"cutoverReady": false' "$work/deletion-readiness-consumer-proof-pass.stdout.json"
grep -q '"policyDeletionApproved": false' "$work/deletion-readiness-consumer-proof-pass.stdout.json"

if policy-semantic-compiler review-deletion-readiness \
  --policy-root "$policy_root" \
  --repo-root /home/nixos/repos/bootstrap \
  --consumer-proof-command 'printf consumer-proof-fail >&2; exit 7' \
  --out-dir "$work/deletion-readiness-consumer-proof-fail" > "$work/deletion-readiness-consumer-proof-fail.stdout.json"; then
  echo "deletion readiness unexpectedly passed with failing consumer proof command" >&2
  exit 1
fi
grep -q '"consumerProofsPass": false' "$work/deletion-readiness-consumer-proof-fail.stdout.json"
grep -q '"gate_id":"explicit-consumer-proofs-pass","status":"blocked"' "$work/deletion-readiness-consumer-proof-fail/deletion-readiness-gates.jsonl"
grep -q '"exitCode":7' "$work/deletion-readiness-consumer-proof-fail/consumer-proof-results.jsonl"

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
grep -q '"candidateSourceFileDispositionRows": 1' "$work/semantic-review-disposition.stdout.json"
grep -q '"source file dispositions are not accepted authority"' "$work/semantic-review-disposition.stdout.json"
grep -q '"equivalenceProofPresent": false' "$work/semantic-review-disposition.stdout.json"
grep -q '"cutoverReady": false' "$work/semantic-review-disposition.stdout.json"
grep -q '"reviewRequiredSpanCount":0' "$work/semantic-review-disposition/semantic-coverage-review-packets.jsonl"
test "$(grep -c '"fileClassNonNormativeSpanCount":1' "$work/semantic-review-disposition/semantic-coverage-review-packets.jsonl")" -eq 2

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

policy-semantic-compiler review-adrs-projection-duckdb \
  --adrs-records-dir "$pkg_root/tests/adrs-projection-duckdb/accepted" \
  --policy-rev rev-good \
  --out-dir "$work/adrs-projection-accepted" > "$work/adrs-projection-accepted.stdout.json"
grep -q '"ok": true' "$work/adrs-projection-accepted.stdout.json"
grep '"gate_id":"accepted-span-disposition-missing"' "$work/adrs-projection-accepted/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"pass"'
grep '"gate_id":"accepted-coverage-missing"' "$work/adrs-projection-accepted/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"pass"'
grep '"gate_id":"accepted-coverage-proof-present"' "$work/adrs-projection-accepted/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"pass"'
grep '"gate_id":"fresh-genx-evidence-accepted"' "$work/adrs-projection-accepted/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"pass"'
grep '"gate_id":"fixture-only-proof-rejected"' "$work/adrs-projection-accepted/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"pass"'
grep '"gate_id":"generated-rows-not-authority"' "$work/adrs-projection-accepted/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"pass"'

if policy-semantic-compiler review-adrs-projection-duckdb \
  --adrs-records-dir "$pkg_root/tests/adrs-projection-duckdb/missing-proof" \
  --policy-rev rev-good \
  --out-dir "$work/adrs-projection-missing-proof" > "$work/adrs-projection-missing-proof.stdout.json"; then
  echo "ADRS projection review unexpectedly passed without accepted proof" >&2
  exit 1
fi
grep '"gate_id":"accepted-coverage-proof-present"' "$work/adrs-projection-missing-proof/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'
grep '"gate_id":"accepted-coverage-missing"' "$work/adrs-projection-missing-proof/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'

if policy-semantic-compiler review-adrs-projection-duckdb \
  --adrs-records-dir "$pkg_root/tests/adrs-projection-duckdb/fake-proof" \
  --policy-rev rev-good \
  --out-dir "$work/adrs-projection-fake-proof" > "$work/adrs-projection-fake-proof.stdout.json"; then
  echo "ADRS projection review unexpectedly passed with fake generated authority proof" >&2
  exit 1
fi
grep '"gate_id":"generated-rows-not-authority"' "$work/adrs-projection-fake-proof/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'

if policy-semantic-compiler review-adrs-projection-duckdb \
  --adrs-records-dir "$pkg_root/tests/adrs-projection-duckdb/stale-ref" \
  --policy-rev rev-good \
  --out-dir "$work/adrs-projection-stale-ref" > "$work/adrs-projection-stale-ref.stdout.json"; then
  echo "ADRS projection review unexpectedly passed with stale policy ref" >&2
  exit 1
fi
grep '"gate_id":"policy-ref-current"' "$work/adrs-projection-stale-ref/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'

if policy-semantic-compiler review-adrs-projection-duckdb \
  --adrs-records-dir "$pkg_root/tests/adrs-projection-duckdb/candidate-disposition" \
  --policy-rev rev-good \
  --out-dir "$work/adrs-projection-candidate-disposition" > "$work/adrs-projection-candidate-disposition.stdout.json"; then
  echo "ADRS projection review unexpectedly passed with candidate-only disposition" >&2
  exit 1
fi
grep '"gate_id":"candidate-only-disposition"' "$work/adrs-projection-candidate-disposition/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'
grep '"gate_id":"candidate-only-span-disposition"' "$work/adrs-projection-candidate-disposition/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'
grep '"gate_id":"accepted-span-disposition-missing"' "$work/adrs-projection-candidate-disposition/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'

if policy-semantic-compiler review-adrs-projection-duckdb \
  --adrs-records-dir "$pkg_root/tests/adrs-projection-duckdb/fixture-only" \
  --policy-rev rev-good \
  --out-dir "$work/adrs-projection-fixture-only" > "$work/adrs-projection-fixture-only.stdout.json"; then
  echo "ADRS projection review unexpectedly passed with fixture-only proof" >&2
  exit 1
fi
grep '"gate_id":"fresh-genx-evidence-accepted"' "$work/adrs-projection-fixture-only/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'
grep '"gate_id":"fixture-only-proof-rejected"' "$work/adrs-projection-fixture-only/adrs-projection-duckdb-gates.jsonl" | grep -q '"status":"blocked"'

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

mkdir -p "$work/projected-accepted-source" "$work/projected-accepted-source-invalid"
policy-semantic-compiler project-policy-entry \
  --out-dir "$work/projected-accepted-source-base" > "$work/projected-accepted-source-base.stdout.json"
LOCK="$(grep '^POLICY_ENTRY_LOCK=' "$work/projected-accepted-source-base/policy-entry.accepted.env" | cut -d= -f2-)"
cat > "$work/accepted-source.json" <<EOF
{"kind":"policy.projectedPolicyEntryAcceptedSource.v1","accepted":true,"policyEntryLock":"$LOCK","sourceAuthority":{"repo":"adrs","path":"records/policy/policy.projectedPolicyEntryAcceptedSource.v1.jsonl","commit":"fixture","id":"source-authority-fixture","status":"accepted"},"ownerApprovalRef":{"repo":"adrs","path":"records/policy/policy.ownerApproval.v1.jsonl","commit":"fixture","id":"owner-approval-fixture","status":"accepted"},"semanticEquivalenceProofRef":{"repo":"adrs","path":"records/policy/policy.semanticEquivalenceProof.v1.jsonl","commit":"fixture","id":"semantic-equivalence-fixture","status":"accepted"},"consumerZeroProofRef":{"repo":"adrs","path":"records/policy/policy.consumerZeroProof.v1.jsonl","commit":"fixture","id":"consumer-zero-fixture","status":"accepted"},"generatedIsAuthority":false,"policyDeletionApproved":false}
EOF
policy-semantic-compiler check-accepted-policy-entry-source \
  --source "$work/accepted-source.json" \
  --expected-lock "$LOCK" > "$work/accepted-source.check.json"
grep -q '"ok": true' "$work/accepted-source.check.json"
if policy-semantic-compiler check-accepted-policy-entry-source \
  --source "$work/accepted-source.json" \
  --expected-lock "sha256:wrong" > "$work/accepted-source-wrong-lock.check.json"; then
  echo "accepted source wrong lock unexpectedly passed" >&2
  exit 1
fi
grep -q 'policy-entry-lock-mismatch' "$work/accepted-source-wrong-lock.check.json"
policy-semantic-compiler project-policy-entry \
  --out-dir "$work/projected-accepted-source" \
  --accepted-source "$work/accepted-source.json" > "$work/projected-accepted-source.stdout.json"
grep -q '"accepted": true' "$work/projected-accepted-source.stdout.json"
grep -q '"fixtureOnly": false' "$work/projected-accepted-source/manifest.json"
grep -q 'POLICY_ENTRY_STATUS=accepted-source' "$work/projected-accepted-source/policy-entry.accepted.env"
! grep -q 'POLICY_ENTRY_STATUS=fixture-accepted' "$work/projected-accepted-source/policy-entry.accepted.env"
! grep -q 'POLICY_ENTRY_FIXTURE_ONLY=' "$work/projected-accepted-source/policy-entry.accepted.env"
policy-semantic-compiler check-projected-policy-entry \
  --dir "$work/projected-accepted-source" \
  --expect-accepted > "$work/projected-accepted-source.check.json"
grep -q '"ok": true' "$work/projected-accepted-source.check.json"
cat > "$work/accepted-source-invalid.json" <<EOF
{"kind":"policy.projectedPolicyEntryAcceptedSource.v1","accepted":true,"policyEntryLock":"$LOCK","sourceAuthority":{"repo":"adrs","path":"records/policy/policy.projectedPolicyEntryAcceptedSource.v1.jsonl","commit":"fixture","id":"source-authority-fixture","status":"accepted"},"semanticEquivalenceProofRef":{"repo":"adrs","path":"records/policy/policy.semanticEquivalenceProof.v1.jsonl","commit":"fixture","id":"semantic-equivalence-fixture","status":"accepted"},"consumerZeroProofRef":{"repo":"adrs","path":"records/policy/policy.consumerZeroProof.v1.jsonl","commit":"fixture","id":"consumer-zero-fixture","status":"accepted"},"generatedIsAuthority":false,"policyDeletionApproved":false}
EOF
if policy-semantic-compiler project-policy-entry \
  --out-dir "$work/projected-accepted-source-invalid" \
  --accepted-source "$work/accepted-source-invalid.json" > "$work/projected-accepted-source-invalid.stdout.json" 2> "$work/projected-accepted-source-invalid.stderr.json"; then
  echo "accepted source without owner approval unexpectedly passed" >&2
  exit 1
fi
grep -q 'missing-required-field' "$work/projected-accepted-source-invalid.stderr.json"

printf '{"ok":true,"workDir":"%s"}\n' "$work"
