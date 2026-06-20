#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --compiler-dir DIR --source13-dir DIR --out-dir DIR" >&2; exit 2; }
compiler_dir=""; source13_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compiler-dir) compiler_dir="${2:-}"; shift 2 ;;
    --source13-dir) source13_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$compiler_dir" ] && [ -n "$source13_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
compiler_version="semantic-equivalence-candidate-jq-v1"
compiler_summary="$compiler_dir/policy_typed_compiler_review_summary.json"
compiler_edges="$compiler_dir/policy_typed_compiler_edges.jsonl"
source13_class="$source13_dir/policy_source13_classification.jsonl"
source13_edges="$source13_dir/policy_source13_typed_edges.jsonl"
policy_ref=$(jq -r '.policyRef' "$compiler_summary")
typed_compiler_version=$(jq -r '.compilerVersion' "$compiler_summary")

jq -nc \
  --arg type "policy.semanticEquivalence.inputs.v1" \
  --arg compilerVersion "$compiler_version" \
  --arg policyRef "$policy_ref" \
  --arg typedCompilerVersion "$typed_compiler_version" \
  --slurpfile compilerSummary "$compiler_summary" \
  --slurpfile source13Summary "$source13_dir/policy_source13_review_summary.json" \
  '{type:$type, compilerVersion:$compilerVersion, policyRef:$policyRef, typedCompilerVersion:$typedCompilerVersion, inputs:{typedCompilerDecision:$compilerSummary[0].decision, source13Decision:$source13Summary[0].decision}, deletionReadiness:"BLOCK", claimAllowed:false}' > "$out_dir/semantic_equivalence_inputs.json"

