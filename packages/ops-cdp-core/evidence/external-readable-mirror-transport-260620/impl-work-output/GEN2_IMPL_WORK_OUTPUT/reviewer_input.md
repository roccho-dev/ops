# reviewer_input.md

## Review Target

Review the following impl-work output:

- IMPL_WORK_REPORT.md
- GEN2_IMPL_WORK_OUTPUT/README.md
- GEN2_IMPL_WORK_OUTPUT/MANIFEST.json
- GEN2_IMPL_WORK_OUTPUT/handoff_shape_evidence.json
- GEN2_IMPL_WORK_OUTPUT/authority_boundary.json
- GEN2_IMPL_WORK_OUTPUT/evidence_index.jsonl
- GEN2_IMPL_WORK_OUTPUT/RUN_REPORT.md
- GEN2_IMPL_WORK_OUTPUT/residual_risks.md
- GEN2_IMPL_WORK_OUTPUT/reviewer_input.md

## Source To Compare Against

Fixed mirror:

- repo: roccho-dev/public
- commit: 7d79c3fdfaf49ffb91877d7c521ffb710bf90276
- path: gen2-chatgpt-handoff-transport-260620

## Reviewer Checks

| check | expected observation |
|---|---|
| actor split | impl-work actorId and impl-review actorId differ |
| role id | both actors use roleId role.chatgpt.thread |
| thread functions | impl-work and impl-review are canonical threadFunction values |
| review input | impl-review has requiresInput GEN2_IMPL_WORK_OUTPUT/ |
| separation of duty | sameActorMayDoImplWorkAndImplReview is false |
| non-promotion | all approval/write/cutover/deletion authority flags are false |
| evidence ceiling | output remains degraded external-mirror transport evidence only |
| self-review | impl-work did not review its own output |

## Expected Reviewer Output

The reviewer should return its own readback/verdict artifact and should not treat this impl-work output as approval, completion, merge, cutover, deletion, canonical write, SSOT write, or Project Source proof.
