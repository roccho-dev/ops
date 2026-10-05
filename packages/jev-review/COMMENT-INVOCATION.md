# Issue invocation SOURCE contract

This is the non-quality source slice for [ops#483](https://github.com/roccho-dev/ops/issues/483).
The catalog and semantic meaning remain in `semlint.mjs` / [ops#471](https://github.com/roccho-dev/ops/issues/471).
Usefulness and future quality are separate [ops#482](https://github.com/roccho-dev/ops/issues/482) work.
No quality-series merge or PASS is required here.

## Files and boundaries

- `github-comment.mjs`: deterministic Issue-specific admission, identity, next-effect decision,
  raw result composition and exact readback comparison. It has no transport, persistence,
  credential access, checkout, dispatch, process launch or GitHub mutation.
- `semlint-entry.mjs`: formally callable owner entry. Its runtime imports only existing
  `core.mjs`, `jev.mjs`, `semlint.mjs` and their production closure plus Node builtins.
  It does not import test fixtures or gold, and does not run default tests.
- `tests/github-comment.mjs`: secret-free fixtures and executable stdin/error checks.
  The existing Nix CI runs the separate `jev-comment-functional` check.
- `tests/run.mjs`: compatibility dispatch at the existing owner's fixed program path.
  No arguments retain the existing machine-test body and expectations. Exact single
  `--semlint-real` calls the shared `ownerMain` production handler; other arguments
  produce a closed refusal. Machine-only imports, fixtures and gold are isolated inside
  the no-argument function and are not loaded/executed by the real mode.

Actual event executor, serialized admission, target owner deployment, supply, permissions and
result append transport are **NOT_CONFIGURED / UNVERIFIED by this source slice**. Fixtures do
not prove live at-most-effect, parallel exclusion, paid-call accounting or Issue completion.
There is no new workflow, package, client, secret store, bridge, queue or ledger.

## Caller data and trusted grant

The caller obtains an authenticated event snapshot, preserving repository, issue, comment ID,
author, exact revision and full body. `admitIssueComment(event, config)` accepts exactly:

```js
event = { repository, issue, action: 'created', comment: { id, author, revision, body } };
config = { repository, issue, requesters, executionSource, limits };
```

The independently trusted config fixes the target Issue, exact allowed requester names,
adopted 40-hex execution source and finite limits. Config is never inferred from a result
comment or merged with comment data. `executionSource` is a recorded adopted source identity,
not a program selector. No ref in an Issue is checked out, imported or executed.

An explicit request body begins with the exact `/jev-evaluate` line followed by JSON:

```json
{"schema":"ops.jev.issue-request.v1","cases":[{"id":"request-1","input":{"schema":"ops.semlint.input.v1","subject":{},"context":[],"checks":[]}}]}
```

The abbreviated subject above is not valid input: supply the full canonical subject/context
records and their exact revisions, full contents and SHA256 values. `input.checks` contains
the requested existing catalog IDs. Unknown keys, unauthorized target/requester, edits,
result comments, malformed/oversized data and invalid later cases are rejected before
any real callback. Valid context shortages remain `INCOMPLETE`, not fabricated context.
Issue admission also rejects plans whose known record/identity projection plus conservative
closed scalar/accounting reserves exceeds the 32 KiB result cap, before any paid callback.
The CLI's structural plan cap is distinct; the Issue entry may admit fewer cases to preserve
single-comment delivery. The projection is size-only and never execution evidence.
Unselected records remain `NOT_SELECTED`. Six rule/question/raw-record bindings are preserved.

Identity binds the full comment body digest and revision, author, target, adopted source,
trusted config digest and exact plan digest. Edits require a distinct request identity;
old results cannot be relabeled as evaluations of a newer subject/input/config/source.

## Formal owner entry

The fixed target owner may execute `node semlint-entry.mjs` without arguments, supplying
stdin `{schema:'ops.semlint.real-input.v1',cases:[{id,input}]}`, optionally with the exact
five-key `limits` described below. No endpoint/model/program,
gold or authority flag is accepted in that input. All cases are snapshot-validated using
existing semlint/evaluate before provider work. Synthetic preflight answers and accounting
are discarded; they never enter execution evidence.

The existing `ops-jev --semlint-real` launcher fixes `tests/run.mjs --semlint-real`.
That exact compatibility path now delegates to the same exported stdin handler instead
of returning mock `PASS`. This source does not alter the launcher or prove its adoption:
current guarded target, accepted exact source/closure and actual supply must still be
independently read back under a separate live boundary. No caller data chooses code.

Structural upper bounds are 1 MiB encoded input, 24 unique neutral case IDs, 24 callback
invocations, 15 seconds per provider operation and 60 seconds for the whole plan.
Trusted limits may only reduce them. These bounds are not a live spending grant or a quality
budget. A live contract must separately fix the finite allowed calls/timeout/target/source
and authorize the actual owner entry.

Trusted smaller limits reach the fixed entry through the plan itself. `preparePlan(plan, ceiling)`
derives effective limits (an embedded `limits` may only reduce the ceiling; enlarging, partial,
extra-key or non-integer values fail closed as `INVALID_ENTRY_LIMITS`). Whenever the effective
limits differ from the structural ones, the canonical `prepared.plan` embeds all five values in
fixed key order; structural limits are represented by omission, so the two-key input stays valid
and unchanged. Issue admission passes `config.limits` as the ceiling, so `request.prepared.plan`
is the exact owner stdin and `planDigest` binds cases plus effective limits. A result produced
under any other limits (including only a different timeout) fails `composeResultComment` with
`RESULT_IDENTITY_MISMATCH`; no extra field or ledger is added. Enforcement points: stdin reading
keeps the 1 MiB structural cap; the child's `preparePlan` applies the effective
`maxInputBytes` to the canonical plan JSON, `maxCases`/`maxCalls` before any callback or key use,
and `runPlan`/`executeOwnerPlan` apply `timeoutMs`/`deadlineMs`/`maxCalls`. Issue body bytes are
a separate admission measure. Issue content still cannot carry `limits`. Local secret-free tests
run both fixed programs as children with only `globalThis.fetch` replaced by a counting fixture,
a synthetic key and no inherited environment. They are not evidence that the target launcher
passes stdin unchanged, of Linux CI, or of target adoption.

Only the target owner injects `JEV_API_KEY`. The existing launcher may place it in the
child environment before that child validates stdin; this is NOT a claim that the child
has no secret until admission. Caller admission precedes owner launch, and the shared
child handler revalidates the whole plan before reading the key or doing provider work.
Consumers never read, decrypt, copy or forward it. Existing `askJev` sends pinned `jev-1.13.0` native named
Noul questions, explicit criteria, fixed official endpoint, redirect refusal and finite timeout.
No automatic retry is made. Input errors output only a closed error enum, not raw child or
provider diagnostics. Execution failures retain canonical per-item statuses and null values.

Input remains `ops.semlint.real-input.v1`; output is `ops.semlint.real-result.v3`: the closed v2
shape plus one per-case `elapsedMs`, read from `runPlan`'s injected clock immediately before and after
the whole semlint call (finite, nonnegative instants required). `provider.elapsedMs` keeps its narrower
native-fetch meaning. The result receiver accepts exactly closed v2 or closed v3 and refuses unknown
versions or extra/missing keys; the producer emits v3 only. PR473's former `real-output.v1` handler is removed.
An invalid clock reading fails the whole plan after the case returns (`ENTRY_CLOCK_INVALID`, reported as
`ENTRY_FAILED`); any native requests already sent then have no receipt and remain UNKNOWN, never zero.
Catalog-v1 per-case semantic results and Issue request/result envelopes retain their identities.

`runPlan` counts actual invocations of the supplied owner callback. The canonical per-case
callback counter separately counts its invocation wrapper (which may reject on deadline
before the owner callback). Validated calls are distinct. Generic callback fixtures retain
`provider:null` per case and null native totals, never inferred HTTP counters.
`executeOwnerPlan` instead observes the existing `askJev` fetch boundary without a second
client: increment `attemptedHttpCalls` immediately before fetch; `completedHttpCalls` after
response receipt; `validatedResponses` only after pinned-model/answer validation. Successful
response bytes are consumed once under the original signal and exposed only as SHA256 digest.
The closed per-case receipt also has status class, validated model, allowlisted usage and
elapsed time. No raw body, authorization header, key or arbitrary error text is published.
Unknown response completion is `unknownHttpCalls=attempted-completed`, not a claim of free
or zero remote work; there are no retries. No-send/pre-send failures retain observed zero
HTTP attempts, while request throw/timeout retains attempted=1/completed=0/unknown=1.
Native totals are independently summed from receipts. Canonical per-case `providerHttpCalls`
and all `cost` remain null because that semantic layer cannot observe them and no cost
estimator is adopted. Neither fixtures nor this observer proves a real paid receipt before
authorized target execution. Raw output claims bounded evidence, not truth,
aggregate quality, a merge verdict or authority.

## Append/readback and replay

`nextIssueEffect` is only a pure decision over attributable prior executor state. With no
prior attempt it proposes evaluation. `EVALUATED` permits delivery of an existing result
without a paid recall; `APPENDED` permits readback only. Started/failed/unknown/unrecognized
state or an identity mismatch requires reconciliation, never blind retry.
It does not make two concurrent callers safe: the actual executor must serialize admission
and independently demonstrate the same bounded effects and UNKNOWN handling.

`composeResultComment` validates plan/case/question/input identity, six raw records and
closed finite accounting. Result bodies are capped at 32 KiB; no update/delete API exists.
The eventual append is a new comment, not a GitHub guarantee of intrinsic immutability.
The eventual transport must bind exact author/comment ID/target/body and then independently
read them back; `verifyResultReadback` performs the exact comparison. Observations
are compared to the separately supplied exact positive append receipt ID (fifth argument),
not just any positive ID with the same body and author. Mutable GitHub comments
can drift and a later mismatch must remain a mismatch. Result text is never a new authorizer.

## Evidence ceiling

Run `node packages/jev-review/tests/github-comment.mjs` for secret-free preliminary evidence.
SOURCE acceptance additionally requires actual `jev-comment-functional` Linux Nix CI at the
published exact head, existing `jev-review` Linux Nix machine parity and independent R acceptance.
The shared dispatch file overlaps [quality PR473](https://github.com/roccho-dev/ops/pull/473),
but this dedicated canonical-source branch changes only dispatch/import-body isolation,
not PR473's branch/head, semantics, quality implementation or expectations. Future quality
upstream alignment must reconcile this production delegation rather than silently replace
it with a duplicate live handler. Quality acceptance is not a gate for this functional slice.
Neither check replaces the real authorized
Issue request → existing owner execution → real provider → new result comment → independent
readback proof. ops#483 stays unfinished until that runtime/config/supply/normal-path evidence
exists, with proportionate non-trigger/failure controls and finite effect admission.
