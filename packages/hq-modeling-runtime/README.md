# hq-modeling-runtime

`hq-modeling-runtime` is the ops-owned home for the queue-after-confirm side of the editor-to-queue-to-ui flow.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Validate, human-promote, locally process, receipt, project, local-dev admit, connect admitted rows to CUE evidence, define local root/CI/GitHub readback/canonical promotion boundaries, and keep agent tasks and proposals non-authority. |
| Repo split | Keep edits as queue writer, ops as proposal/promotion/runtime/admission/receipt/projection/CUE/local-root/CI/readback/promotion-boundary owner, and ui as projection reader. |
| Meta | Keep schema/validation/promotion/worker/receipt/projection/admission/CUE/local root/CI/readback/promotion classification in pure core and leave file/process/network effects in adapters. |
| Meta^10 | Keep a buyer-auditable operational package boundary for the model-runtime path. |

## Current capabilities

| Capability | Status | Boundary |
|---|---|---|
| package boundary metadata | present | pure core |
| `hq.modelCommitQueued.v1` schema | present | queue intent, not accepted authority |
| `hq.agentTaskQueued.v1` schema | present | agent request intent, not proposal authority |
| `hq.receipt.v1` schema | present | evidence only |
| `modeling.proposal.v1` validation and digest | present | acyclic JSON-compatible proposal data; non-authority evidence |
| explicit human proposal promotion | present | pure core emits validated queue intent with proposal evidence and an evidence-only receipt |
| proposal promotion CLI | present | reads proposal and confirmation JSON; stdout/stderr only; no queue or ledger writes |
| JSONL queue validator | present | pure validation core |
| source/reconcile payload smuggling rejection | present | recursively rejects source, reconcile, admission, and accepted-ledger-shaped rows inside model payloads |
| local worker reducer | present | pure local shadow-state core |
| agent task runtime boundary | present | pending task state + pending receipt only |
| receipt writer | present | evidence-only receipt core |
| repo-map projection builder | present | generated read-model core |
| local-dev admission gate | present | accepted-ledger-shaped local/dev output only |
| CUE append contract adapter | present | maps admitted rows to CUE contract ledger events; invokes CUE core only through adapter/test |
| local root catalog | present | recoverable WIP/proof layout only; not SSOT |
| `hq serve local` scaffold | present | local-only endpoint plan and status; no remote server authority |
| `hq run ci` contract | present | ephemeral CI artifact receipts; evidence only |
| GitHub issue/comment readback | present | JSONL extraction/readback evidence only; no accepted state |
| staged-to-canonical promotion eligibility | present | pure eligibility gate; no remote write implementation |
| CLI validation/work/receipt/projection/admission/promotion adapter | present | file read + stdout/stderr only |

## Core / port / adapter split

| Area | Classification | Current status |
|---|---|---|
| package boundary metadata | pure core | present |
| queue schema contract | port | present in `lib/queue-schema.mjs` |
| queue validator | pure core | present in `lib/queue-validator.mjs` |
| modeling proposal validation and digest | pure core | present in `lib/modeling-proposal.mjs`; recursively rejects non-JSON data, cycles, sparse arrays, non-plain objects, and authority fields |
| explicit human proposal promotion | pure core | present in `lib/promotion-gate.mjs`; one snapshot, clone revalidation, digest match, queue validation, no effects |
| proposal and confirmation file input | adapter | `promote` subcommand in `bin/hq-modeling-runtime.mjs` |
| queue intent and promotion receipt output | adapter | stdout only; no queue file, accepted ledger, admission, network, or agent effect |
| model/source payload split | pure core | `source.*`, `model_source_reconcile.v1`, `admission.*`, and `accepted.*` rows are rejected recursively when embedded in model payloads |
| local worker reducer | pure core | present in `lib/local-worker.mjs` |
| agent task runtime classification | pure core | present in `lib/local-worker.mjs` and fixed by `tests/agent-task-runtime.mjs` |
| digest calculation | pure core | present in `lib/digest.mjs` |
| receipt writer | pure core | present in `lib/receipt-writer.mjs` |
| projection builder | pure core | present in `lib/projection-builder.mjs` |
| local-dev admission gate | pure core | present in `lib/admission-gate.mjs` |
| CUE append contract adapter | pure mapping core | present in `lib/cue-append-contract-adapter.mjs` |
| local root catalog / status / endpoint classification | pure core | present in `lib/local-root.mjs` |
| CI artifact receipt contract | pure core | present in `lib/ci-mode.mjs` |
| GitHub JSONL readback extraction | pure core behind adapter boundary | present in `lib/github-readback.mjs` |
| staged-to-canonical promotion eligibility | pure core | present in `lib/canonical-promotion.mjs` |
| `contractcheck` invocation | adapter | present in test/check surface only |
| other CLI file read/stdout | adapter | present in `bin/hq-modeling-runtime.mjs` |