jq -s -c --arg compilerVersion "$compiler_version" --slurpfile edges "$compiler_edges" '
  def edgeFor($p; $h): ($edges[] | select(.sourcePath == $p and .sourceSha256 == $h));
  .[] as $src |
  (edgeFor($src.sourcePath; $src.sourceSha256) // null) as $edge |
  {
    type:"policy.semanticEquivalence.sourceMap.v1",
    compilerVersion:$compilerVersion,
    sourcePath:$src.sourcePath,
    sourceSha256:$src.sourceSha256,
    disposition:$src.disposition,
    source13Class:$src.source13Class,
    countsTowardDeletionGate:$src.countsTowardDeletionGate,
    sourceReason:$src.reason,
    compiledEdge: (if $edge == null then null else {edgeKind:$edge.edgeKind, text:$edge.text, sourceSha256:$edge.sourceSha256, authorityStatus:$edge.authorityStatus, claimAllowed:$edge.claimAllowed} end),
    equivalenceStatus:(if $src.disposition == "typed-covered" and $edge != null and $edge.claimAllowed == false and $edge.authorityStatus == "candidate-compiled-edge" then "covered-by-candidate-edge" elif $src.disposition == "non-authority-excluded" and $edge == null then "excluded-non-authority" else "delta" end),
    trace:{source13Classifier:$src.classifierVersion, typedCompiler:(if $edge == null then null else $edge.compilerVersion end), sourcePath:$src.sourcePath, sourceSha256:$src.sourceSha256},
    claimAllowed:false
  }
' "$source13_class" > "$out_dir/semantic_equivalence_source_map.jsonl"

jq -s -c --slurpfile sourceEdges "$source13_edges" --slurpfile compilerEdges "$compiler_edges" '
  def sourceEdgeFor($p; $h): ($sourceEdges[] | select(.sourcePath == $p and .sourceSha256 == $h));
  def compilerEdgeFor($p; $h): ($compilerEdges[] | select(.sourcePath == $p and .sourceSha256 == $h));
  [ .[] | select(.equivalenceStatus == "delta") |
    {
      type:"policy.semanticEquivalence.delta.v1",
      deltaKind:(if .disposition == "typed-covered" and .compiledEdge == null then "missing-compiled-edge" elif .disposition == "non-authority-excluded" and .compiledEdge != null then "excluded-source-has-compiled-edge" else "invalid-source-map" end),
      sourcePath:.sourcePath,
      sourceSha256:.sourceSha256,
      disposition:.disposition,
      source13Class:.source13Class,
      severity:"BLOCK",
      claimAllowed:false
    }
  ] as $mapDeltas |
  [ $sourceEdges[] as $se |
    (compilerEdgeFor($se.sourcePath; $se.sourceSha256) // null) as $ce |
    select($ce == null or $ce.edgeKind != $se.edgeKind or $ce.text != $se.text) |
    {
      type:"policy.semanticEquivalence.delta.v1",
      deltaKind:(if $ce == null then "source13-edge-not-compiled" elif $ce.edgeKind != $se.edgeKind then "edge-kind-changed" else "edge-text-changed" end),
      sourcePath:$se.sourcePath,
      sourceSha256:$se.sourceSha256,
      sourceEdge:{edgeKind:$se.edgeKind, text:$se.text},
      compiledEdge:(if $ce == null then null else {edgeKind:$ce.edgeKind, text:$ce.text} end),
      severity:"BLOCK",
      claimAllowed:false
    }
  ] as $edgeDeltas |
  [ $compilerEdges[] as $ce |
    (sourceEdgeFor($ce.sourcePath; $ce.sourceSha256) // null) as $se |
    select($se == null) |
    {
      type:"policy.semanticEquivalence.delta.v1",
      deltaKind:"compiled-edge-without-source13-edge",
      sourcePath:$ce.sourcePath,
      sourceSha256:$ce.sourceSha256,
      severity:"BLOCK",
      claimAllowed:false
    }
  ] as $extraDeltas |
  ($mapDeltas + $edgeDeltas + $extraDeltas)[]
' "$out_dir/semantic_equivalence_source_map.jsonl" > "$out_dir/semantic_equivalence_deltas.jsonl"

delta_count=$(wc -l < "$out_dir/semantic_equivalence_deltas.jsonl" | tr -d ' ')
source_total=$(wc -l < "$source13_class" | tr -d ' ')
typed_sources=$(jq -s '[.[] | select(.disposition == "typed-covered")] | length' "$source13_class")
excluded_sources=$(jq -s '[.[] | select(.disposition == "non-authority-excluded")] | length' "$source13_class")
compiled_edges=$(wc -l < "$compiler_edges" | tr -d ' ')
source_edges=$(wc -l < "$source13_edges" | tr -d ' ')
decision=$([ "$delta_count" -eq 0 ] && echo PASS_FOR_EQUIVALENCE_CANDIDATE || echo BLOCK)

jq -n \
  --arg compilerVersion "$compiler_version" \
  --arg policyRef "$policy_ref" \
  --arg typedCompilerVersion "$typed_compiler_version" \
  --arg decision "$decision" \
  --argjson sourceTotal "$source_total" \
  --argjson typedSources "$typed_sources" \
  --argjson excludedSources "$excluded_sources" \
  --argjson sourceEdges "$source_edges" \
  --argjson compiledEdges "$compiled_edges" \
  --argjson unresolvedSemanticDeltas "$delta_count" '
{
  type:"policy.semanticEquivalence.reviewSummary.v1",
  compilerVersion:$compilerVersion,
  policyRef:$policyRef,
  typedCompilerVersion:$typedCompilerVersion,
  decision:$decision,
  deletionReadiness:"BLOCK",
  scope:"candidate equivalence between source13 authority dispositions and typed semantic compiler candidate outputs; not full retirement approval",
  sourceGate:{status:(if $unresolvedSemanticDeltas == 0 then "PASS" else "BLOCK" end), total:$sourceTotal, typedCovered:$typedSources, nonAuthorityExcluded:$excludedSources},
  edgeGate:{status:(if $unresolvedSemanticDeltas == 0 and $sourceEdges == $compiledEdges then "PASS" else "BLOCK" end), source13Edges:$sourceEdges, compiledEdges:$compiledEdges},
  semanticDeltaGate:{status:(if $unresolvedSemanticDeltas == 0 then "PASS" else "BLOCK" end), unresolved:$unresolvedSemanticDeltas, expected:0},
  candidateEquivalenceGate:{status:(if $unresolvedSemanticDeltas == 0 then "PASS_FOR_CANDIDATE" else "BLOCK" end), expected:"source13 typed edges are preserved exactly by compiler candidate"},
  remainingRetirementGates:[
    {name:"accepted-typed-semantic-compiler-authority", status:"BLOCK", actual:"candidate proof only", expected:"accepted compiler authority"},
    {name:"owner/adoption-gates", status:"BLOCK", actual:"not granted", expected:"owner approval and adoption/cutover records"},
    {name:"end-to-end-retirement-proof", status:"BLOCK", actual:"not proven", expected:"policy.git absent or retired with all consumers passing"},
    {name:"canonical-write-and-ssot-adoption", status:"BLOCK", actual:"not granted", expected:"canonical adoption record"}
  ],
  mustNotClaim:["policy.git retirement","policy.git deletion","cutover approval","merge approval","completion approval","accepted compiler authority","canonical write","SSOT adoption"]
}
' > "$out_dir/semantic_equivalence_summary.json"

(
  cd "$out_dir"
  find . -type f ! -name manifest.json | sort | while read -r path; do
    clean=${path#./}; bytes=$(wc -c < "$clean" | tr -d ' '); hash=$(sha256sum "$clean" | awk '{print $1}')
    jq -cn --arg path "$clean" --arg sha256 "$hash" --argjson bytes "$bytes" '{path:$path,sha256:$sha256,bytes:$bytes}'
  done | jq -s --arg compilerVersion "$compiler_version" --arg policyRef "$policy_ref" --arg decision "$decision" '{type:"policy.semanticEquivalence.manifest.v1", compilerVersion:$compilerVersion, policyRef:$policyRef, decision:$decision, deletionReadiness:"BLOCK", files:.}' > manifest.json
)

jq -cn --arg decision "$decision" --arg deletionReadiness BLOCK --argjson unresolvedSemanticDeltas "$delta_count" '{decision:$decision, deletionReadiness:$deletionReadiness, unresolvedSemanticDeltas:$unresolvedSemanticDeltas}'
