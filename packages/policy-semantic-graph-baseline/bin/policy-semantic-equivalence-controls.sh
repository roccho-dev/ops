#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --compiler-dir DIR --source13-dir DIR --equivalence-dir DIR --out-dir DIR" >&2; exit 2; }
compiler_dir=""; source13_dir=""; equivalence_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compiler-dir) compiler_dir="${2:-}"; shift 2 ;;
    --source13-dir) source13_dir="${2:-}"; shift 2 ;;
    --equivalence-dir) equivalence_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$compiler_dir" ] && [ -n "$source13_dir" ] && [ -n "$equivalence_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
result_file="$out_dir/semantic_equivalence_negative_control_results.jsonl"
: > "$result_file"
add_result() { jq -cn --arg name "$1" --argjson passed "$2" --argjson details "$3" '{type:"policy.semanticEquivalence.negativeControlResult.v1", name:$name, passed:$passed, details:$details}' >> "$result_file"; }
bool_zero() { [ "$1" -eq 0 ] && echo true || echo false; }
bool_nonzero() { [ "$1" -gt 0 ] && echo true || echo false; }

summary="$equivalence_dir/semantic_equivalence_summary.json"
manifest="$equivalence_dir/manifest.json"
source_map="$equivalence_dir/semantic_equivalence_source_map.jsonl"
deltas="$equivalence_dir/semantic_equivalence_deltas.jsonl"

inputs_fixed=$(jq -e '.policyRef != null and .typedCompilerVersion != null and .compilerVersion == "semantic-equivalence-candidate-jq-v1" and .deletionReadiness == "BLOCK"' "$equivalence_dir/semantic_equivalence_inputs.json" >/dev/null && echo true || echo false)
add_result "semantic-equivalence-inputs-fixed" "$inputs_fixed" "$(jq -n --arg policyRef "$(jq -r '.policyRef' "$summary")" '{policyRef:$policyRef}')"

unmapped=$(jq -s '[.[] | select(.disposition == "typed-covered" and .equivalenceStatus != "covered-by-candidate-edge")] | length' "$source_map")
add_result "authority-bearing-sources-covered" "$(bool_zero "$unmapped")" "$(jq -n --argjson unmapped "$unmapped" '{unmapped:$unmapped}')"

unresolved=$(wc -l < "$deltas" | tr -d ' ')
add_result "semantic-deltas-zero-or-blocked" "$(bool_zero "$unresolved")" "$(jq -n --argjson unresolved "$unresolved" --arg decision "$(jq -r '.decision' "$summary")" '{unresolved:$unresolved, decision:$decision}')"

bad_trace=$(jq -s '[.[] | select(.claimAllowed != false or (.trace.sourcePath == null) or (.trace.sourceSha256 == null) or (.trace.typedCompiler == null and .disposition == "typed-covered"))] | length' "$source_map")
add_result "typed-edge-source-trace-valid" "$(bool_zero "$bad_trace")" "$(jq -n --argjson bad "$bad_trace" '{bad:$bad}')"

final_claim_bad=$(jq '[.deletionReadiness, .remainingRetirementGates[].status] | any(. == "PASS" or . == "READY" or . == "APPROVED")' "$summary")
add_result "candidate-does-not-claim-final-authority" "$([ "$final_claim_bad" = false ] && echo true || echo false)" "$(jq -n --argjson finalClaimBad "$final_claim_bad" '{finalClaimBad:$finalClaimBad}')"

manifest_bad=0
(
  cd "$equivalence_dir"
  jq -r '.files[] | [.path,.sha256] | @tsv' manifest.json | while IFS=$(printf '\t') read -r path hash; do
    actual=$(sha256sum "$path" | awk '{print $1}')
    [ "$actual" = "$hash" ] || exit 7
  done
) || manifest_bad=1
add_result "manifest-hashes-validate" "$(bool_zero "$manifest_bad")" "$(jq -n --argjson bad "$manifest_bad" '{bad:$bad}')"

rerun_dir="$out_dir/rerun"
rm -rf "$rerun_dir"
"$(dirname "$0")/policy-semantic-equivalence-candidate.sh" --compiler-dir "$compiler_dir" --source13-dir "$source13_dir" --out-dir "$rerun_dir" >/dev/null
orig_hash=$(jq -S . "$equivalence_dir/manifest.json" | sha256sum | awk '{print $1}')
rerun_hash=$(jq -S . "$rerun_dir/manifest.json" | sha256sum | awk '{print $1}')
rerun_pass=$([ "$orig_hash" = "$rerun_hash" ] && echo true || echo false)
jq -n --arg type "policy.semanticEquivalence.deterministicRerunReceipt.v1" --arg originalManifestSha256 "$orig_hash" --arg rerunManifestSha256 "$rerun_hash" --argjson passed "$rerun_pass" '{type:$type, passed:$passed, originalManifestSha256:$originalManifestSha256, rerunManifestSha256:$rerunManifestSha256}' > "$out_dir/deterministic_rerun_receipt.json"
add_result "deterministic-rerun-match" "$rerun_pass" "$(cat "$out_dir/deterministic_rerun_receipt.json")"

