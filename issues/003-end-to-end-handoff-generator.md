# Issue 003: end-to-end handoff generator

## Status

Weak / not first-class. Current rules describe what a handoff must contain, but there is no single ops package that generates a complete per-thread handoff pack from role catalog, organization topology, source/runtime input, and improvement request.

## ops responsibility

`repos/ops` should implement the generator because it combines operational inputs:

- Project Source upload/readback route
- artifact-first handoff shape
- command-board pointers
- role/thread bootstrap files
- source/runtime payload paths
- runbook and live-proof gates

`repos/specs` should keep the contract for allowed roles, required fields, and package expectations.

## Problem

Today the parent can know the desired shape, but each handoff is still assembled manually or from scattered tools.

That makes it easy to omit:

- actorId / roleId / threadFunction
- parentActor / childActor relationship
- Project Source entrypoint
- role-catalog reference
- organization-topology reference
- source/runtime manifest
- expected output artifact names
- readback checklist
- completion criteria
- forbidden actions
- merge target
- RUN_REPORT / residual risks requirement

## Existing references

- `.agents/role-catalog.md`
- `.agents/organization-topology.md`
- `.agents/command-board.md`
- `.agents/claim-stream.md`
- `.agents/project-workspace.md`
- `.agents/templates/chatgpt-thread-bootstrap.v1.md`
- `specs/packages/ops-project-source-sync/default.nix`
- `ops/packages/ops-cdp-core/docs/project-transport.md`

## Desired output

Generator input:

```text
role-catalog
organization-topology.a2ui.jsonl
command-board / improvement request
src-runtime pack
merge target
Project URL
thread roster or desired thread functions
```

Generated handoff:

```text
handoff/
  HANDOFF_MANIFEST.json
  REQUEST.md
  COMMON/
    role-catalog.ref.json
    organization-topology.a2ui.jsonl
    command-board.a2ui.jsonl
    source-manifest.json
    runtime-manifest.json
  THREADS/
    impl-work/BOOTSTRAP.md
    impl-review/BOOTSTRAP.md
    merge-work/BOOTSTRAP.md
    merge-review/BOOTSTRAP.md
```

Each thread bootstrap must say only what that thread needs:

- actorId
- roleId
- threadFunction
- parentActor
- scope
- input files
- runtime files
- allowed actions
- forbidden actions
- completion criteria proposal requirement
- expected artifacts
- short readback format

## Acceptance criteria

- One command can generate the full handoff directory.
- Generated files contain no duplicated role definition body; they reference `role-catalog`.
- Generated files include resolved role summaries for readability.
- Generated `THREADS/*/BOOTSTRAP.md` differs by threadFunction.
- `impl-work`, `impl-review`, `merge-work`, and `merge-review` have distinct expected outputs.
- Project Source upload can point to the generated handoff pack.
- Readback checklist is generated for every thread.
- The generator fails if role binding, topology, merge target, source manifest, or runtime manifest is missing.

## Non-goals

- No CDP implementation inside the generator.
- No semantic approval.
- No merge.
- No push.
