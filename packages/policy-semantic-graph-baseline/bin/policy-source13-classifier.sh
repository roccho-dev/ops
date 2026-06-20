#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --source-unresolved JSONL --policy-root DIR --out-dir DIR" >&2; exit 2; }
source_unresolved=""; policy_root=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-unresolved) source_unresolved="${2:-}"; shift 2 ;;
    --policy-root) policy_root="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$source_unresolved" ] && [ -n "$policy_root" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
classification="$out_dir/policy_source13_classification.jsonl"
edges="$out_dir/policy_source13_typed_edges.jsonl"
: > "$classification"
: > "$edges"
classifier_version="source13-classifier-jq-v1"

jq -c . "$source_unresolved" | while IFS= read -r row; do
  path=$(printf '%s' "$row" | jq -r '.path')
  file="$policy_root/$path"
  sha="missing"
  [ -f "$file" ] && sha=$(sha256sum "$file" | awk '{print $1}')
  disposition="still-untyped-authority"
  class="unknown"
  reason="unclassified authority-bearing source"
  edge_kind=""
  edge_text=""
  case "$path" in
    issues/canonical-branch-guard-worktree-handoff/localizer-evidence/*.txt)
      disposition="non-authority-excluded"; class="localizer-evidence-head"; reason="raw commit head evidence, not policy semantic authority" ;;
    policy-tantivy-cython/docs/LATEST_POLICY_HEAD_COVERAGE.json)
      disposition="non-authority-excluded"; class="generated-coverage-receipt"; reason="generated coverage receipt, not policy semantic authority" ;;
    policy-tantivy-cython/requirements.txt)
      disposition="non-authority-excluded"; class="runtime-dependency-note"; reason="runtime dependency note, not policy semantic authority" ;;
    templates/build-receipt.v1.json)
      disposition="non-authority-excluded"; class="non-policy-template-example"; reason="build receipt example template, not policy semantic authority" ;;
    packages/app-browser-sim/README.md)
      disposition="typed-covered"; class="package-boundary"; reason="package README defines PoC serving responsibility"; edge_kind="package-role"; edge_text="Serve src/index.html with workspace import maps or a bundler." ;;
    packages/mmdflux-policy/examples/governance-envelope/README.md)
      disposition="typed-covered"; class="example-boundary"; reason="README states conformance example and proposal/governance-only boundary"; edge_kind="example-not-production"; edge_text="Governance envelope is a conformance/stress example; decisions remain proposal/governance-only unless separate review and promotion gate accepts them." ;;
    packages/mmdflux-policy/examples/monster-envelope/README.md)
      disposition="typed-covered"; class="example-boundary"; reason="README states not production/default and review-only protocol gap behavior"; edge_kind="example-not-production"; edge_text="Monster envelope is not production/default and exists for conformance/stress and review-only protocol_gap behavior." ;;
    packages/optimizer/README.md)
      disposition="typed-covered"; class="package-boundary"; reason="README states optimizer emits patch proposals and does not mutate production"; edge_kind="package-no-side-effect"; edge_text="Optimizer emits patch proposals and does not mutate production harnesses directly." ;;
    packages/policy-gateway/README.md)
      disposition="typed-covered"; class="package-boundary"; reason="README states accepted command is not authorized side effect"; edge_kind="side-effect-boundary"; edge_text="Accepted cmd is not the same as authorized side effect." ;;
    packages/runtime-browser/README.md)
      disposition="typed-covered"; class="package-boundary"; reason="README states package does not own UI and exposes adapters only"; edge_kind="package-no-goal"; edge_text="Runtime browser does not own UI; it exposes storage/runtime adapters and scenario/ledger interfaces." ;;
    packages/workflow-topology/README.md)
      disposition="typed-covered"; class="package-boundary"; reason="README states adapter is authorization-free and PEP handles AuthZEN request"; edge_kind="authorization-boundary"; edge_text="Workflow topology is authorization-free; PEP turns transition candidates into AuthZEN requests." ;;
  esac
  active=false
  [ "$disposition" = still-untyped-authority ] && active=true
  jq -cn --argjson baseline "$row" --arg path "$path" --arg sha256 "$sha" --arg classifierVersion "$classifier_version" --arg disposition "$disposition" --arg class "$class" --arg reason "$reason" --argjson counts "$active" '{type:"policy.source13.classification.v1", classifierVersion:$classifierVersion, sourcePath:$path, sourceSha256:$sha256, disposition:$disposition, source13Class:$class, countsTowardDeletionGate:$counts, reason:$reason, claimAllowed:false, evidence:{baselineRecord:$baseline}}' >> "$classification"
  if [ "$disposition" = typed-covered ]; then
    jq -cn --arg path "$path" --arg sha256 "$sha" --arg classifierVersion "$classifier_version" --arg edgeKind "$edge_kind" --arg text "$edge_text" '{type:"policy.source13.typedSemanticEdge.v1", classifierVersion:$classifierVersion, sourcePath:$path, sourceSha256:$sha256, edgeKind:$edgeKind, text:$text, extraction:"source13-manual-typed-coverage", claimAllowed:false}' >> "$edges"
  fi
done

still_untyped=$(jq -s '[.[] | select(.countsTowardDeletionGate == true)] | length' "$classification")
total=$(wc -l < "$classification" | tr -d ' ')
typed_edges=$(wc -l < "$edges" | tr -d ' ')
by_disposition=$(jq -s 'group_by(.disposition) | map({key:.[0].disposition, value:length}) | from_entries' "$classification")
by_class=$(jq -s 'group_by(.source13Class) | map({key:.[0].source13Class, value:length}) | from_entries' "$classification")

jq -n --arg classifierVersion "$classifier_version" --argjson total "$total" --argjson stillUntyped "$still_untyped" --argjson typedEdges "$typed_edges" --argjson byDisposition "$by_disposition" --argjson byClass "$by_class" '{type:"policy.source13.reviewSummary.v1", classifierVersion:$classifierVersion, decision:(if $stillUntyped == 0 then "PASS" else "BLOCK" end), deletionReadiness:"BLOCK", total:$total, stillUntypedAuthority:$stillUntyped, typedEdgeCount:$typedEdges, byDisposition:$byDisposition, byClass:$byClass, gates:[{name:"authority-bearing-untyped-sources-eliminated", status:(if $stillUntyped == 0 then "PASS" else "BLOCK" end), actual:$stillUntyped, expected:0},{name:"policy-retirement-still-blocked-by-compiler-and-equivalence", status:"BLOCK", actual:"typed compiler and semantic equivalence gates remain", expected:"accepted compiler and equivalence proof"}], mustNotClaim:["policy.git retirement","policy.git deletion","cutover approval","merge approval","completion approval","semantic approval","canonical write","SSOT write"]}' > "$out_dir/policy_source13_review_summary.json"

jq -cn --argjson total "$total" --argjson stillUntyped "$still_untyped" --argjson typedEdges "$typed_edges" '{decision:(if $stillUntyped == 0 then "PASS" else "BLOCK" end), total:$total, stillUntypedAuthority:$stillUntyped, typedEdgeCount:$typedEdges, outDir:"policy-source13-classification-260620"}'
