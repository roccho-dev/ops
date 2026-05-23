# ops-handoff-core

`ops-handoff-core` generates local handoff directories for role-separated
Project Source workflows.

It combines:

- role catalog reference
- organization topology reference
- command/request reference
- source manifest
- runtime manifest
- merge target
- thread roster
- payload manifest or stub payload interface

It does not upload to Project Source, create threads, fetch artifacts, approve
work, merge, or push.

## Command

```text
ops-handoff-core generate \
  --role-catalog ROLE_CATALOG.md \
  --topology organization-topology.a2ui.jsonl \
  --command-board command-board.a2ui.jsonl \
  --request REQUEST.md \
  --source-manifest source-manifest.json \
  --runtime-manifest runtime-manifest.json \
  --merge-target merge-target.json \
  --thread-roster thread-roster.json \
  --out-dir handoff
```

Then verify:

```text
ops-handoff-core validate --handoff-dir handoff
```

Returned worker artifacts can be imported as evidence:

```text
ops-handoff-core import-result \
  --thread-function merge-review \
  --artifact result.zip \
  --run-report RUN_REPORT.md \
  --verdict-file MERGE_REVIEW_VERDICT.txt \
  --claim-path claim.jsonl
```

## Issue traceability

- `ops/issues/001-thread-fsm-handoff-created-not-terminal.md`
- `ops/issues/002-project-transport-live-proof-hardening.md`
- `ops/issues/003-end-to-end-handoff-generator.md`
- `ops/issues/004-src-pack-offline-nix-cache-payload.md`

## Boundary

The generated handoff is not terminal success. It is input for the next actor.
Worker-readable readback and completion criteria approval are required before
implementation, review, merge-work, or merge-review starts.
