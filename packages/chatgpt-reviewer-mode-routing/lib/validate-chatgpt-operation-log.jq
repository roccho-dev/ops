def law_alias_ok($mode; $raw): any($law[]; .type == "chatgpt.mode_alias.v1" and .canonicalMode == $mode and ((.aliases // []) | index($raw)) != null);
def law_requires($class): ($law[] | select(.type == "chatgpt.operation_requirement.v1" and .operationClass == $class) | .requiredCanonicalMode) // null;
def approval_boundary_ok: any($law[]; .type == "chatgpt.approval_boundary.v1" and .chatgptReviewerIsAuthority == false and .githubRefsMirrorIsTransportOnly == true and ((.canonicalSsotRepos // []) | index("ops.git")) != null and ((.canonicalSsotRepos // []) | index("adrs.git")) != null and ([.approvalGranted.owner,.approvalGranted.deletion,.approvalGranted.retirement,.approvalGranted.cutover,.approvalGranted.canonicalWrite,.approvalGranted.ssotAdoption] | all(. == false)));
def classifications: [$ops[] | select(.type == "chatgpt.operation_classification.v1")];
def recs($id; $type): [$ops[] | select(.operationId? == $id and .type == $type)];
def firstrec($id; $type): (recs($id; $type)[0] // {});
def op_failures($op):
  ($op.operationId) as $id | ($op.class) as $class | (law_requires($class)) as $requiredMode |
  (firstrec($id; "chatgpt.ui_mode_readback.v1")) as $mode |
  (firstrec($id; "chatgpt.prompt_send.v1")) as $send |
  (firstrec($id; "chatgpt.prompt_reflection.v1")) as $reflection |
  (firstrec($id; "chatgpt.output_capture.v1")) as $output |
  (firstrec($id; "chatgpt.ssot_evidence_persist.v1")) as $persist |
  [
    if ($op.mixedOperation != false) then "mixed-operation-not-false:" + ($id // "unknown") else empty end,
    if ($class != "github_operation" and $class != "non_github_review_operation") then "unknown-operation-class:" + ($id // "unknown") else empty end,
    if ($requiredMode == null) then "missing-law-requirement:" + ($class // "unknown") else empty end,
    if (($mode.type // null) != "chatgpt.ui_mode_readback.v1") then "missing-ui-mode-readback:" + $id else empty end,
    if (($mode.canonicalMode // null) != $requiredMode) then "mode-does-not-match-required:" + $id else empty end,
    if (($mode.rawLabel // null) == null or (law_alias_ok($mode.canonicalMode; $mode.rawLabel) | not)) then "raw-label-not-normalizable:" + $id else empty end,
    if (($send.type // null) != "chatgpt.prompt_send.v1") then "missing-prompt-send:" + $id else empty end,
    if (($send.requiredCanonicalMode // null) != $requiredMode) then "prompt-required-mode-mismatch:" + $id else empty end,
    if (($send.actualCanonicalMode // null) != $requiredMode) then "prompt-actual-mode-mismatch:" + $id else empty end,
    if (($reflection.type // null) != "chatgpt.prompt_reflection.v1" or ($reflection.reflected // null) != true) then "missing-prompt-reflection:" + $id else empty end,
    if ($class == "github_operation" and ((recs($id; "chatgpt.github_source_read.v1") | length) == 0)) then "missing-github-source-read:" + $id else empty end,
    if ($class == "non_github_review_operation" and ((recs($id; "chatgpt.github_source_read.v1") | length) > 0)) then "non-github-operation-has-github-source-read:" + $id else empty end,
    if (($output.type // null) != "chatgpt.output_capture.v1") then "missing-output-capture:" + $id else empty end,
    if ($output.authority != false) then "output-authority-not-false:" + $id else empty end,
    if (($persist.type // null) != "chatgpt.ssot_evidence_persist.v1") then "missing-ssot-evidence-persist:" + $id else empty end,
    if ((($persist.ssot // "") == "ops") or (($persist.ssot // "") == "adrs") or (($persist.ssot // "") == "ops/adrs")) then empty else "persist-ssot-not-ops-adrs:" + $id end
  ];
def global_failures: [
  if (law_alias_ok("extra_high"; "extra high") and law_alias_ok("extra_high"; "最高")) then empty else "law-missing-extra-high-aliases" end,
  if (law_alias_ok("pro_extended"; "pro extended") and law_alias_ok("pro_extended"; "pro拡張")) then empty else "law-missing-pro-extended-aliases" end,
  if approval_boundary_ok then empty else "law-approval-boundary-invalid" end,
  if ((classifications | length) > 0) then empty else "no-operation-classification-record" end,
  if (any($ops[]; (.ssot? == "refs") or (.canonicalSsot? == "refs") or (.githubRefsMirrorIsSsot? == true))) then "github-refs-treated-as-ssot" else empty end,
  if (any($ops[]; (.approvalGranted? == true) or (.ownerApprovalGranted? == true) or (.deletionApprovalGranted? == true) or (.retirementApprovalGranted? == true) or (.cutoverGranted? == true) or (.canonicalWriteGranted? == true) or (.ssotAdoptionGranted? == true))) then "chatgpt-record-grants-approval" else empty end
];
(global_failures + ([classifications[] | op_failures(.)] | add // [])) as $failures |
{type:"ops.chatgptReviewerModeRouting.validationReport.v1", status:(if ($failures|length)==0 then "PASS" else "FAIL" end), operationIds:(classifications|map(.operationId)), operationCount:(classifications|length), failures:$failures, approvalGranted:false}
