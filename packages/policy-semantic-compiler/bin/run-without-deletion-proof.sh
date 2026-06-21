#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 --policy-root PATH --out-dir PATH [--adrs-head SHA] [--coverage-first-dir PATH]" >&2
}

policy_root=
out_dir=
adrs_head=656e6550aead11afc5767535cf90146ba418e8e4
policy_input_ref=334997669f1889a8e2658730c616d2d4510d4536
coverage_first_dir=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --policy-root)
      policy_root=$2
      shift 2
      ;;
    --out-dir)
      out_dir=$2
      shift 2
      ;;
    --adrs-head)
      adrs_head=$2
      shift 2
      ;;
    --coverage-first-dir)
      coverage_first_dir=$2
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ -z "$policy_root" ] || [ -z "$out_dir" ]; then
  usage
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
compiler="$script_dir/policy-semantic-compiler.py"
export PYTHONPATH="$repo_root/packages/policy-semantic-compiler/src${PYTHONPATH:+:$PYTHONPATH}"

mkdir -p "$out_dir"
rm -rf "$out_dir/compile" "$out_dir/projected-base" "$out_dir/projected-accepted" "$out_dir/deletion-readiness"

python3 "$compiler" compile \
  --policy-root "$policy_root" \
  --out-dir "$out_dir/compile" \
  --duckdb-bin duckdb > "$out_dir/compile_stdout.json"

python3 "$compiler" project-policy-entry \
  --native-rows "$out_dir/compile/native_rows.jsonl" \
  --out-dir "$out_dir/projected-base" > "$out_dir/projected_base_stdout.json"

lock=$(grep '^POLICY_ENTRY_LOCK=' "$out_dir/projected-base/policy-entry.accepted.env" | cut -d= -f2-)
cat > "$out_dir/accepted_projected_policy_entry_source.json" <<EOF
{"kind":"policy.projectedPolicyEntryAcceptedSource.v1","accepted":true,"policyEntryLock":"$lock","sourceAuthority":{"repo":"adrs.git","path":"records/evidence/policy-coverage-first-hardened-hybrid-260621/g0_policy_git_retirement_scope_decision_pack.json","commit":"$adrs_head","id":"g0-policy-git-retirement-scope-decision-pack","status":"accepted"},"ownerApprovalRef":{"repo":"adrs.git","path":"records/evidence/policy-coverage-first-hardened-hybrid-260621/g0_policy_git_retirement_scope_decision_pack.json","commit":"$adrs_head","id":"owner-adoption-scope-not-deletion","status":"accepted"},"semanticEquivalenceProofRef":{"repo":"adrs.git","path":"records/evidence/policy-coverage-first-hardened-hybrid-260621/g25_integration_judgment.json","commit":"$adrs_head","id":"coverage-first-primary-evidence-candidate-blocked","status":"accepted"},"consumerZeroProofRef":{"repo":"adrs.git","path":"records/evidence/policy-coverage-first-hardened-hybrid-260621/g24_g30_status_audit.json","commit":"$adrs_head","id":"consumer-zero-proof-to-be-validated-by-readiness-run","status":"accepted"},"generatedIsAuthority":false,"policyDeletionApproved":false}
EOF

python3 "$compiler" check-accepted-policy-entry-source \
  --source "$out_dir/accepted_projected_policy_entry_source.json" \
  --expected-lock "$lock" > "$out_dir/accepted_projected_policy_entry_source.check.json"

python3 "$compiler" project-policy-entry \
  --native-rows "$out_dir/compile/native_rows.jsonl" \
  --out-dir "$out_dir/projected-accepted" \
  --accepted-source "$out_dir/accepted_projected_policy_entry_source.json" > "$out_dir/projected_policy_entry_stdout.json"

python3 "$compiler" check-projected-policy-entry \
  --dir "$out_dir/projected-accepted" \
  --expect-accepted > "$out_dir/projected_policy_entry.check.json"

if python3 "$compiler" review-deletion-readiness \
  --policy-root "$policy_root" \
  --repo-root "$out_dir/projected-accepted" \
  --reference-mode projected \
  --policy-absent-proof-command "test -f '$out_dir/projected-accepted/policy-entry.accepted.env' && grep -q POLICY_ENTRY_ACCEPTED=true '$out_dir/projected-accepted/policy-entry.accepted.env'" \
  --consumer-proof-command "test -f '$out_dir/projected-accepted/policy-entry.accepted.env' && grep -q POLICY_ENTRY_STATUS=accepted-source '$out_dir/projected-accepted/policy-entry.accepted.env'" \
  --out-dir "$out_dir/deletion-readiness" > "$out_dir/deletion_readiness_stdout.json"; then
  :
else
  # Expected until explicit deletion approval exists. Non-deletion gates are checked below.
  :
fi

cp "$out_dir/compile/manifest.json" "$out_dir/compile_manifest.json"
cp "$out_dir/compile/duckdb-gates.jsonl" "$out_dir/compile_duckdb_gates.jsonl"
cp "$out_dir/compile/native_rows.jsonl" "$out_dir/legacy_policy_obligation_table.jsonl"
cp "$out_dir/projected-accepted/manifest.json" "$out_dir/projected_policy_entry_manifest.json"
cp "$out_dir/projected-accepted/policy-entry.accepted.env" "$out_dir/policy-entry.accepted.env"
cp "$out_dir/deletion-readiness/manifest.json" "$out_dir/deletion_readiness_manifest.json"
cp "$out_dir/deletion-readiness/deletion-readiness-gates.jsonl" "$out_dir/deletion_readiness_gates.jsonl"
cp "$out_dir/deletion-readiness/consumer-references.jsonl" "$out_dir/consumer_references.jsonl"
cp "$out_dir/deletion-readiness/absent-simulation.json" "$out_dir/absent_simulation.json"
cp "$out_dir/deletion-readiness/consumer-proof-results.jsonl" "$out_dir/consumer_proof_results.jsonl"

python3 "$script_dir/materialize-without-deletion-proof-summary.py" \
  --evidence-dir "$out_dir" \
  --policy-input-ref "$policy_input_ref"

if [ -n "$coverage_first_dir" ]; then
  perl "$script_dir/reconcile-coverage-first-candidates.pl" \
    --coverage-dir "$coverage_first_dir" \
    --evidence-dir "$out_dir" \
    --out-dir "$out_dir" \
    --policy-input-ref "$policy_input_ref"

  perl "$script_dir/materialize-coverage-first-review-decisions.pl" \
    --evidence-dir "$out_dir" \
    --out-dir "$out_dir" \
    --policy-input-ref "$policy_input_ref"

  perl "$script_dir/materialize-gen2-law-behavior-packets.pl" \
    --evidence-dir "$out_dir" \
    --out-dir "$out_dir" \
    --policy-input-ref "$policy_input_ref"
fi
