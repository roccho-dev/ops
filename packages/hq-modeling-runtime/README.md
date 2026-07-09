# hq-modeling-runtime

`hq-modeling-runtime` is the ops-owned home for the queue-after-confirm side of the editor-to-queue-to-ui flow.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Provide the package boundary where validated editor queue rows will be processed. |
| Repo split | Keep edits as queue writer, ops as runtime/admission/receipt/projection owner, and ui as projection reader. |
| Meta | Give later schema, worker, receipt, admission, and projection issues one package home without mixing adapters into core. |
| Meta^10 | Keep a buyer-auditable operational package boundary for the model-runtime path. |

## Current scaffold

This package is intentionally minimal.

It may expose package metadata and boundary claims. It must not yet implement queue validation, worker processing, admission, ledger writing, projection building, editor UX, or browser rendering.

Those behaviors are added only by later issues:

| Issue | Adds |
|---|---|
| `ops#40` | queue schema and validator |
| `ops#41` | local worker |
| `ops#42` | receipt writer |
| `ops#43` | repo-map projection builder handoff |
| `ops#44` | admission gate |

## Core / port / adapter split

| Area | Classification | Current status |
|---|---|---|
| package boundary metadata | pure core | present |
| queue schema contract | port | reserved for `ops#40` |
| worker runtime contract | port/core | reserved for `ops#41` |
| receipt contract | port | reserved for `ops#42` |
| projection artifact contract | port | reserved for `ops#43` |
| file/process/repo IO | adapter | not present in scaffold except CLI stdout |

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections are generated read models. Accepted-ledger-shaped rows exist only after explicit ops admission, which is not implemented by this scaffold.

## Repo cleanliness

This package must not import or implement editor UX, Vim/hq surface behavior, browser renderer behavior, or UI state storage.
