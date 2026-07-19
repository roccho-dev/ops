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
| `hq.modelCommitQueued.v1` schema | present | queue intent with explicit producer origin, not accepted authority |
| `hq.agentTaskQueued.v1` schema | present | agent request intent, not proposal authority |
| `hq.receipt.v1` schema | present | evidence only |
| complete JSON-data snapshot | present | descriptor-only snapshot of the entire proposal or queue row before semantic field reads |
| `modeling.proposal.v1` validation and digest | present | complete acyclic JSON data; non-authority evidence |
| explicit human proposal promotion | present | pure core emits validated proposal-origin queue intent with linked evidence and an evidence-only receipt |
| proposal-promotion downstream validation port | present | requires proposal origin and an expected promotion origin from the caller's trusted boundary |
| proposal promotion CLI | present | reads proposal and confirmation JSON; stdout/stderr only; no queue or ledger writes |
| JSONL queue validator | present | pure validation core for explicit direct-human and proposal-promotion rows |
| whole-object authority smuggling rejection | present | rejects a bounded authority-state vocabulary at semantic field, `kind`, and `status` word boundaries across proposals and queue rows |
| source/reconcile payload smuggling rejection | present | recursively rejects source and reconcile rows inside model payloads |
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
| JSON-data descriptor snapshot | pure core | `snapshotJsonData` in `lib/queue-schema.mjs`; rejects Proxies, accessors, descriptor failures, cycles, sparse arrays, non-plain objects, non-finite values, symbols, functions, and non-enumerable data |
| queue schema contract | port | present in `lib/queue-schema.mjs`; every model row has explicit `origin` |
| generic queue validator | pure core | `validateRecord` validates complete explicit direct-human or proposal-promotion records without inferring either from absence |
| proposal-promotion validator | pure core port | `validateProposalPromotionRecord` requires `proposal-promotion.v1` plus an expected origin and verifies proposal, evidence, confirmation, promotion, and row-integrity linkage |
| modeling proposal validation and digest | pure core | present in `lib/modeling-proposal.mjs`; snapshots once and validates only the snapshot |
| explicit human proposal promotion | pure core | present in `lib/promotion-gate.mjs`; one proposal descriptor snapshot, one confirmation descriptor snapshot, digest match, provenance linkage, specialized queue validation, no effects |
| proposal and confirmation file input | adapter | `promote` subcommand in `bin/hq-modeling-runtime.mjs` |
| queue intent and promotion receipt output | adapter | stdout only on success; no queue file, accepted ledger, admission, network, or agent effect |
| model/source payload split | pure core | `source.*` and `model_source_reconcile.v1` rows are rejected recursively when embedded in model payloads |
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

## Complete JSON-data and authority boundary

Public proposal and queue validators do not read `kind`, `status`, or any other semantic field from the caller's object first. They first take a descriptor-only deep snapshot and reject any object that cannot be represented as complete JSON data. Validation, authority scanning, digest checks, and promotion output use that snapshot only. A self-erasing getter, mutation-on-read accessor, Proxy, nested `Date`, cycle, sparse array, non-finite number, descriptor failure, or non-enumerable property therefore fails closed.

Authority vocabulary is matched by semantic words, not unrestricted substrings. Field names and `kind`/`status` values are split at camel-case transitions and punctuation, then compared with the bounded reserved words `accepted`, `admitted`, `admission`, `admit`, `approved`, `approval`, `approve`, `authority`, `authorization`, `authorisation`, `authorized`, `authorised`, and `authoritative`. This rejects `modelAuthoritativeClaim`, `isAuthorized`, `isAuthorised`, `hq.authorizedRow.v1`, and `hq.authorisedRow.v1`, while `admittanceOhms` remains ordinary engineering data rather than an `admit` claim.

Allowances are narrow and exact. `nonAuthority` is allowed only with value `true`. `authoritativeSourceName` is allowed only as that exact field name with a non-empty string value because it records a source label, not authority state. Other names containing an `authoritative` semantic word, such as `modelAuthoritativeSourceName`, remain rejected. Benign `author` and `acceptanceCriteria` fields remain outside the reserved authority-state vocabulary.

## Model queue origin contract

Every `hq.modelCommitQueued.v1` row must carry an explicit `origin`. Absence is invalid and is never interpreted as direct-human input.

