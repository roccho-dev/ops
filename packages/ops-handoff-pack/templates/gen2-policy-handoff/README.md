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
| `templates/context-packet.template.json` | gen1 -> gen2 context packet template |
| `PROJECT_SOURCE_UPLOAD_PLAN.md` | Project Source revision/readback rules |
| `EXPECTED_OUTPUT_CONTRACT.md` | worker/reviewer return contract |
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