## Proposal promotion CLI

```text
hq-modeling-runtime promote \
  --input <proposal.json> \
  --confirmation <confirmation.json> \
  [--queue-jsonl|--receipt-jsonl|--json]
```

`--input` and `--confirmation` each contain one JSON value. The confirmation must set `confirm: true`, a non-empty `confirmedBy`, and the exact proposal digest. The default output is a one-line status. `--json` returns the full structured result. `--queue-jsonl` emits exactly one `hq.modelCommitQueued.v1` row only after successful promotion. `--receipt-jsonl` emits exactly one evidence-only promotion receipt only after successful promotion.

Exit status is `0` for successful promotion, `1` for read/JSON/validation/confirmation rejection, and `2` for CLI misuse. Rejected JSONL output modes write no queue intent to stdout. The command does not append a queue file, write an accepted ledger, perform admission, use network access, run agents, or mutate either input.

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections are generated read models. The admission gate emits accepted-ledger-shaped rows for local/dev only and explicitly does not implement production governance adoption.

A reviewed `modeling.proposal.v1` remains non-authority until the pure promotion gate receives explicit human confirmation whose digest matches the validated proposal snapshot. Successful promotion preserves the proposal evidence in queue intent and also produces an evidence-only receipt. The CLI only reads the two JSON inputs and exposes those values through stdout; it does not persist, admit, accept, network, or execute anything.

Only `hq.modelCommitQueued.v1` rows can be admitted. `hq.agentTaskQueued.v1` and `hq.receipt.v1` rows are rejected by admission. Agent task rows can become pending local task state and pending receipts only; they can later lead to proposals, never direct accepted ledger writes.

The model queue is model-intent only. Direct `source.observation.v1`, `source.receipt.v1`, and `model_source_reconcile.v1` rows are not queue kinds. The same rows are also rejected when wrapped inside `hq.modelCommitQueued.v1.payload`. Source observations belong in `hq-source-evidence-runtime`; model/source findings belong in `model-source-reconcile`.

The CUE append adapter proves that admitted rows can be represented as append-only contract evidence. It does not move CUE core into hq runtime, and it does not make queue/projection/preview authority.

`$HQ_LOCAL_ROOT` is recoverable local WIP/proof storage only. It is not SSOT. Local status, previews, projections, receipts, GitHub readback caches, and staged accepted rows stay non-canonical until an explicit remote bare repo promotion path succeeds.

`hq run ci` is ephemeral evidence only. CI green status and artifacts never create accepted state.

GitHub issue/comment readback is discussion and JSONL evidence only. It can feed proposal evidence and receipts, but it cannot write accepted state.

Canonical promotion requires staged accepted rows, local admission receipt, CUE append contract receipt, remote write candidate manifest, and successful remote bare repo readback. Queue rows, projections, previews, local receipts alone, stale readback, or digest mismatch are not promotable.

## Repo cleanliness

This package must not import or implement editor UX, Vim/hq surface behavior, browser renderer behavior, UI state storage, remote bare repo write implementation, GitHub issue authority, ChatGPT direct local control, or the CUE contract core implementation.

Generated HQ runtime paths such as `.local/hq/` and `.hq/local/` must not be committed as source except fixture or documentation material.

## Boundary document

See `docs/hq-local-ci-readback-promotion-boundary.md` for the issue closure mapping for ops#63 through ops#67.