# Mutation controls. Each must be detected by producing at least one semantic delta or final-authority violation.
mut_root="$out_dir/mutations"
rm -rf "$mut_root"; mkdir -p "$mut_root/drop" "$mut_root/text" "$mut_root/hash" "$mut_root/generated" "$mut_root/trace" "$mut_root/final"
cp -R "$compiler_dir"/. "$mut_root/drop/"; tail -n +2 "$compiler_dir/policy_typed_compiler_edges.jsonl" > "$mut_root/drop/policy_typed_compiler_edges.jsonl"
"$(dirname "$0")/policy-semantic-equivalence-candidate.sh" --compiler-dir "$mut_root/drop" --source13-dir "$source13_dir" --out-dir "$mut_root/drop/out" >/dev/null
add_result "negative-dropped-edge-detected" "$(bool_nonzero "$(wc -l < "$mut_root/drop/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')")" "$(jq -n --argjson deltas "$(wc -l < "$mut_root/drop/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')" '{deltas:$deltas}')"

cp -R "$compiler_dir"/. "$mut_root/text/"; jq -c 'if input_line_number == 1 then .text = "WEAKENED TEXT" else . end' "$compiler_dir/policy_typed_compiler_edges.jsonl" > "$mut_root/text/policy_typed_compiler_edges.jsonl"
"$(dirname "$0")/policy-semantic-equivalence-candidate.sh" --compiler-dir "$mut_root/text" --source13-dir "$source13_dir" --out-dir "$mut_root/text/out" >/dev/null
add_result "negative-weakened-text-detected" "$(bool_nonzero "$(wc -l < "$mut_root/text/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')")" "$(jq -n --argjson deltas "$(wc -l < "$mut_root/text/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')" '{deltas:$deltas}')"

cp -R "$compiler_dir"/. "$mut_root/hash/"; jq -c 'if input_line_number == 1 then .sourceSha256 = "stale" | .trace.sourceSha256 = "stale" else . end' "$compiler_dir/policy_typed_compiler_edges.jsonl" > "$mut_root/hash/policy_typed_compiler_edges.jsonl"
"$(dirname "$0")/policy-semantic-equivalence-candidate.sh" --compiler-dir "$mut_root/hash" --source13-dir "$source13_dir" --out-dir "$mut_root/hash/out" >/dev/null
add_result "negative-stale-source-hash-detected" "$(bool_nonzero "$(wc -l < "$mut_root/hash/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')")" "$(jq -n --argjson deltas "$(wc -l < "$mut_root/hash/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')" '{deltas:$deltas}')"

cp -R "$source13_dir"/. "$mut_root/generated/"; jq -c 'if input_line_number == 1 then .disposition = "typed-covered" else . end' "$source13_dir/policy_source13_classification.jsonl" > "$mut_root/generated/policy_source13_classification.jsonl"
"$(dirname "$0")/policy-semantic-equivalence-candidate.sh" --compiler-dir "$compiler_dir" --source13-dir "$mut_root/generated" --out-dir "$mut_root/generated/out" >/dev/null
add_result "negative-generated-authority-confusion-detected" "$(bool_nonzero "$(wc -l < "$mut_root/generated/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')")" "$(jq -n --argjson deltas "$(wc -l < "$mut_root/generated/out/semantic_equivalence_deltas.jsonl" | tr -d ' ')" '{deltas:$deltas}')"

cp "$summary" "$mut_root/final/summary.json"; jq '.deletionReadiness="READY"' "$summary" > "$mut_root/final/summary-mutated.json"
final_detected=$(jq '[.deletionReadiness, .remainingRetirementGates[].status] | any(. == "PASS" or . == "READY" or . == "APPROVED")' "$mut_root/final/summary-mutated.json")
add_result "negative-final-authority-claim-detected" "$final_detected" "$(jq -n --argjson detected "$final_detected" '{detected:$detected}')"

passed=$(jq -s '[.[] | select(.passed == true)] | length' "$result_file")
total=$(jq -s 'length' "$result_file")
decision=$([ "$passed" -eq "$total" ] && echo PASS || echo BLOCK)
jq -n --arg decision "$decision" --argjson passed "$passed" --argjson total "$total" '{type:"policy.semanticEquivalence.negativeControlSummary.v1", decision:$decision, passed:$passed, total:$total, deletionReadiness:"BLOCK", scope:"candidate equivalence controls; not retirement approval"}' > "$out_dir/semantic_equivalence_negative_control_summary.json"
jq . "$out_dir/semantic_equivalence_negative_control_summary.json"
