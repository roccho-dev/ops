# hq-modeling-runtime

`hq-modeling-runtime` is the ops-owned home for the queue-after-confirm side of the editor-to-queue-to-ui flow.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Validate, locally process, receipt, project, and local-dev admit editor-confirmed model queue rows. |
| Repo split | Keep edits as queue writer, ops as runtime/admission/receipt/projection owner, and ui as projection reader. |
| Meta | Keep schema/validation/worker/receipt/projection/admission shaping in pure core and leave file/process effects in adapters. |
| Meta^10 | Keep a buyer-auditable operational package boundary for the model-runtime path. |

## Current capabilities

| Capability | Status | Boundary |
|---|---|---|
| package boundary metadata | present | pure core |
| `hq.modelCommitQueued.v1` schema | present | queue intent, not accepted authority |
| `hq.agentTaskQueued.v1` schema | present | agent request intent, not proposal authority |
| `hq.receipt.v1` schema | present | evidence only |
| JSONL queue validator | present | pure validation core |
| local worker reducer | present | pure local shadow-state core |
| receipt writer | present | evidence-only receipt core |
| repo-map projection builder | present | generated read-model core |
| local-dev admission gate | present | accepted-ledger-shaped local/dev output only |
| CLI validation/work/receipt/projection/admission adapter | present | file read + stdout only |

## Core / port / adapter split

| Area | Classification | Current status |
|---|---|---|
| package boundary metadata | pure core | present |
| queue schema contract | port | present in `lib/queue-schema.mjs` |
| queue validator | pure core | present in `lib/queue-validator.mjs` |
| local worker reducer | pure core | present in `lib/local-worker.mjs` |
| digest calculation | pure core | present in `lib/digest.mjs` |
| receipt writer | pure core | present in `lib/receipt-writer.mjs` |
| projection builder | pure core | present in `lib/projection-builder.mjs` |
| local-dev admission gate | pure core | present in `lib/admission-gate.mjs` |
| CLI file read/stdout | adapter | present in `bin/hq-modeling-runtime.mjs` |

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections are generated read models. The admission gate emits accepted-ledger-shaped rows for local/dev only and explicitly does not implement production governance adoption.

Only `hq.modelCommitQueued.v1` rows can be admitted. `hq.agentTaskQueued.v1` and `hq.receipt.v1` rows are rejected by admission. The validator rejects authority-confusing fields such as accepted/admitted/approved/ledger-authority fields in queue or receipt rows.

## Repo cleanliness

This package must not import or implement editor UX, Vim/hq surface behavior, browser renderer behavior, or UI state storage.
