#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --compiler-dir DIR --out-dir DIR" >&2; exit 2; }
compiler_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compiler-dir) compiler_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$compiler_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
summary="$compiler_dir/policy_typed_compiler_review_summary.json"
manifest="$compiler_dir/manifest.json"
edges="$compiler_dir/policy_typed_compiler_edges.jsonl"
sources="$compiler_dir/policy_typed_compiler_source_dispositions.jsonl"
consumers="$compiler_dir/policy_typed_compiler_consumer_dispositions.jsonl"
result_file="$out_dir/policy_typed_compiler_control_results.jsonl"
: > "$result_file"
add_result() { jq -cn --arg name "$1" --argjson passed "$2" --argjson details "$3" '{type:"policy.typedSemanticCompiler.controlResult.v1", name:$name, passed:$passed, details:$details}' >> "$result_file"; }
bool_eq() { [ "$1" = "$2" ] && echo true || echo false; }
bool_zero() { [ "$1" -eq 0 ] && echo true || echo false; }

decision=$(jq -r '.decision' "$summary")
deletion=$(jq -r '.deletionReadiness' "$summary")
source_gate=$(jq -r '.sourceGate.status' "$summary")
consumer_gate=$(jq -r '.consumerGate.status' "$summary")
compiler_gate=$(jq -r '.compilerGate.status' "$summary")
semantic_gate=$(jq -r '.remainingRetirementGates[] | select(.name=="semantic-equivalence-proof") | .status' "$summary")
edge_count=$(jq -r '.compiledEdges' "$summary")
actual_edges=$(wc -l < "$edges" | tr -d ' ')

add_result "compiler-candidate-decision-pass" "$(bool_eq "$decision" PASS_FOR_COMPILER_CANDIDATE)" "$(jq -n --arg decision "$decision" '{decision:$decision}')"
add_result "deletion-readiness-stays-blocked" "$(bool_eq "$deletion" BLOCK)" "$(jq -n --arg deletionReadiness "$deletion" '{deletionReadiness:$deletionReadiness}')"
add_result "source-and-consumer-gates-pass" "$([ "$source_gate" = PASS ] && [ "$consumer_gate" = PASS ] && echo true || echo false)" "$(jq -n --arg source "$source_gate" --arg consumer "$consumer_gate" '{sourceGate:$source, consumerGate:$consumer}')"
add_result "compiler-gate-is-candidate-only" "$(bool_eq "$compiler_gate" PASS_FOR_CANDIDATE)" "$(jq -n --arg compilerGate "$compiler_gate" '{compilerGate:$compilerGate}')"
add_result "semantic-equivalence-stays-blocked" "$(bool_eq "$semantic_gate" BLOCK)" "$(jq -n --arg semanticGate "$semantic_gate" '{semanticGate:$semanticGate}')"
add_result "compiled-edge-count-matches" "$([ "$edge_count" -eq "$actual_edges" ] && echo true || echo false)" "$(jq -n --argjson summaryEdges "$edge_count" --argjson actualEdges "$actual_edges" '{summaryEdges:$summaryEdges, actualEdges:$actualEdges}')"

bad_edges=$(jq -s '[.[] | select(.claimAllowed != false or (.trace? | not) or (.provenance? | not) or .authorityStatus != "candidate-compiled-edge")] | length' "$edges")
add_result "compiled-edges-remain-candidate-traced" "$(bool_zero "$bad_edges")" "$(jq -n --argjson bad "$bad_edges" '{bad:$bad}')"

bad_sources=$(jq -s '[.[] | select(.claimAllowed != false or (.trace? | not))] | length' "$sources")
bad_consumers=$(jq -s '[.[] | select(.claimAllowed != false or (.trace? | not))] | length' "$consumers")
add_result "disposition-records-remain-non-authority-traced" "$([ "$bad_sources" -eq 0 ] && [ "$bad_consumers" -eq 0 ] && echo true || echo false)" "$(jq -n --argjson badSources "$bad_sources" --argjson badConsumers "$bad_consumers" '{badSources:$badSources, badConsumers:$badConsumers}')"

manifest_bad=0
(
  cd "$compiler_dir"
  jq -r '.files[] | [.path,.sha256] | @tsv' manifest.json | while IFS=$(printf '\t') read -r path hash; do
    actual=$(sha256sum "$path" | awk '{print $1}')
    [ "$actual" = "$hash" ] || exit 7
  done
) || manifest_bad=1
add_result "manifest-hashes-validate" "$(bool_zero "$manifest_bad")" "$(jq -n --argjson bad "$manifest_bad" '{bad:$bad}')"

passed=$(jq -s '[.[] | select(.passed == true)] | length' "$result_file")
total=$(jq -s 'length' "$result_file")
control_decision=$([ "$passed" -eq "$total" ] && echo PASS || echo BLOCK)
jq -n --arg decision "$control_decision" --argjson passed "$passed" --argjson total "$total" '{type:"policy.typedSemanticCompiler.controlSummary.v1", decision:$decision, passed:$passed, total:$total, scope:"typed compiler candidate controls; not semantic equivalence or retirement approval"}' > "$out_dir/policy_typed_compiler_control_summary.json"
jq . "$out_dir/policy_typed_compiler_control_summary.json"
