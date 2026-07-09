# HQ local / CI / GitHub readback / canonical promotion boundary

This document closes the boundary gap for ops#63 through ops#67.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Fill the missing HQ local serve, runtime root, persistence, CI, GitHub sync, and remote bare repo promotion boundaries. |
| Upper | Keep editor -> queue -> ops runtime -> ui preview working local-to-local without making any local surface authority. |
| Higher | Separate local, GitHub, ChatGPT, CI, and remote bare repo responsibilities so discussion, execution, checks, and canonical state do not mix. |
| Meta | Complement existing ops#38-51 runtime work without duplicating those issue scopes. |
| Meta^2 | Keep local WIP persistence separate from canonical persistence so HQ local root never becomes a second SSOT. |
| Meta^3 | Keep core / port / adapter and pure / side-effect boundaries explicit. |
| Meta^4 | Use CI shift-left and readback receipts to stop stale queue, projection, receipt, and promotion artifacts early. |
| Meta^5 | Treat GitHub issue comments as discussion, append, and readback surfaces only. |
| Meta^6 | Treat the remote bare repo as canonical only after promotion eligibility and readback. |
| Meta^7 | Leave an auditable work ledger for humans, ChatGPT, local HQ, CI, and remote SSOT. |
| Meta^8 | Make later inconsistency and responsibility growth detectable. |
| Meta^9 | Keep the local-first control plane explainable and transferable by a small team. |
| Meta^10 | Preserve a sale-ready boundary between discussion, execution, validation, and canonical persistence. |

## HQ local root catalog

All paths below are recoverable local WIP, proof, cache, or preview. None are canonical authority.

```text
$HQ_LOCAL_ROOT/
  queues/
    hq.model-commit.queue.jsonl
    hq.agent-task.queue.jsonl
  state/
    shadow-model.v1.jsonl
    agent-task-state.v1.jsonl
  proposals/
    modeling.proposal.v1.jsonl
  ledgers/
    staged.accepted.model-commit.v1.jsonl
  projections/
    repoMap.projection.v1.json
    repoMap.projection.v1.jsonl
  receipts/
    hq.receipt.v1.jsonl
    admission.receipt.v1.jsonl
    cross-repo.editor-to-ui.receipt.v1.jsonl
  previews/
    repo-map/
      index.html
      manifest.json
  cache/
    github-readback/
    ssot-mirror/
```

`$HQ_LOCAL_ROOT` output must stay outside source inventory except fixture and documentation files. Generated runtime paths such as `.local/hq/` and `.hq/local/` are repo pollution when committed as source.

## `hq serve local`

`hq serve local` is a local-only scaffold. It may use loopback TCP or a unix socket. It must reject non-local bind hosts such as `0.0.0.0` and LAN addresses.

The local status shape reports queue counts, receipt counts, projection digest, preview digest, stale state, and local endpoint status. It is evidence only.

## `hq run ci`

`hq run ci` is ephemeral. It may produce queue validation receipts, projection proofs, preview digest proofs, and cross-repo receipts. It must not write accepted state or remote bare repo refs.

CI artifacts and green checks are evidence only.

## GitHub issue/comment readback

GitHub issue/comment sync is an adapter. JSONL fenced blocks may be extracted and normalized into evidence records. Readback evidence must include source repo, issue, comment id, URL, author, observed digest, record count, and parse result.

Malformed JSONL, changed digest, missing expected records, or authority-bearing records fail the evidence receipt. They do not become accepted state.

## Staged accepted versus canonical promotion

`staged.accepted.*` is local admission output. It is not canonical. Remote bare repo promotion eligibility requires all of the following:

- staged accepted rows;
- local admission receipt;
- CUE append contract receipt;
- remote write candidate manifest;
- remote readback receipt with `target = remote-bare-repo` and `status = matched`.

Queue rows, projections, previews, local receipts alone, stale readback, or readback mismatch must not promote.

## Issue closure mapping

| Issue | Closing proof in this package |
|---|---|
| ops#63 | `local-root.mjs` catalog plus this document fixes the local root and non-authority persistence boundary. |
| ops#64 | `buildServeLocalPlan`, `validateLocalEndpoint`, and `buildLocalStatus` fix the local-only serve scaffold and status boundary. |
| ops#65 | `ci-mode.mjs` fixes ephemeral CI artifact receipt and negative digest/authority gates. |
| ops#66 | `github-readback.mjs` fixes JSONL fenced block extraction, readback digest, parse failure, and authority-claim rejection. |
| ops#67 | `canonical-promotion.mjs` fixes staged accepted versus remote bare canonical promotion eligibility. |
