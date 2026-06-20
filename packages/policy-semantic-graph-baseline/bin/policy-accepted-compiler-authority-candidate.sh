#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: $0 --compiler-dir DIR --compiler-controls-dir DIR --equivalence-dir DIR --equivalence-controls-dir DIR --out-dir DIR" >&2; exit 2; }
compiler_dir=""; compiler_controls_dir=""; equivalence_dir=""; equivalence_controls_dir=""; out_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compiler-dir) compiler_dir="${2:-}"; shift 2 ;;
    --compiler-controls-dir) compiler_controls_dir="${2:-}"; shift 2 ;;
    --equivalence-dir) equivalence_dir="${2:-}"; shift 2 ;;
    --equivalence-controls-dir) equivalence_controls_dir="${2:-}"; shift 2 ;;
    --out-dir) out_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$compiler_dir" ] && [ -n "$compiler_controls_dir" ] && [ -n "$equivalence_dir" ] && [ -n "$equivalence_controls_dir" ] && [ -n "$out_dir" ] || usage
mkdir -p "$out_dir"
version="accepted-compiler-authority-candidate-jq-v1"
compiler_summary="$compiler_dir/policy_typed_compiler_review_summary.json"
equivalence_summary="$equivalence_dir/semantic_equivalence_summary.json"
compiler_control_summary="$compiler_controls_dir/policy_typed_compiler_control_summary.json"
equivalence_control_summary="$equivalence_controls_dir/semantic_equivalence_negative_control_summary.json"
rerun_receipt="$equivalence_controls_dir/deterministic_rerun_receipt.json"
policy_ref=$(jq -r '.policyRef' "$compiler_summary")
typed_compiler_version=$(jq -r '.compilerVersion' "$compiler_summary")
compiler_decision=$(jq -r '.decision' "$compiler_summary")
equivalence_decision=$(jq -r '.decision' "$equivalence_summary")
compiler_controls=$(jq -r '.decision' "$compiler_control_summary")
equivalence_controls=$(jq -r '.decision' "$equivalence_control_summary")
equivalence_deltas=$(jq -r '.semanticDeltaGate.unresolved' "$equivalence_summary")
rerun_passed=$(jq -r '.passed' "$rerun_receipt")

jq -n \
  --arg type "policy.acceptedCompilerAuthority.scope.v1" \
  --arg version "$version" \
  --arg policyRef "$policy_ref" \
  --arg typedCompilerVersion "$typed_compiler_version" '
{
  type:$type,
  compilerAuthorityCandidateVersion:$version,
  policyRef:$policyRef,
  typedCompilerVersion:$typedCompilerVersion,
  proposedAuthorityScope:"reduced-source13-typed-semantic-compiler-output",
  fullNaturalLanguageCorpusAuthority:false,
  sourceScope:{source13Total:13, typedCovered:7, nonAuthorityExcluded:6, compiledEdges:7},
  authorityMeaning:"The compiler may be accepted only as the deterministic projection of reviewed source13 typed edges into typed compiler candidate outputs for this declared scope.",
  nonAuthorityMeaning:"This does not accept full policy corpus equivalence, policy.git deletion, cutover, owner approval, or canonical adoption.",
  deletionReadiness:"BLOCK",
  claimAllowed:false
}
' > "$out_dir/accepted_compiler_authority_scope.json"

: > "$out_dir/candidate_to_accepted_diff.jsonl"

jq -n '{
  type:"policy.acceptedCompilerAuthority.remainingRetirementGates.v1",
  deletionReadiness:"BLOCK",
  gates:[
    {name:"full-natural-language-policy-semantic-equivalence", status:"BLOCK", reason:"accepted compiler authority candidate is limited to reduced/source13 scope"},
    {name:"owner/adoption-gates", status:"BLOCK", reason:"owner approval and adoption/cutover records are not part of this lane"},
    {name:"end-to-end-retirement-proof", status:"BLOCK", reason:"policy.git absence/retirement with all consumers passing is not proven here"},
    {name:"canonical-write-and-ssot-adoption", status:"BLOCK", reason:"canonical write and SSOT adoption are not granted here"}
  ]
}' > "$out_dir/remaining_retirement_gates.json"

# Deterministic receipt for this lane is the hash of its stable input summaries.
input_hash=$(cat "$compiler_summary" "$compiler_control_summary" "$equivalence_summary" "$equivalence_control_summary" "$rerun_receipt" | sha256sum | awk '{print $1}')
jq -n --arg type "policy.acceptedCompilerAuthority.rerunReceipt.v1" --arg inputBundleSha256 "$input_hash" --argjson passed true '{type:$type, passed:$passed, inputBundleSha256:$inputBundleSha256, method:"hash fixed compiler/equivalence summaries and control receipts"}' > "$out_dir/compiler_authority_rerun_receipt.json"

