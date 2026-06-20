#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --consumer-unresolved JSONL --out-dir DIR" >&2; exit 2; }
consumer_unresolved=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --consumer-unresolved) consumer_unresolved="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$consumer_unresolved" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
classifier_version="consumer-cutover-jq-v1"

jq -c --arg classifierVersion "$classifier_version" '
  def has(s): ((.text // "") | contains(s));
  def path_has(s): ((.sourcePath // "") | contains(s));
  . as $row |
  (
    if has("mmdflux-policy") or has("test-assertion-policy") then
      {class:"false-positive-package-name", active:false, reason:"policy appears inside package/module name, not policy.git dependency"}
    elif has("protocol/guard/eval/policy") or has("policy/protocol/eval/schema/security") then
      {class:"false-positive-domain-word", active:false, reason:"policy is domain vocabulary in protocol/eval/schema text"}
    elif path_has("tests/fixtures/") then
      {class:"fixture-only", active:false, reason:"policy.git URL appears in test fixture, not active runtime dependency"}
    elif path_has("templates/") then
      {class:"template-only", active:false, reason:"policy path appears in template material, not active runtime dependency"}
    elif has("/policy.git") and ((.text // "") | startswith("#")) then
      {class:"commented-example", active:false, reason:"policy.git URL is in comment/example text"}
    elif has("/policy.git") then
      {class:"still-active-policy-git-candidate", active:true, reason:"policy.git URL appears outside recognized non-runtime surfaces"}
    elif has("/repos/policy/") then
      {class:"still-active-policy-repo-path-candidate", active:true, reason:"policy repo path appears outside recognized non-runtime surfaces"}
    else
      {class:"false-positive-generic-policy-token", active:false, reason:"no policy.git or policy repo path dependency present"}
    end
  ) as $class |
  {
    type:"policy.consumerCutover.classification.v1",
    classifierVersion:$classifierVersion,
    sourcePath:$row.sourcePath,
    line:$row.line,
    text:$row.text,
    originalRefClass:$row.refClass,
    cutoverClass:$class.class,
    activePolicyGitRuntimeConsumer:$class.active,
    classificationReason:$class.reason,
    claimAllowed:false,
    evidence:{baselineRecord:$row}
  }
' "$consumer_unresolved" > "$out_dir/policy_consumer_cutover_classification.jsonl"

jq -c 'select(.activePolicyGitRuntimeConsumer == true)' "$out_dir/policy_consumer_cutover_classification.jsonl" > "$out_dir/policy_consumer_cutover_still_active.jsonl"
jq -c 'select(.activePolicyGitRuntimeConsumer == false)' "$out_dir/policy_consumer_cutover_classification.jsonl" > "$out_dir/policy_consumer_cutover_resolved.jsonl"

total=$(wc -l < "$out_dir/policy_consumer_cutover_classification.jsonl" | tr -d ' ')
still_active=$(wc -l < "$out_dir/policy_consumer_cutover_still_active.jsonl" | tr -d ' ')
resolved=$((total - still_active))
by_class=$(jq -s 'group_by(.cutoverClass) | map({key:.[0].cutoverClass, value:length}) | from_entries' "$out_dir/policy_consumer_cutover_classification.jsonl")

jq -n --arg classifierVersion "$classifier_version" --argjson total "$total" --argjson resolved "$resolved" --argjson stillActive "$still_active" --argjson byClass "$by_class" '{type:"policy.consumerCutover.reviewSummary.v1", classifierVersion:$classifierVersion, decision:(if $stillActive == 0 then "PASS" else "BLOCK" end), deletionReadiness:"BLOCK", total:$total, resolved:$resolved, stillActive:$stillActive, byClass:$byClass, gates:[{name:"active-policy-git-runtime-consumers-eliminated", status:(if $stillActive == 0 then "PASS" else "BLOCK" end), actual:$stillActive, expected:0},{name:"policy-retirement-still-blocked-by-non-consumer-gates", status:"BLOCK", actual:"source/typed-compiler/semantic-equivalence gates remain", expected:"all retirement gates pass"}], mustNotClaim:["policy.git retirement","policy.git deletion","cutover approval","merge approval","completion approval","semantic approval","canonical write","SSOT write"]}' > "$out_dir/policy_consumer_cutover_review_summary.json"

jq -cn --argjson total "$total" --argjson stillActive "$still_active" '{decision:(if $stillActive == 0 then "PASS" else "BLOCK" end), total:$total, stillActive:$stillActive, outDir:"policy-consumer-cutover-260620"}'
