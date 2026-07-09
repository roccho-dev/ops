# Editor-to-queue-to-ui ops boundary

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Prove the ops side of `editor -> queue -> ui` without moving editor or renderer ownership into ops. |
| Repo split | Keep `edits` as editor/queue-writer, `ops` as queue runtime/admission/receipt/projection builder, and `ui` as targetRef/projection reader/preview. |
| Meta | Keep core / port / adapter and pure / effect boundaries visible before later runtime issues add behavior. |
| Meta^10 | Preserve a sale-ready package boundary that a buyer can audit without reading unrelated editor or browser code. |

## Ownership statement

`ops = queue runtime + admission + receipt + projection builder`.

`ops` owns the execution and evidence side after a human-confirmed queue row exists. It does not own editor UX, browser rendering, UI state, or model selection UI.

## Package responsibility map

| Future package | Responsibility | Boundary |
|---|---|---|
| `hq-modeling-runtime` | queue schema, validator, worker runtime | reads queue intent and produces runtime results |
| `hq-admission-gate` | local/dev admission from model queue into accepted-ledger-shaped rows | admits only validated model queue rows |
| `repo-map-projection-builder` | projection artifacts for ui read-model consumption | produces generated evidence, not authority |
| `cue-append-contract-core` | append-only contract check boundary | validates append/rewrite behavior outside editor/ui |

## Core / port / adapter split

| Area | Classification | Rule |
|---|---|---|
| queue row classification | pure core | no file, process, GitHub, editor, or browser side effect |
| queue validation decision | pure core | accepts/rejects by schema and authority-boundary fields |
| worker decision | pure core | converts validated intent into local shadow state or pending task state |
| receipt shaping and digest comparison | pure core | evidence rows are deterministic from inputs |
| queue, receipt, ledger, projection, contractcheck surfaces | port | data contracts that adapters may read/write |
| file reads/writes, process calls, repo fixture reads, CUE invocation | adapter | all effects live at the edge |

## Pure / effect rule

Pure code decides whether a row, receipt, projection, or boundary claim is valid. Adapter code reads files, writes reports, invokes contract checks, or loads cross-repo fixtures. A later PR may add adapters, but it must not hide admission, file writes, or process execution inside the pure core.

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections and previews are generated read models. None of these is accepted authority by itself.

Only an explicit ops admission gate may produce accepted-ledger-shaped local/dev rows, and that local/dev output remains separate from future production governance adoption.

## False-positive and false-negative gates

| Gate | Must pass | Must fail |
|---|---|---|
| queue boundary | valid `hq.modelCommitQueued.v1` and `hq.agentTaskQueued.v1` intent rows | rows that claim accepted/admission/ledger authority |
| receipt boundary | evidence-only receipts with matching digests | stale, mutated, missing, or authority-bearing receipts |
| projection boundary | generated repo-map projection artifacts for ui input | projection artifacts that claim source-model or ledger authority |
| repo cleanliness | docs that place runtime in ops and editor/renderer in edits/ui | must fail if docs or code place editor UX, browser renderer, or UI state in ops |

## Repo cleanliness rule

`ops` must not import or implement editor UX, Vim/hq surface behavior, browser renderer behavior, or UI state storage. It may reference `edits` queue rows and `ui` projection/preview artifacts only through fixtures, ports, digests, and receipts.

This issue closes only the boundary declaration and guard. Later issues add the runtime packages, validators, workers, admission gate, projection builder, and cross-repo receipts under this boundary.