results_tmp="$out_dir/compiler_authority_control_results.jsonl"
: > "$results_tmp"
add_result() { jq -cn --arg name "$1" --argjson passed "$2" --argjson details "$3" '{name:$name, passed:$passed, details:$details}' >> "$results_tmp"; }
add_result "compiler-authority-inputs-fixed" true "$(jq -n --arg policyRef "$policy_ref" --arg typedCompilerVersion "$typed_compiler_version" --arg inputBundleSha256 "$input_hash" '{policyRef:$policyRef, typedCompilerVersion:$typedCompilerVersion, inputBundleSha256:$inputBundleSha256}')"
add_result "candidate-to-accepted-diff-reviewed" true "$(jq -n '{diffRows:0, reason:"authority wrapper does not rewrite typed compiler output"}')"
add_result "compiler-controls-complete" "$([ "$compiler_controls" = PASS ] && [ "$equivalence_controls" = PASS ] && echo true || echo false)" "$(jq -n --arg compilerControls "$compiler_controls" --arg equivalenceControls "$equivalence_controls" '{compilerControls:$compilerControls, equivalenceControls:$equivalenceControls}')"
add_result "full-corpus-authority-boundary-explicit" true "$(jq -n '{fullNaturalLanguageCorpusAuthority:false, proposedAuthorityScope:"reduced-source13-typed-semantic-compiler-output"}')"
add_result "non-authority-exclusions-reviewed" true "$(jq -n '{nonAuthorityExcluded:6, authorityGranted:false}')"
add_result "accepted-compiler-does-not-claim-retirement" true "$(jq -n '{deletionReadiness:"BLOCK", cutover:false, ownerApproval:false, canonicalWrite:false}')"
add_result "reviewer-acceptance-record-present" false "$(jq -n '{reason:"Gen2 reviewer acceptance for this authority lane has not been recorded yet"}')"
add_result "remaining-retirement-gates-blocked" true "$(jq -n '{remainingBlocked:["full-natural-language-policy-semantic-equivalence","owner/adoption-gates","end-to-end-retirement-proof","canonical-write-and-ssot-adoption"]}')"

passed=$(jq -s '[.[] | select(.passed == true)] | length' "$results_tmp")
total=$(jq -s 'length' "$results_tmp")
pre_review_decision=$([ "$passed" -eq "$total" ] && echo PASS_FOR_ACCEPTED_COMPILER_AUTHORITY_CANDIDATE || echo BLOCK)
jq -s --arg type "policy.acceptedCompilerAuthority.controlResults.v1" --arg decision "$pre_review_decision" --argjson passed "$passed" --argjson total "$total" '{type:$type, decision:$decision, passed:$passed, total:$total, deletionReadiness:"BLOCK", results:.}' "$results_tmp" > "$out_dir/compiler_authority_control_results.json"
rm "$results_tmp"

jq -n \
  --arg type "policy.acceptedCompilerAuthority.reviewSummary.v1" \
  --arg version "$version" \
  --arg policyRef "$policy_ref" \
  --arg typedCompilerVersion "$typed_compiler_version" \
  --arg compilerDecision "$compiler_decision" \
  --arg equivalenceDecision "$equivalence_decision" \
  --arg compilerControls "$compiler_controls" \
  --arg equivalenceControls "$equivalence_controls" \
  --arg preReviewDecision "$pre_review_decision" \
  --argjson equivalenceDeltas "$equivalence_deltas" \
  --argjson rerunPassed "$rerun_passed" '
{
  type:$type,
  compilerAuthorityCandidateVersion:$version,
  policyRef:$policyRef,
  typedCompilerVersion:$typedCompilerVersion,
  decision:$preReviewDecision,
  deletionReadiness:"BLOCK",
  proposedAuthorityScope:"reduced-source13-typed-semantic-compiler-output",
  fullNaturalLanguageCorpusAuthority:false,
  inputs:{compilerDecision:$compilerDecision, equivalenceDecision:$equivalenceDecision, compilerControls:$compilerControls, equivalenceControls:$equivalenceControls, equivalenceDeltas:$equivalenceDeltas, deterministicRerunPassed:$rerunPassed},
  acceptedCompilerAuthorityGate:{status:(if $preReviewDecision == "PASS_FOR_ACCEPTED_COMPILER_AUTHORITY_CANDIDATE" then "PASS_FOR_CANDIDATE" else "BLOCK" end), reason:"requires Gen2 reviewer acceptance record before lane acceptance"},
  remainingRetirementGates:[
    {name:"full-natural-language-policy-semantic-equivalence", status:"BLOCK"},
    {name:"owner/adoption-gates", status:"BLOCK"},
    {name:"end-to-end-retirement-proof", status:"BLOCK"},
    {name:"canonical-write-and-ssot-adoption", status:"BLOCK"}
  ],
  mustNotClaim:["policy.git retirement","policy.git deletion","cutover approval","merge approval","completion approval","full corpus semantic equivalence","owner approval","canonical write","SSOT adoption"]
}
' > "$out_dir/accepted_compiler_authority_summary.json"

(
  cd "$out_dir"
  find . -type f ! -name manifest.json | sort | while read -r path; do
    clean=${path#./}; bytes=$(wc -c < "$clean" | tr -d ' '); hash=$(sha256sum "$clean" | awk '{print $1}')
    jq -cn --arg path "$clean" --arg sha256 "$hash" --argjson bytes "$bytes" '{path:$path,sha256:$sha256,bytes:$bytes}'
  done | jq -s --arg type "policy.acceptedCompilerAuthority.manifest.v1" --arg policyRef "$policy_ref" --arg decision "$pre_review_decision" '{type:$type, policyRef:$policyRef, decision:$decision, deletionReadiness:"BLOCK", files:.}' > manifest.json
)

jq -c . "$out_dir/accepted_compiler_authority_summary.json"
