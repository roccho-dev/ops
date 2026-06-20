#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --baseline-dir DIR --out-dir DIR" >&2; exit 2; }
baseline_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline-dir) baseline_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$baseline_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
summary="$baseline_dir/REVIEW_SUMMARY.json"
gates="$baseline_dir/policy_deletion_readiness_gates.json"
untyped="$baseline_dir/policy_untyped_sources.jsonl"
consumers="$baseline_dir/policy_consumer_refs.jsonl"
policy_ref=$(jq -r '.policyRef' "$summary")
classifier_version="typed-bridge-jq-v1"

jq -c --arg classifierVersion "$classifier_version" '
  def non_authority: (.sourceClass as $c | (["code","evidence","package-metadata"] | index($c)) != null) and ((.normative // false) | not);
  . as $row |
  {
    type: "policy.typedBridge.sourceReduction.v1",
    path: $row.path,
    sourceFile: $row.path,
    kind: $row.kind,
    sourceClass: $row.sourceClass,
    normative: ($row.normative // false),
    classificationReason: $row.classificationReason,
    baselineReason: $row.reason,
    classifierVersion: $classifierVersion,
    claimAllowed: false,
    evidence: {baselineRecord: $row, classifier: "sourceClass plus normative flag from baseline"}
  }
  + if non_authority then {
      bridgeStatus: "excluded-non-authority",
      countsTowardDeletionGate: false,
      reductionReason: (($row.sourceClass // "<missing>") + " is not a policy authority-bearing source")
    } else {
      bridgeStatus: "unresolved-authority-candidate",
      countsTowardDeletionGate: true,
      reductionReason: "authority-bearing or unknown source still lacks typed semantic edges"
    } end
' "$untyped" > "$out_dir/policy_typed_source_reduction.jsonl"

jq -c --arg classifierVersion "$classifier_version" '
  def non_active: (.refClass as $c | (["documentation","generated-evidence","path-mention"] | index($c)) != null) and ((.activeRuntimeCandidate // false) | not);
  . as $row |
  {
    type: "policy.typedBridge.consumerReduction.v1",
    sourcePath: $row.sourcePath,
    sourceFile: $row.sourcePath,
    line: $row.line,
    text: $row.text,
    refClass: $row.refClass,
    activeRuntimeCandidate: ($row.activeRuntimeCandidate // false),
    classificationReason: $row.classificationReason,
    classifierVersion: $classifierVersion,
    claimAllowed: false,
    evidence: {baselineRecord: $row, classifier: "refClass plus activeRuntimeCandidate flag from baseline"}
  }
  + if non_active then {
      bridgeStatus: "excluded-non-active",
      countsTowardConsumerGate: false,
      reductionReason: (($row.refClass // "<missing>") + " is not an active runtime policy.git dependency")
    } else {
      bridgeStatus: "unresolved-active-runtime-candidate",
      countsTowardConsumerGate: true,
      reductionReason: "active runtime candidate must be removed or proven false positive"
    } end
' "$consumers" > "$out_dir/policy_typed_consumer_reduction.jsonl"

jq -c 'select(.countsTowardDeletionGate == false)' "$out_dir/policy_typed_source_reduction.jsonl" > "$out_dir/policy_typed_source_exclusions.jsonl"
jq -c 'select(.countsTowardDeletionGate == true)' "$out_dir/policy_typed_source_reduction.jsonl" > "$out_dir/policy_typed_source_unresolved.jsonl"
jq -c 'select(.countsTowardConsumerGate == false)' "$out_dir/policy_typed_consumer_reduction.jsonl" > "$out_dir/policy_typed_consumer_exclusions.jsonl"
jq -c 'select(.countsTowardConsumerGate == true)' "$out_dir/policy_typed_consumer_reduction.jsonl" > "$out_dir/policy_typed_consumer_unresolved.jsonl"

source_baseline=$(wc -l < "$untyped" | tr -d ' ')
source_remaining=$(jq -s '[.[] | select(.countsTowardDeletionGate == true)] | length' "$out_dir/policy_typed_source_reduction.jsonl")
source_excluded=$((source_baseline - source_remaining))
consumer_baseline=$(wc -l < "$consumers" | tr -d ' ')
consumer_remaining=$(jq -s '[.[] | select(.countsTowardConsumerGate == true)] | length' "$out_dir/policy_typed_consumer_reduction.jsonl")
consumer_excluded=$((consumer_baseline - consumer_remaining))

jq -n \
  --arg policyRef "$policy_ref" \
  --arg classifierVersion "$classifier_version" \
  --argjson sourceBaselineRows "$source_baseline" \
  --argjson sourceRowsExcludedAsNonAuthority "$source_excluded" \
  --argjson sourceRowsRemaining "$source_remaining" \
  --argjson consumerBaselineRows "$consumer_baseline" \
  --argjson consumerRowsExcludedAsNonActive "$consumer_excluded" \
  --argjson consumerRowsRemaining "$consumer_remaining" \
  --slurpfile summary "$summary" '
{
  type: "policy.typedBridge.deletionReadinessGates.v1",
  policyRef: $policyRef,
  classifierVersion: $classifierVersion,
  decision: "BLOCK",
  sourceBaselineRows: $sourceBaselineRows,
  sourceRowsExcludedAsNonAuthority: $sourceRowsExcludedAsNonAuthority,
  sourceRowsRemaining: $sourceRowsRemaining,
  consumerBaselineRows: $consumerBaselineRows,
  consumerRowsExcludedAsNonActive: $consumerRowsExcludedAsNonActive,
  consumerRowsRemaining: $consumerRowsRemaining,
  gates: [
    {name: "authority-bearing-untyped-sources-eliminated", status: (if $sourceRowsRemaining == 0 then "PASS" else "BLOCK" end), actual: $sourceRowsRemaining, expected: 0},
    {name: "active-runtime-policy-consumers-eliminated", status: (if $consumerRowsRemaining == 0 then "PASS" else "BLOCK" end), actual: $consumerRowsRemaining, expected: 0},
    {name: "typed-semantic-compiler-accepted", status: "BLOCK", actual: "typed-bridge-over-heuristic-baseline", expected: "accepted typed semantic graph compiler"}
  ],
  notDeletionReady: true,
  mustNotClaim: ($summary[0].mustNotClaim // [])
}
' > "$out_dir/policy_typed_bridge_deletion_readiness_gates.json"

remaining_by_source=$(jq -s '[.[] | select(.countsTowardDeletionGate == true)] | group_by(.sourceClass // "<missing>") | map({key: (.[0].sourceClass // "<missing>"), value: length}) | from_entries' "$out_dir/policy_typed_source_reduction.jsonl")
excluded_by_source=$(jq -s '[.[] | select(.countsTowardDeletionGate == false)] | group_by(.sourceClass // "<missing>") | map({key: (.[0].sourceClass // "<missing>"), value: length}) | from_entries' "$out_dir/policy_typed_source_reduction.jsonl")
remaining_by_consumer=$(jq -s '[.[] | select(.countsTowardConsumerGate == true)] | group_by(.refClass // "<missing>") | map({key: (.[0].refClass // "<missing>"), value: length}) | from_entries' "$out_dir/policy_typed_consumer_reduction.jsonl")
excluded_by_consumer=$(jq -s '[.[] | select(.countsTowardConsumerGate == false)] | group_by(.refClass // "<missing>") | map({key: (.[0].refClass // "<missing>"), value: length}) | from_entries' "$out_dir/policy_typed_consumer_reduction.jsonl")

jq -n \
  --arg policyRef "$policy_ref" \
  --arg classifierVersion "$classifier_version" \
  --argjson sourceBaselineRows "$source_baseline" \
  --argjson sourceExcludedRows "$source_excluded" \
  --argjson sourceRemainingRows "$source_remaining" \
  --argjson consumerBaselineRows "$consumer_baseline" \
  --argjson consumerExcludedRows "$consumer_excluded" \
  --argjson consumerRemainingRows "$consumer_remaining" \
  --argjson remainingBySourceClass "$remaining_by_source" \
  --argjson excludedBySourceClass "$excluded_by_source" \
  --argjson remainingByRefClass "$remaining_by_consumer" \
  --argjson excludedByRefClass "$excluded_by_consumer" \
  --slurpfile summary "$summary" \
  --slurpfile gates "$gates" \
  --slurpfile bridgeGates "$out_dir/policy_typed_bridge_deletion_readiness_gates.json" '
{
  type: "policy.typedBridge.reviewSummary.v1",
  policyRef: $policyRef,
  classifierVersion: $classifierVersion,
  decision: "BLOCK",
  purpose: "Reduce false blockers by preserving explicit non-authority and non-active exclusion records while keeping real policy.git retirement gates blocked.",
  baselineDecision: $summary[0].decision,
  baselineGates: ($gates[0].gates // []),
  sourceReduction: {baselineRows: $sourceBaselineRows, excludedRows: $sourceExcludedRows, remainingRows: $sourceRemainingRows, remainingBySourceClass: $remainingBySourceClass, excludedBySourceClass: $excludedBySourceClass, exclusions: "policy_typed_source_exclusions.jsonl", unresolved: "policy_typed_source_unresolved.jsonl"},
  consumerReduction: {baselineRows: $consumerBaselineRows, excludedRows: $consumerExcludedRows, remainingRows: $consumerRemainingRows, remainingByRefClass: $remainingByRefClass, excludedByRefClass: $excludedByRefClass, exclusions: "policy_typed_consumer_exclusions.jsonl", unresolved: "policy_typed_consumer_unresolved.jsonl"},
  bridgeGates: ($bridgeGates[0].gates // []),
  mustNotClaim: ($summary[0].mustNotClaim // []),
  reviewLimit: "This bridge is not final semantic equivalence proof. It is a reviewable typed reduction over the existing heuristic baseline."
}
' > "$out_dir/policy_typed_bridge_review_summary.json"

(
  cd "$out_dir"
  find . -type f ! -name manifest.json | sort | while read -r path; do
    clean=${path#./}; bytes=$(wc -c < "$clean" | tr -d ' '); hash=$(sha256sum "$clean" | awk '{print $1}')
    jq -cn --arg path "$clean" --arg sha256 "$hash" --argjson bytes "$bytes" '{path:$path,sha256:$sha256,bytes:$bytes}'
  done | jq -s --arg policyRef "$policy_ref" --arg classifierVersion "$classifier_version" '{type:"policy.typedBridge.manifest.v1", policyRef:$policyRef, classifierVersion:$classifierVersion, decision:"BLOCK", files:.}' > manifest.json
)

jq -cn --arg outDir "$out_dir" --argjson sourceBaselineRows "$source_baseline" --argjson sourceRowsRemaining "$source_remaining" --argjson consumerBaselineRows "$consumer_baseline" --argjson consumerRowsRemaining "$consumer_remaining" '{decision:"BLOCK", sourceBaselineRows:$sourceBaselineRows, sourceRowsRemaining:$sourceRowsRemaining, consumerBaselineRows:$consumerBaselineRows, consumerRowsRemaining:$consumerRowsRemaining, outDir:$outDir}'
