#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --cutover-dir DIR --out-dir DIR" >&2; exit 2; }
cutover_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --cutover-dir) cutover_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$cutover_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
classification="$cutover_dir/policy_consumer_cutover_classification.jsonl"
summary="$cutover_dir/policy_consumer_cutover_review_summary.json"
result_file="$out_dir/policy_consumer_cutover_control_results.jsonl"
: > "$result_file"
add_result() { jq -cn --arg name "$1" --argjson passed "$2" --argjson details "$3" '{type:"policy.consumerCutover.controlResult.v1", name:$name, passed:$passed, details:$details}' >> "$result_file"; }
bool_eq() { [ "$1" = "$2" ] && echo true || echo false; }
bool_zero() { [ "$1" -eq 0 ] && echo true || echo false; }

total=$(jq -r '.total' "$summary")
still_active=$(jq -r '.stillActive' "$summary")
row_count=$(wc -l < "$classification" | tr -d ' ')
add_result "all-input-rows-classified" "$(bool_eq "$total" "$row_count")" "$(jq -n --argjson total "$total" --argjson rows "$row_count" '{total:$total, rows:$rows}')"
add_result "still-active-zero" "$(bool_zero "$still_active")" "$(jq -n --argjson stillActive "$still_active" '{stillActive:$stillActive}')"

bad_policy_git=$(jq -s '[.[] | select((.text // "" | contains("/policy.git")) and .activePolicyGitRuntimeConsumer != false)] | length' "$classification")
add_result "policy-git-url-mentions-are-non-runtime" "$(bool_zero "$bad_policy_git")" "$(jq -n --argjson bad "$bad_policy_git" '{bad:$bad}')"

bad_package=$(jq -s '[.[] | select(.cutoverClass == "false-positive-package-name" and .activePolicyGitRuntimeConsumer != false)] | length' "$classification")
add_result "package-name-policy-is-not-runtime-dependency" "$(bool_zero "$bad_package")" "$(jq -n --argjson bad "$bad_package" '{bad:$bad}')"

bad_claim=$(jq -s '[.[] | select(.claimAllowed != false or (.evidence? | not) or (.classifierVersion? | not))] | length' "$classification")
add_result "classification-records-remain-non-authority" "$(bool_zero "$bad_claim")" "$(jq -n --argjson bad "$bad_claim" '{bad:$bad}')"

retirement_gate=$(jq -r '.gates[] | select(.name=="policy-retirement-still-blocked-by-non-consumer-gates") | .status' "$summary")
add_result "retirement-stays-blocked" "$(bool_eq "$retirement_gate" BLOCK)" "$(jq -n --arg gate "$retirement_gate" '{gate:$gate}')"

passed=$(jq -s '[.[] | select(.passed == true)] | length' "$result_file")
control_total=$(jq -s 'length' "$result_file")
decision=$([ "$passed" -eq "$control_total" ] && echo PASS || echo BLOCK)
jq -n --arg decision "$decision" --argjson passed "$passed" --argjson total "$control_total" '{type:"policy.consumerCutover.controlSummary.v1", decision:$decision, passed:$passed, total:$total, scope:"consumer cutover classifier controls; not policy retirement approval"}' > "$out_dir/policy_consumer_cutover_control_summary.json"
jq . "$out_dir/policy_consumer_cutover_control_summary.json"
