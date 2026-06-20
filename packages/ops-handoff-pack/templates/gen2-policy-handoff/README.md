# Gen2 Policy Handoff Template

This directory contains a policy-compliant template for Gen1 -> Gen2 handoff.
It is an ops helper/template, not policy truth and not approval.

Use when a Gen1 facilitator must hand work or review to a Gen2 actor while preserving:

- fixed policyEntryRef + rendered digest;
- context-packet.v1 role binding and source refs;
- handoff.package.v1 manifest shape;
- purpose lineage and DOD payloads;
- Project Source revision/readback constraints;
- no semantic/completion/canonical approval by transport.

Policy source remains `policy.git`. These files are operational templates for
building a handoff packet from that policy.

## Files

| file | role |
|---|---|
| `GEN2_HANDOFF_BUNDLE_SPEC.md` | bundle structure and authority boundary |
| `templates/HANDOFF_MANIFEST.template.json` | handoff package manifest template |
| `templates/context-packet.template.json` | generic gen1 -> gen2 context packet template |
| `templates/context-packet.impl-work.template.json` | ChatGPT impl-work thread context packet template |
| `templates/context-packet.impl-review.template.json` | ChatGPT impl-review thread context packet template |
| `PROJECT_SOURCE_UPLOAD_PLAN.md` | Project Source revision/readback rules |
| `EXPECTED_OUTPUT_CONTRACT.md` | generic worker/reviewer return contract |
| `output-contract/EXPECTED_OUTPUT_CONTRACT.impl-work.md` | ChatGPT impl-work return contract |
| `output-contract/EXPECTED_OUTPUT_CONTRACT.impl-review.md` | ChatGPT impl-review return contract |
| `SNAPSHOT_MANIFEST.template.md` | source snapshot manifest template |
| `purpose_lineage.template.json` | purpose lineage template |
| `DOD.template.md` | definition of done template |

## Boundary

A generated handoff is not terminal success. Gen2 must first read back the fixed
policy entry ref, rendered digest, context packet id, required source files,
forbidden actions, and expected output artifacts. Gen1 owns Gen2 monitoring and
review; Gen0 does not bypass Gen1 to command Gen2.

## Generated packet schema floor

Concrete handoff packets must instantiate the schema shapes in
`templates/HANDOFF_MANIFEST.template.json` and
`templates/context-packet.template.json`. Do not collapse them into simplified
`gen2.*` manifest or context formats. A generated packet must preserve at least
these top-level forms:

- `HANDOFF_MANIFEST.json` uses `kind: "handoff.package.v1"` with `packageId`,
  `packageType`, `producer`, `target`, `container`, `entrypoints`,
  `sourceIdentities`, `payloads`, `expectedReadback`, `expectedOutputs`, and
  `authorityFlags`.
- `context-packet.json` uses `context-packet.v1` fields including
  `contextPacketId`, `parentActor`, `childActor`, `relationship`, `roleBinding`,
  `commandRef`, `goalState`, `currentState`, `scope`, `sourceRefs`,
  `allowedActions`, `forbiddenActions`, `completionContract`,
  `escalationPolicy`, `runtimeCapabilities`, `transportPolicy`, `exitCriteria`,
  and `redactions`.
- `SNAPSHOT_MANIFEST.md` records `sourceHead`, `archiveMethod`,
  `includesUncommittedChanges:false`, and `requestEntrypoint` in addition to
  file digests.

## Digest boundary

Do not put a required `sha256` for `HANDOFF_MANIFEST.json` or
`SNAPSHOT_MANIFEST.md` inside `HANDOFF_MANIFEST.json`. That creates a
self/cross-reference that cannot be made byte-stable by ordinary materializers.
The generated manifest should instead point `container.externalDigestRef` and
`entrypoints.snapshot` to `SNAPSHOT_MANIFEST.md`. The final snapshot/sidecar
inventory is generated after the last manifest write and records the final bytes
of `HANDOFF_MANIFEST.json`, `SNAPSHOT_MANIFEST.md`, and every payload file.

Generated packet payload hashes inside `HANDOFF_MANIFEST.json` must be limited to
non-self payloads and must match final `sha256sum` output. Local proof packets
use `container.kind: "loose-files"`; archive transports use `"zip"` or
`"tar.gz"`.

## ChatGPT Gen2 work/review topology

ChatGPT Gen2 handoff uses separate Project thread actors. Do not bind a single
ChatGPT actor to both work and review for the same scope.

| actor shape | roleId | threadFunction | boundary |
|---|---|---|---|
| `actor.gen2.chatgpt.impl-work.<packetId>` | `role.chatgpt.thread` | `impl-work` | produces work artifact/RUN_REPORT; cannot review or approve its own work |
| `actor.gen2.chatgpt.impl-review.<packetId>` | `role.chatgpt.thread` | `impl-review` | reviews impl-work artifact and returns PASS/BLOCK; cannot edit implementation |

ChatGPT thread actors must use `role.chatgpt.thread`. The canonical
`threadFunction` values are `impl-work`, `impl-review`, `merge-work`, and
`merge-review`. Do not use `role.implWorker` or `role.implReviewer` as the
ChatGPT thread actor role. Same `actorId` must not appear in both work and
review for the same scope.

The `impl-review` packet must include the `impl-work` artifact/readback as input.
A review packet that only includes the original request is not sufficient for an
`impl-review-pass` claim.

## Multi-thread manifest boundary

`HANDOFF_MANIFEST.json.target` remains the schema-floor single targetRef. Do not
replace `target` with a roster object. ChatGPT multi-thread topology is expressed
in `threadBindings[]`, where each bound child has a distinct `actorId`,
`roleId: "role.chatgpt.thread"`, and canonical `threadFunction`.

A roster target may identify the ChatGPT Project thread set, but it must not use
a non-canonical `threadFunction`. Canonical `threadFunction` values live on
`threadBindings[]` entries only.
