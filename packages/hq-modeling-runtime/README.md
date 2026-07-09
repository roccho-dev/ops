# hq-modeling-runtime

`hq-modeling-runtime` is the ops-owned home for the queue-after-confirm side of the editor-to-queue-to-ui flow.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Validate editor-confirmed queue rows before later worker/runtime issues process them. |
| Repo split | Keep edits as queue writer, ops as runtime/admission/receipt/projection owner, and ui as projection reader. |
| Meta | Keep schema/validation in pure core and leave file/process effects in adapters. |
| Meta^10 | Keep a buyer-auditable operational package boundary for the model-runtime path. |

## Current capabilities

| Capability | Status | Boundary |
|---|---|---|
| package boundary metadata | present | pure core |
| `hq.modelCommitQueued.v1` schema | present | queue intent, not accepted authority |
| `hq.agentTaskQueued.v1` schema | present | agent request intent, not proposal authority |
| `hq.receipt.v1` schema | present | evidence only |
| JSONL queue validator | present | pure validation core |
| CLI validation adapter | present | file read + stdout only |

Still not implemented here:

| Issue | Adds |
|---|---|
| `ops#41` | local worker |
| `ops#42` | receipt writer |
| `ops#43` | repo-map projection builder handoff |
| `ops#44` | admission gate |

## Core / port / adapter split

| Area | Classification | Current status |
|---|---|---|
| package boundary metadata | pure core | present |
| queue schema contract | port | present in `lib/queue-schema.mjs` |
| queue validator | pure core | present in `lib/queue-validator.mjs` |
| CLI file read/stdout | adapter | present in `bin/hq-modeling-runtime.mjs` |
| worker runtime contract | port/core | reserved for `ops#41` |
| receipt writer | adapter/core split | reserved for `ops#42` |
| projection artifact contract | port | reserved for `ops#43` |

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections are generated read models. Accepted-ledger-shaped rows exist only after explicit ops admission, which is not implemented by this validator.

The validator rejects authority-confusing fields such as accepted/admitted/approved/ledger-authority fields in queue or receipt rows.

## Repo cleanliness

This package must not import or implement editor UX, Vim/hq surface behavior, browser renderer behavior, or UI state storage.
