# hq-modeling-runtime

`hq-modeling-runtime` is the ops-owned home for the queue-after-confirm side of the editor-to-queue-to-ui flow.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Validate and locally process editor-confirmed queue rows before later receipt/projection/admission issues. |
| Repo split | Keep edits as queue writer, ops as runtime/admission/receipt/projection owner, and ui as projection reader. |
| Meta | Keep schema/validation/worker reduction in pure core and leave file/process effects in adapters. |
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
| CLI validation/work adapter | present | file read + stdout only |

Still not implemented here:

| Issue | Adds |
|---|---|
| `ops#42` | receipt writer |
| `ops#43` | repo-map projection builder handoff |
| `ops#44` | admission gate |

## Core / port / adapter split

| Area | Classification | Current status |
|---|---|---|
| package boundary metadata | pure core | present |
| queue schema contract | port | present in `lib/queue-schema.mjs` |
| queue validator | pure core | present in `lib/queue-validator.mjs` |
| local worker reducer | pure core | present in `lib/local-worker.mjs` |
| CLI file read/stdout | adapter | present in `bin/hq-modeling-runtime.mjs` |
| receipt writer | adapter/core split | reserved for `ops#42` |
| projection artifact contract | port | reserved for `ops#43` |

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections are generated read models. Accepted-ledger-shaped rows exist only after explicit ops admission, which is not implemented by this local worker.

The validator rejects authority-confusing fields such as accepted/admitted/approved/ledger-authority fields in queue or receipt rows. The local worker converts valid model commits into local shadow model operations and valid agent tasks into pending local task state only.

## Repo cleanliness

This package must not import or implement editor UX, Vim/hq surface behavior, browser renderer behavior, or UI state storage.
