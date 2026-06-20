# Gen2 Handoff Bundle Spec 260620

Status: local environment artifact, not canonical policy, not approval.

## Purpose

Make gen1 able to hand work/review to gen2 without hidden context, direct Gen0->Gen2 instruction, or transport/proof false positives.

## Authority Boundary

- local = WSL `/home/nixos/work/...`.
- remote/ssot = SSH `100.124.250.91:/home/nixos/repos/*.git`.
- ssot is a push/fetch target, not a work surface.
- Project Source, uploaded zip, readback, and thread prose are transport/evidence only, not semantic approval.

## Required Policy Sources

- policy.git `AGENTS.md`
- `policy-router.v1.json`
- `kernel/actor-relations.md`
- `kernel/clone-context-packet.md`
- `kernel/authority-write-gate.md`
- `kernel/evidence-integrity.md`
- `kernel/protocol-fsm.md`
- `modules/protocol-handoff-package/POLICY.md`
- `modules/surface-chatgpt-first/POLICY.md` when ChatGPT Project Source is involved
- `role-profiles/impl-worker.json` or `role-profiles/impl-reviewer.json`
- schemas/templates named in `HANDOFF_MANIFEST.json`

## Fixed Policy Entry Refs

Policy compliance proof must cite immutable refs and rendered digests.

| package | fixed policyEntryRef | sha256(rendered policy) |
|---|---|---|
| policy-creation | `git+ssh://100.124.250.91/home/nixos/repos/policy.git?rev=334997669f1889a8e2658730c616d2d4510d4536&dir=packages/policy-creation#policy` | `cf38c99b0795b2c7674fd664d60fbc510c8cb98b77131dbfe0f81dc196be4473` |
| completion-reporting-criteria | `git+ssh://100.124.250.91/home/nixos/repos/policy.git?rev=334997669f1889a8e2658730c616d2d4510d4536&dir=packages/completion-reporting-criteria#policy` | `1b88a9c788473a64d9969a3056b8c7db3a39b730c36c2b20a4c720564d777617` |
| ssot-package-in-instance-use | `git+ssh://100.124.250.91/home/nixos/repos/policy.git?rev=334997669f1889a8e2658730c616d2d4510d4536&dir=packages/ssot-package-in-instance-use#policy` | `e634ef32591d1d1ae3a65e614b32ede8c6895e47c07a08a3ef45c0603fd12217` |

## Bundle Layout

```text
gen2-handoff-bundle/
  HANDOFF_MANIFEST.json
  REQUEST.md
  BACKGROUND.md
  POLICY_ENTRY_REFS.json
  SOURCE_INDEX.jsonl
  evidence/
    policy-read-snapshot.json
    commands.txt
    prior-pass-block.jsonl
  source/
    <target repo snapshot, diff, or patch>
  output-contract/
    EXPECTED_OUTPUT_CONTRACT.md
```

## Gen1 Duties

- Create the context packet and handoff package.
- Ensure gen2 reads the fixed policy entry and reports digest.
- Own gen2 spawn, monitoring, readback, and review.
- Pass only gen2 readback/review upward to gen0.
- Do not let gen0 directly command gen2 except as a recorded boundary exception.

## Gen2 First Reply Requirement

Gen2 must return:

- contextPacketId
- roleId and threadFunction
- fixed policyEntryRef(s) read
- rendered digest(s)
- source files read
- forbidden actions understood
- expected output artifacts
- missing source/blockers

No normal work starts before this readback.

## Additional Required Payloads After Gen1 Review

- `SNAPSHOT_MANIFEST.md`: sourceHead, archiveMethod, includesUncommittedChanges:false, requestEntrypoint.
- `purpose_lineage.json`: all known purpose generations and non-goals.
- `DOD.md`: completion criteria and evidence requirements.
- `context-packet.json`: generated from `templates/context-packet.template.json`.

## Effective Bundle Layout

```text
gen2-handoff-bundle/
  HANDOFF_MANIFEST.json
  REQUEST.md
  BACKGROUND.md
  INDEX.md
  SNAPSHOT_MANIFEST.md
  POLICY_ENTRY_REFS.json
  context-packet.json
  purpose_lineage.json
  DOD.md
  SOURCE_INDEX.jsonl
  evidence/
    policy-read-snapshot.json
    commands.txt
    prior-pass-block.jsonl
  source/
    <target repo snapshot, diff, or patch>
  output-contract/
    EXPECTED_OUTPUT_CONTRACT.md
```
