# Issue invocation SOURCE contract

This is the non-quality source slice for [ops#483](https://github.com/roccho-dev/ops/issues/483).
The catalog and semantic meaning remain in `semlint.mjs` / [ops#471](https://github.com/roccho-dev/ops/issues/471).
Usefulness and future quality are separate [ops#482](https://github.com/roccho-dev/ops/issues/482) work.
No quality-series merge or PASS is required here.

The merged provided-criteria/v14 Core is reused unchanged. Its exact result edition,
projection binding and per-case outer clock remain part of admission/composition;
the Actions transport does not substitute an older evaluator or bypass the audited
English-auxiliary owner boundary.

## Files and boundaries

- `github-comment.mjs`: deterministic Issue-specific admission, identity, next-effect decision,
  raw result composition and exact readback comparison. It has no transport, persistence,
  credential access, checkout, dispatch, process launch or GitHub mutation.
- `semlint-entry.mjs`: formally callable owner entry. Its runtime imports only existing
  `core.mjs`, `jev.mjs`, `semlint.mjs` and their production closure plus Node builtins.
  It does not import test fixtures or gold, and does not run default tests.
- `jev.mjs`: raw Noul/model/question adapter over the existing
  `packages/jev/src/core.mjs` provider transport. `executeOwnerPlan` binds the credential
  once per owner invocation; the adapter preserves redirect refusal and full-response
  deadlines. The Issue owner always uses the canonical endpoint; the legacy CLI's
  separately trusted `JEV_API_URL` setting remains compatible and cannot be chosen by Issue input.
- `build/packages.jsonl`: declares the existing Jev source sibling. The generated package
  copies only `jev-review` and `jev` into its immutable source closure; the existing
  `jev-review` Nix check also runs the installed binary from a clean cwd/process without a
  key or Node overrides. Source tests do not substitute for that installed-artifact check.
- `tests/github-comment.mjs`: secret-free fixtures and executable stdin/error checks.
  The existing Nix CI runs the separate `jev-comment-functional` check.
- `tests/run.mjs`: compatibility dispatch at the existing owner's fixed program path.
  No arguments retain the existing machine-test body and expectations. Exact single
  `--semlint-real` calls the shared `ownerMain` production handler; other arguments
  produce a closed refusal. Machine-only imports, fixtures and gold are isolated inside
  the no-argument function and are not loaded/executed by the real mode.

- `.github/workflows/jev-issue-comment.yml`: GitHub-hosted Actions entry for one owner literal
  command on one approved Issue; see "Actions issue command" below.
- `issue-actions.json`: reviewed trusted settings (`allowedChecks`, `context`, `subjectScope`,
  `limits`, `runRanges`).
- `issue-executor.mjs`: the Actions adapter (`plan` / `post`, no Jev key). No daemon, dispatch,
  schedule, queue, retry loop or ledger.
- `tests/issue-executor.mjs`: secret-free fixtures through the same adapter code with an in-memory
  GitHub and the real entry functions (`jev-issue-executor` check).
  The producer also requires `--source-contract <exact checkout>` to validate the actual workflow,
  intent and secret boundary before export. The fresh consumer runs the same functional cases
  without a checkout; its `sourceContract: NOT_REQUESTED` is not a repository-policy PASS.
  Runtime provenance v2 additionally binds the supplied shared-provider sibling and verifies
  both source trees and the complete native closure before executing the provided tests.

The Environment/secret binding, actual Actions runs, live provider behavior and real 201/200
semantics are **NOT_CONFIGURED / UNVERIFIED by this source**. Fixtures do not prove live
at-most-effect, paid-call accounting or Issue completion.

## Actions issue command

The workflow job runs only when the guard matches exactly: Issue `483`, author
`github.repository_owner`, body exactly `/jev-evaluate`, not a pull request. Target, requester and
command live only in that guard (no second copy in settings). Wider Issues, requesters or comment
formats are not covered; they would be a separately reviewed boundary expansion.

Source hold: the job's static Environment `jev-issue-comment` is declared but its binding is
NOT_CONFIGURED (an existing compatible Environment and `JEV_API_KEY` are unverified) and the shipped
`runRanges` is empty, so every run stops with `NO_RANGE` before any read, claim or provider call.
GitHub creates a referenced Environment on a job's first run; `issue_comment` workflows run only from
the default branch, so no run happens before adoption, and adoption/merge waits until an existing
compatible binding (no manual per-run review) is verified. No resource is created by this source.

Steps (one job): fixed `actions/checkout` at `github.sha` without persisted credentials -> Nix
toolchain -> resolve the `jev-review` package's own Node and store path from its wrapper before any
credential use -> `plan` (no Jev key, run `GITHUB_TOKEN`) -> the only key-bearing step runs
`semlint-entry.mjs` on `plan.json` and keeps its exit status and stdout -> `post` (no Jev key). Files
between steps live only in the run's temporary directory.

Hard spend bound (attempted consumer provider calls, not money): a call is planned only for a
first-attempt run (`run_attempt == 1`) whose native repository, workflow id (from the run API), path
and run number fall in exactly one reviewed `runRanges` entry; the plan's call cap is
`min(reservedCallsPerRun, limits.maxCalls)` and the fixed entry enforces it. Total attempted calls are
at most `Σ (last − first + 1) × reservedCallsPerRun`, independent of comments, reactions or their
deletion. Ranges never overlap for one workflow id; past ranges are kept and only appended through
the same review; a changed workflow id (rename/recreation) matches no range and stops until a new
range is reviewed, which is new authority, not a reset. Every `issue_comment` run, including skipped
or failed ones, consumes a run number, so ranges can be wasted and exhausted; exhaustion needs a new
reviewed range, not a per-comment grant. Reruns (`run_attempt > 1`) never spend.

`plan`: settings -> event (Issue, not PR) -> run identity and range -> workflow `state` is `active`
(`GET actions/workflows/{id}`) -> exact snapshot -> admission -> prior -> claim -> re-read -> active.
- Snapshot: GraphQL Issue `id number body lastEditedAt includesCreatedEdit userContentEdits` and the
  command comment `id fullDatabaseId author body lastEditedAt includesCreatedEdit userContentEdits`
  plus its `eyes` reactions. Comment identity is `fullDatabaseId` (BigInt wire string, exact safe
  integer round trip, equal to the event's REST id); Int32 `databaseId` and generic `updatedAt` are not
  requested. Errors, missing or extra fields, or identity mismatch hold with `SNAPSHOT_UNKNOWN`.
- `admitIssueCommand` (`github-comment.mjs`): the command must still be the owner's unedited event
  body; the subject is the existing `log-entry` record with the exact full Issue body, ref
  `https://github.com/<repo>/issues/<n>` and revision = node id, body SHA-256 and the body-edit signals
  (no generic `updatedAt`, so unrelated activity is not a revision; not a proof of complete edit
  history); context records are the declared repository files at the run's `github.sha`; checks are
  `allowedChecks`. The existing `preparePlan` validates catalog IDs and caps. The identity binds Issue,
  subject revision, command comment, author, source SHA, settings digest, run and plan digest.
- Prior/claim: only `github-actions[bot]`'s `eyes` is a claim (known other logins ignored,
  unattributable or incomplete reactions held). A prior claim is `STARTED` (never re-evaluated). Only a
  raw `201` naming the bot and `eyes` proceeds; `200` is `ALREADY_CLAIMED`; anything else is UNKNOWN.
- Checkpoint before the paid call: subject, command and our sole claim unchanged and workflow active;
  otherwise the run holds with no provider call (`DRIFT_BEFORE_CALL`, `WORKFLOW_NOT_ACTIVE`,
  `REREAD_UNKNOWN`), claim retained.

`post`: the request is re-admitted from the run-local state (pure) and must have the same digest.
Only exit 1 with an exact closed entry-error (`authority` false, one of the nine pre-provider causes,
no other key; the set is fixed against the entry by a test) is `REFUSED_BEFORE_PROVIDER`; a
`real-result.v2` or `real-result.v3` that composes for this request proceeds; anything else (`ENTRY_FAILED`, empty or
malformed output, no status) is UNKNOWN and never posted. Not-selected, incomplete and failed items
are appended as honest closed records but the receipt's `complete` is false. Before posting, the
workflow must still be active and subject/command unchanged; otherwise the paid result is `WITHHELD`
with its real accounting. Append creates one new comment (never update/delete); only `201` with an id
proceeds, then `verifyResultReadback` compares exact ID/repository/Issue/author/body. Unknown posts are
never reposted; mismatches stay mismatches.

Stop and recovery: disabling the workflow prevents new runs; a run already in progress stops at its
next observed checkpoint (not instantly; an in-flight provider call is not undone and a cancelled run
may leave UNKNOWN). There is no dispatch: after a lost event, a stop or an UNKNOWN, the owner reads back
and reconciles, then posts a new command, which is a new consciously authorized attempt within the
same run reservation; a claimed or UNKNOWN command is never recalled automatically. The source calls no
delete/update API. Duplicate exclusion holds only while provider claim/history stays intact; the hard
spend bound does not depend on it. The executor identity is the fixed `github-actions[bot]`; no
principal migration is authorized.

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
Consumers never read, decrypt, copy or forward it. The shared bound provider sends pinned `jev-1.13.0` native named
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

Comment composition binds the exact result edition and projection recorded by `preparePlan` for each case.
Only semlint `result.v1` and `result.v14` compose; an Issue request whose cases would produce any other
edition is refused at admission (`RESULT_EDITION_NOT_COMPOSABLE`) before any provider call.
A comment carries no reviewed translation, so an Issue request with any v14 case whose subject or context
has a non-null `englishAuxiliary` is also refused at admission (`AUDITED_AUXILIARY_REQUIRES_OWNER_ROUTE`),
checked on the admitted plan snapshot before claim, owner launch, provider call or comment. Such inputs run only
through the owner route with a separately reviewed translation. A composed v14 result is attributed raw model
output under the same claim ceiling, not a quality result.

`runPlan` counts actual invocations of the supplied owner callback. The canonical per-case
callback counter separately counts its invocation wrapper (which may reject on deadline
before the owner callback). Validated calls are distinct. Generic callback fixtures retain
`provider:null` per case and null native totals, never inferred HTTP counters.
`executeOwnerPlan` instead observes the existing shared provider fetch boundary without a second
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
