#!/usr/bin/env bash
set -euo pipefail
usage() {
  echo "usage: $0 --bridge-dir DIR --consumer-dir DIR --source13-dir DIR --out-dir DIR" >&2
  exit 2
}
bridge_dir=""; consumer_dir=""; source13_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --bridge-dir) bridge_dir="${2:-}"; shift 2 ;;
    --consumer-dir) consumer_dir="${2:-}"; shift 2 ;;
    --source13-dir) source13_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$bridge_dir" ] && [ -n "$consumer_dir" ] && [ -n "$source13_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
compiler_version="typed-semantic-compiler-candidate-jq-v1"
bridge_summary="$bridge_dir/policy_typed_bridge_review_summary.json"
consumer_summary="$consumer_dir/policy_consumer_cutover_review_summary.json"
source13_summary="$source13_dir/policy_source13_review_summary.json"
source13_edges="$source13_dir/policy_source13_typed_edges.jsonl"
policy_ref=$(jq -r '.policyRef' "$bridge_summary")

jq -n \
  --arg compilerVersion "$compiler_version" \
  --arg policyRef "$policy_ref" \
  --slurpfile bridge "$bridge_summary" \
  --slurpfile consumer "$consumer_summary" \
  --slurpfile source13 "$source13_summary" '
{
  type:"policy.typedSemanticCompiler.inputs.v1",
  compilerVersion:$compilerVersion,
  policyRef:$policyRef,
  inputs:{
    typedBridge:{path:"policy_typed_bridge_review_summary.json", sha256:null, decision:$bridge[0].decision},
    consumerCutover:{path:"policy_consumer_cutover_review_summary.json", sha256:null, decision:$consumer[0].decision},
    source13:{path:"policy_source13_review_summary.json", sha256:null, decision:$source13[0].decision}
  },
  inputDecisions:{
    bridge:$bridge[0].decision,
    consumerCutover:$consumer[0].decision,
    source13:$source13[0].decision,
    deletionReadiness:$bridge[0].decision
  }
}
' > "$out_dir/policy_typed_compiler_inputs.json"

jq -c --arg compilerVersion "$compiler_version" '
  . as $edge |
  {
    type:"policy.typedSemanticCompiler.edge.v1",
    compilerVersion:$compilerVersion,
    sourcePath:$edge.sourcePath,
    sourceSha256:$edge.sourceSha256,
    edgeKind:$edge.edgeKind,
    text:$edge.text,
    trace:{sourcePath:$edge.sourcePath, sourceSha256:$edge.sourceSha256},
    provenance:{sourceRecordType:$edge.type, extraction:$edge.extraction},
    authorityStatus:"candidate-compiled-edge",
    claimAllowed:false
  }
' "$source13_edges" > "$out_dir/policy_typed_compiler_edges.jsonl"

jq -c --arg compilerVersion "$compiler_version" '{type:"policy.typedSemanticCompiler.sourceDisposition.v1", compilerVersion:$compilerVersion, sourcePath, disposition, source13Class, countsTowardDeletionGate, reason, trace:{sourceSha256}, claimAllowed:false}' "$source13_dir/policy_source13_classification.jsonl" > "$out_dir/policy_typed_compiler_source_dispositions.jsonl"
jq -c --arg compilerVersion "$compiler_version" '{type:"policy.typedSemanticCompiler.consumerDisposition.v1", compilerVersion:$compilerVersion, sourcePath, line, cutoverClass, activePolicyGitRuntimeConsumer, classificationReason, trace:{text}, claimAllowed:false}' "$consumer_dir/policy_consumer_cutover_classification.jsonl" > "$out_dir/policy_typed_compiler_consumer_dispositions.jsonl"

edge_count=$(wc -l < "$out_dir/policy_typed_compiler_edges.jsonl" | tr -d ' ')
source_untyped=$(jq -r '.stillUntypedAuthority' "$source13_summary")
consumer_active=$(jq -r '.stillActive' "$consumer_summary")
bridge_source_remaining=$(jq -r '.sourceReduction.remainingRows' "$bridge_summary")
bridge_consumer_remaining=$(jq -r '.consumerReduction.remainingRows' "$bridge_summary")

jq -n \
  --arg compilerVersion "$compiler_version" \
  --arg policyRef "$policy_ref" \
  --argjson edgeCount "$edge_count" \
  --argjson sourceUntyped "$source_untyped" \
  --argjson consumerActive "$consumer_active" \
  --argjson bridgeSourceRemaining "$bridge_source_remaining" \
  --argjson bridgeConsumerRemaining "$bridge_consumer_remaining" '
{
  type:"policy.typedSemanticCompiler.reviewSummary.v1",
  compilerVersion:$compilerVersion,
  policyRef:$policyRef,
  decision:"PASS_FOR_COMPILER_CANDIDATE",
  deletionReadiness:"BLOCK",
  purpose:"Deterministically compile reviewed bridge, consumer cutover, and source13 evidence into typed candidate graph/disposition outputs without claiming semantic equivalence or retirement approval.",
  compiledEdges:$edgeCount,
  sourceGate:{status:(if $sourceUntyped == 0 then "PASS" else "BLOCK" end), actual:$sourceUntyped, expected:0},
  consumerGate:{status:(if $consumerActive == 0 then "PASS" else "BLOCK" end), actual:$consumerActive, expected:0},
  upstreamBridgeRemainders:{sourceRowsBeforeSource13:$bridgeSourceRemaining, consumerRowsBeforeConsumerCutover:$bridgeConsumerRemaining},
  compilerGate:{status:"PASS_FOR_CANDIDATE", actual:$compilerVersion, expected:"deterministic reviewed compiler candidate"},
  remainingRetirementGates:[
    {name:"semantic-equivalence-proof", status:"BLOCK", actual:"not proven by compiler candidate", expected:"accepted equivalence proof against natural-language policy"},
    {name:"owner/adoption-gates", status:"BLOCK", actual:"not granted", expected:"owner approval and adoption/cutover records"},
    {name:"end-to-end-retirement-proof", status:"BLOCK", actual:"not proven", expected:"policy.git absent or retired with all consumers passing"}
  ],
  mustNotClaim:["policy.git retirement","policy.git deletion","cutover approval","merge approval","completion approval","semantic approval","canonical write","SSOT write"]
}
' > "$out_dir/policy_typed_compiler_review_summary.json"

(
  cd "$out_dir"
  find . -type f ! -name manifest.json | sort | while read -r path; do
    clean=${path#./}; bytes=$(wc -c < "$clean" | tr -d ' '); hash=$(sha256sum "$clean" | awk '{print $1}')
    jq -cn --arg path "$clean" --arg sha256 "$hash" --argjson bytes "$bytes" '{path:$path,sha256:$sha256,bytes:$bytes}'
  done | jq -s --arg compilerVersion "$compiler_version" --arg policyRef "$policy_ref" '{type:"policy.typedSemanticCompiler.manifest.v1", compilerVersion:$compilerVersion, policyRef:$policyRef, decision:"PASS_FOR_COMPILER_CANDIDATE", deletionReadiness:"BLOCK", files:.}' > manifest.json
)

jq -cn --arg decision PASS_FOR_COMPILER_CANDIDATE --arg deletionReadiness BLOCK --argjson compiledEdges "$edge_count" '{decision:$decision, deletionReadiness:$deletionReadiness, compiledEdges:$compiledEdges, outDir:"policy-typed-compiler-candidate-260621"}'
