#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --source13-dir DIR --out-dir DIR" >&2; exit 2; }
source13_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source13-dir) source13_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$source13_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
classification="$source13_dir/policy_source13_classification.jsonl"
edges="$source13_dir/policy_source13_typed_edges.jsonl"
summary="$source13_dir/policy_source13_review_summary.json"
result_file="$out_dir/policy_source13_control_results.jsonl"
: > "$result_file"
add_result() { jq -cn --arg name "$1" --argjson passed "$2" --argjson details "$3" '{type:"policy.source13.controlResult.v1", name:$name, passed:$passed, details:$details}' >> "$result_file"; }
bool_zero() { [ "$1" -eq 0 ] && echo true || echo false; }
bool_eq() { [ "$1" = "$2" ] && echo true || echo false; }

total=$(jq -r '.total' "$summary")
still=$(jq -r '.stillUntypedAuthority' "$summary")
typed_edges=$(jq -r '.typedEdgeCount' "$summary")
rows=$(wc -l < "$classification" | tr -d ' ')
edge_rows=$(wc -l < "$edges" | tr -d ' ')
add_result "all-13-input-rows-classified" "$(bool_eq "$total" "$rows")" "$(jq -n --argjson total "$total" --argjson rows "$rows" '{total:$total, rows:$rows}')"
add_result "still-untyped-authority-zero" "$(bool_zero "$still")" "$(jq -n --argjson still "$still" '{stillUntypedAuthority:$still}')"
add_result "typed-edge-count-matches-covered-rows" "$([ "$typed_edges" -eq "$edge_rows" ] && echo true || echo false)" "$(jq -n --argjson typedEdges "$typed_edges" --argjson edgeRows "$edge_rows" '{typedEdges:$typedEdges, edgeRows:$edgeRows}')"

bad_claim=$(jq -s '[.[] | select(.claimAllowed != false or (.evidence? | not) or (.classifierVersion? | not) or (.sourceSha256? | not))] | length' "$classification")
add_result "classification-records-remain-non-authority" "$(bool_zero "$bad_claim")" "$(jq -n --argjson bad "$bad_claim" '{bad:$bad}')"

bad_edges=$(jq -s '[.[] | select(.claimAllowed != false or (.sourceSha256? | not) or (.edgeKind? | not) or (.text? | not))] | length' "$edges")
add_result "typed-edge-records-have-trace-fields" "$(bool_zero "$bad_edges")" "$(jq -n --argjson bad "$bad_edges" '{bad:$bad}')"

retirement_gate=$(jq -r '.gates[] | select(.name=="policy-retirement-still-blocked-by-compiler-and-equivalence") | .status' "$summary")
add_result "retirement-stays-blocked" "$(bool_eq "$retirement_gate" BLOCK)" "$(jq -n --arg gate "$retirement_gate" '{gate:$gate}')"

passed=$(jq -s '[.[] | select(.passed == true)] | length' "$result_file")
control_total=$(jq -s 'length' "$result_file")
decision=$([ "$passed" -eq "$control_total" ] && echo PASS || echo BLOCK)
jq -n --arg decision "$decision" --argjson passed "$passed" --argjson total "$control_total" '{type:"policy.source13.controlSummary.v1", decision:$decision, passed:$passed, total:$total, scope:"source13 classifier controls; not policy retirement approval"}' > "$out_dir/policy_source13_control_summary.json"
jq . "$out_dir/policy_source13_control_summary.json"