| `origin.kind` | Required linkage and trust boundary |
|---|---|
| `direct-human.v1` | own `confirmationId` and `confirmedBy`; `confirmedBy` must match the row. The generic validator checks structure only. The producer boundary is responsible for trusting the human confirmation identity. |
| `proposal-promotion.v1` | proposal ID, canonical proposal digest, confirmation digest, preserved-evidence digest, promotion-evidence ID, matching confirmer, and complete-row integrity digest. Proposal-gated downstream consumers must call `validateProposalPromotionRecord` with the expected origin retained from their trusted promotion boundary. |

A completely stripped proposal row may be rewritten as a structurally valid explicit direct-human row and pass the generic validator because direct-human and proposal-promotion are separate producer contracts. It must fail `validateProposalPromotionRecord`, which requires proposal origin rather than guessing from the row ID, reason, or absent fields.

The SHA-256 values in this package are unkeyed canonical hashes. They provide deterministic self-consistency and accidental-tamper detection. They are not signatures, do not prove cryptographic human identity, and cannot authenticate a fully rewritten row when the attacker also replaces every hash. Exact continuity across a downstream boundary is enforced only when that caller supplies the separately retained expected proposal-promotion origin. No secret, identity service, or external ledger is introduced here.

This limitation does not weaken Issue #48: the promotion gate itself always creates `proposal-promotion.v1` output and validates it through the dedicated proposal-promotion port before returning it. Consumers that require the Issue #48 human proposal gate must use that same port rather than the generic direct-human-compatible validator.

## Proposal promotion CLI

```text
hq-modeling-runtime promote \
  --input <proposal.json> \
  --confirmation <confirmation.json> \
  [--queue-jsonl|--receipt-jsonl|--json]
```

`--input` and `--confirmation` each contain one JSON value. The confirmation must expose `confirm`, `confirmedBy`, and `proposalDigest` as own, enumerable data properties with primitive values; `confirm` must be `true`, `confirmedBy` must be non-empty, and `proposalDigest` must exactly match the validated proposal snapshot. Accessors, inherited values, Proxies, and descriptor failures reject without re-reading the input. The default output is a one-line status. `--json` returns the full structured result. `--queue-jsonl` emits exactly one `hq.modelCommitQueued.v1` row only after successful promotion. `--receipt-jsonl` emits exactly one evidence-only promotion receipt only after successful promotion.

Exit status is `0` for successful promotion, `1` for read/JSON/validation/confirmation rejection, and `2` for CLI misuse. Raw tokens equal to `--queue-jsonl` / `--receipt-jsonl` or beginning with `--queue-jsonl=` / `--receipt-jsonl=` establish JSONL output intent even when argument parsing later rejects them. On every rejection carrying either intent, stdout is empty and diagnostics go to stderr, including inline boolean forms, conflicts, missing inputs, unknown arguments, and invalid content. The command does not append a queue file, write an accepted ledger, perform admission, use network access, run agents, or mutate either input.

## Authority boundary

Queue rows are intent. Receipts are evidence. Projections are generated read models. The admission gate emits accepted-ledger-shaped local/dev rows only and explicitly does not implement production governance adoption.

A reviewed `modeling.proposal.v1` remains non-authority until the pure promotion gate receives explicit human confirmation whose proposal digest matches the validated proposal snapshot. Successful promotion preserves proposal evidence and emits a structurally self-consistent proposal-origin queue row plus an evidence-only receipt. The CLI only reads the two JSON inputs and exposes outputs through stdout or diagnostics through stderr; it does not persist, admit, accept, network, or execute anything.

Only `hq.modelCommitQueued.v1` rows can be admitted. `hq.agentTaskQueued.v1` and `hq.receipt.v1` rows are rejected by admission. Agent task rows can become pending local task state and pending receipts only; they can later lead to proposals, never direct accepted ledger writes.

The model queue is model-intent only. Direct `source.observation.v1`, `source.receipt.v1`, and `model_source_reconcile.v1` rows are not queue kinds. Those rows are also rejected when wrapped inside `hq.modelCommitQueued.v1.payload`. Source observations belong in `hq-source-evidence-runtime`; model/source findings belong in `model-source-reconcile`.

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
