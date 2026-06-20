#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --bridge-dir DIR --out-dir DIR" >&2; exit 2; }
bridge_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --bridge-dir) bridge_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$bridge_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
summary="$bridge_dir/policy_typed_bridge_review_summary.json"
gates="$bridge_dir/policy_typed_bridge_deletion_readiness_gates.json"
source_exclusions="$bridge_dir/policy_typed_source_exclusions.jsonl"
source_unresolved="$bridge_dir/policy_typed_source_unresolved.jsonl"
consumer_exclusions="$bridge_dir/policy_typed_consumer_exclusions.jsonl"
consumer_unresolved="$bridge_dir/policy_typed_consumer_unresolved.jsonl"
policy_ref=$(jq -r '.policyRef' "$summary")
result_file="$out_dir/policy_typed_bridge_control_results.jsonl"
: > "$result_file"
add_result() {
  local name="$1" passed="$2" details="$3"
  jq -cn --arg name "$name" --argjson passed "$passed" --argjson details "$details" '{type:"policy.typedBridge.controlResult.v1", name:$name, passed:$passed, details:$details}' >> "$result_file"
}
bool() { if "$@"; then echo true; else echo false; fi; }

source_remaining=$(jq -r '.sourceReduction.remainingRows' "$summary")
consumer_remaining=$(jq -r '.consumerReduction.remainingRows' "$summary")
compiler_gate=$(jq -r '.gates[] | select(.name=="typed-semantic-compiler-accepted") | .status' "$gates")
source_gate=$(jq -r '.gates[] | select(.name=="authority-bearing-untyped-sources-eliminated") | .status' "$gates")
consumer_gate=$(jq -r '.gates[] | select(.name=="active-runtime-policy-consumers-eliminated") | .status' "$gates")

passed=$(bool sh -c '[ "$1" -gt 0 ] && [ "$2" = BLOCK ]' _ "$source_remaining" "$source_gate")
add_result "source-exclusions-do-not-clear-gate" "$passed" "$(jq -n --argjson remaining "$source_remaining" --arg gate "$source_gate" '{remaining:$remaining, gate:$gate}')"
passed=$(bool sh -c '[ "$1" -gt 0 ] && [ "$2" = BLOCK ]' _ "$consumer_remaining" "$consumer_gate")
add_result "consumer-exclusions-do-not-clear-gate" "$passed" "$(jq -n --argjson remaining "$consumer_remaining" --arg gate "$consumer_gate" '{remaining:$remaining, gate:$gate}')"
passed=$(bool sh -c '[ "$1" = BLOCK ]' _ "$compiler_gate")
add_result "typed-compiler-still-blocks" "$passed" "$(jq -n --arg gate "$compiler_gate" '{gate:$gate}')"

source_exclusion_missing=$(jq -s '[.[] | select(.claimAllowed != false or (.classifierVersion? | not) or (.evidence? | not) or (.sourceFile? | not) or (.reductionReason? | not))] | length' "$source_exclusions")
passed=$(bool sh -c '[ "$1" -eq 0 ]' _ "$source_exclusion_missing")
add_result "source-exclusions-have-required-fields" "$passed" "$(jq -n --argjson missing "$source_exclusion_missing" '{missing:$missing}')"

consumer_exclusion_missing=$(jq -s '[.[] | select(.claimAllowed != false or (.classifierVersion? | not) or (.evidence? | not) or (.sourceFile? | not) or (.reductionReason? | not))] | length' "$consumer_exclusions")
passed=$(bool sh -c '[ "$1" -eq 0 ]' _ "$consumer_exclusion_missing")
add_result "consumer-exclusions-have-required-fields" "$passed" "$(jq -n --argjson missing "$consumer_exclusion_missing" '{missing:$missing}')"

source_unresolved_count=$(wc -l < "$source_unresolved" | tr -d ' ')
consumer_unresolved_count=$(wc -l < "$consumer_unresolved" | tr -d ' ')
passed=$(bool sh -c '[ "$1" -eq "$2" ] && [ "$3" -eq "$4" ]' _ "$source_unresolved_count" "$source_remaining" "$consumer_unresolved_count" "$consumer_remaining")
add_result "unresolved-records-machine-readable" "$passed" "$(jq -n --argjson source "$source_unresolved_count" --argjson consumer "$consumer_unresolved_count" '{sourceUnresolvedRows:$source, consumerUnresolvedRows:$consumer}')"

non_active_bad=$(jq -s '[.[] | select(.bridgeStatus != "excluded-non-active" or .countsTowardConsumerGate != false)] | length' "$consumer_exclusions")
passed=$(bool sh -c '[ "$1" -eq 0 ]' _ "$non_active_bad")
add_result "non-active-consumer-refs-excluded-only" "$passed" "$(jq -n --argjson bad "$non_active_bad" '{bad:$bad}')"

active_bad=$(jq -s '[.[] | select(.bridgeStatus != "unresolved-active-runtime-candidate" or .countsTowardConsumerGate != true)] | length' "$consumer_unresolved")
passed=$(bool sh -c '[ "$1" -eq 0 ]' _ "$active_bad")
add_result "active-runtime-candidates-preserved" "$passed" "$(jq -n --argjson bad "$active_bad" '{bad:$bad}')"

source_unresolved_bad=$(jq -s '[.[] | select(.bridgeStatus != "unresolved-authority-candidate" or .countsTowardDeletionGate != true)] | length' "$source_unresolved")
passed=$(bool sh -c '[ "$1" -eq 0 ]' _ "$source_unresolved_bad")
add_result "authority-source-candidates-preserved" "$passed" "$(jq -n --argjson bad "$source_unresolved_bad" '{bad:$bad}')"

passed_count=$(jq -s '[.[] | select(.passed == true)] | length' "$result_file")
total=$(jq -s 'length' "$result_file")
decision=$([ "$passed_count" -eq "$total" ] && echo PASS || echo BLOCK)
jq -n --arg policyRef "$policy_ref" --arg decision "$decision" --argjson passed "$passed_count" --argjson total "$total" '{type:"policy.typedBridge.controlSummary.v1", policyRef:$policyRef, decision:$decision, passed:$passed, total:$total, scope:"bridge reducer controls; not deletion readiness"}' > "$out_dir/policy_typed_bridge_control_summary.json"
jq . "$out_dir/policy_typed_bridge_control_summary.json"
