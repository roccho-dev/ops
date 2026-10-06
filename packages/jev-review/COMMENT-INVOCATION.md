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

- `issue-executor.mjs`: one finite scan (`node issue-executor.mjs --config <absolute path>`) over a
  trusted exact-ID grant; see "Issue executor" below. No daemon, loop, timer, queue or ledger.
- `tests/issue-executor.mjs`: secret-free fixtures through the same adapter code with injected
  process runner and clock (`jev-issue-executor` check).

Target owner deployment, supply, adoption of the fixed executables, permissions and live provider
behavior are **NOT_CONFIGURED / UNVERIFIED by this source**. Fixtures do not prove live
at-most-effect, real 201/200 semantics, paid-call accounting or Issue completion.
There is no new workflow, package, client, secret store, bridge, queue or ledger.

## Issue executor

Trusted config (exact keys, non-secret, P-owned): `repository, issue, requesters, executionSource,
limits, executorLogin, owner{envsSha, opsSha}, grant{version, commentIds, totalCalls, totalPosts,
totalClaims, expiresAt, postIncomplete}`. `opsSha` must equal `executionSource`. No executable path,
argv, program or cwd is accepted; the adapter's only executables are the source constants
`/nix/var/nix/profiles/windows-dev/bin/gh` and `/nix/var/nix/profiles/windows-dev/bin/ops-jev`
(candidates declared by the owner profile source, windows `0d77745` `oci/dev/nix.nix`; their target
adoption is not implied). The owner argv is fixed: `--semlint-real --envs-sha <envsSha> --ops-sha <opsSha>`,
and stdin is the admitted `request.prepared.plan` (cases plus effective caller caps). The executor
never reads, decrypts or forwards a key; it inherits its cwd (the owner gh wrapper selects the owner
only inside a bound clone) and verifies `gh api user` equals `executorLogin` before any read.

Finite grant, checked before any effect: exact nonempty duplicate-free `commentIds` (S), expiry,
`|S| × limits.maxCalls ≤ totalCalls`, `|S| ≤ totalPosts`, `|S| ≤ totalClaims`. Observed claim or
result counts are never a budget semaphore. Within one grant version the worst case is therefore
static; spending across versions accumulates the newly granted IDs, which is the grant author's decision.

Scan order, stopping all later effects in the run at the first UNKNOWN:
1. Read every Issue comment through GraphQL with complete pagination. Errors, missing pages, count
   mismatch, non-object nodes or duplicate IDs stop the scan with no claim. Comment identity comes only
   from `fullDatabaseId` (GraphQL `BigInt`, wire-encoded as a string); the Int32 `databaseId` cannot
   represent real REST comment IDs and is not requested. The string must be `^[1-9][0-9]*$`, a safe
   integer and round-trip exactly; it then equals the REST comment `id` used for claim, append and
   readback. The opaque node `id` is compared, never decoded. A node whose ID fails this rule or whose key
   set differs from the requested fields (for example an unrequested `databaseId`) is unidentifiable: it is
   excluded and counted (`unidentifiedComments`) rather than stopping the scan, because every effect is
   keyed by a verified exact ID; a granted ID that cannot be identified is `NOT_FOUND` with zero effect.
   A re-read that is unidentifiable is UNKNOWN. Incomplete reactions of the
   source-constant claim kind (`eyes`) hold only that comment (`CLAIMS_INCOMPLETE`). Result comments
   count only when authored by `executorLogin`; copies by anyone else are ignored (counted in
   `ignoredResults`), so they can neither fake delivery nor block it.
2. `admitIssueSnapshot` (distinct from the `created` webhook path; no action is fabricated):
   exact provider fields, comment ∈ S, and a conservative edit filter (`lastEditedAt` null,
   `includesCreatedEdit` false, zero `userContentEdits`). The filter refuses edit signals; it is not
   proof that provider history was never edited. Identity binds node id, database id, author,
   `updatedAt`, body digest, observation kind, source and the full config digest.
3. `deriveIssuePrior` from provider state only. Only `executorLogin`'s reaction is a claim: a known
   other login's same-kind reaction is not a claim and grants no principal migration, so it is ignored;
   an unattributable (null/deleted-user) reaction or a duplicate claim is held as `UNRECOGNIZED`.
   Our claim without a matching trusted result is `STARTED`; our claim plus one verified trusted result
   is `APPENDED` (readback only). `nextIssueEffect` maps these.
4. Re-check expiry from the injected clock, then claim with `gh api -i`: only a raw `201` whose body
   names `executorLogin` and `eyes` proceeds. `200` is already claimed; any other status, unparsable
   output or a different user stops.
5. Re-read the comment after the claim and before any paid call; any change of the snapshot, loss of
   our claim, an unattributable reaction or incomplete reactions stop as `DRIFT_AFTER_CLAIM` with the
   claim retained.
6. Re-check expiry, then launch the fixed owner. Only exit 1 with an exact closed entry-error
   (`schema` `ops.semlint.entry-error.v1`, `status` `REJECTED`, `authority` false, one of the nine
   pre-provider causes and no other key) is `REFUSED_BEFORE_PROVIDER`; exit 0 with a closed `real-result.v2` or `real-result.v3`
   that composes for this request proceeds; anything else (`ENTRY_FAILED`, empty or malformed stdout,
   launcher refusal) is UNKNOWN, because a launcher failure and a child crash cannot be distinguished
   from stdout. The nine causes are a copy of the entry's closed allowed set, fixed by a test.
7. Unless `grant.postIncomplete`, a result that is not fully validated with zero unknown calls is
   withheld (claim retained, no post).
8. Re-check expiry. Expiry is one hard permission boundary for every effect, including delivery of an
   already paid result: after `expiresAt` nothing is posted; the receipt reports
   `GRANT_EXPIRED_BEFORE_APPEND` with the paid accounting and the claim keeps the ID `STARTED`. A grant
   never extends itself; delivering that evaluation needs a new request comment under a new grant.
   Otherwise append once with `gh api -i`; only `201` with an id proceeds, then the comment is re-read
   and `verifyResultReadback` compares exact ID/repository/Issue/author/body. An unknown post is never
   reposted; a later scan reconciles it.

Process calls use the existing finite 30-minute per-call timeout constant; a timeout before a write
is a read failure (no effect), during a claim/append/launch it is UNKNOWN and retained.

Supply candidate (not proven): the existing `jev-review` package copies the whole `packages/jev-review`
directory into its store path and runs its own closure Node, so `issue-executor.mjs` and its siblings
can be started as `<that node> <that store path>/issue-executor.mjs` without a new bin, helper or
package row. The same store path is the one the owner launcher extracts for `tests/run.mjs`. Not
proven by this source: that an actual canonical build contains the executor at that path, the exact
start path on a target, and that the running executor was built from the same commit as `opsSha`
(`executionSource`); the executor cannot observe its own commit. These are runtime residuals.

Every claim remains: after `STARTED`, a refusal, a withheld result or any UNKNOWN, that comment ID
is never re-evaluated. Re-running needs a new request comment and a new grant version. The source
calls no delete/update provider API. At-most-effect holds only while provider state stays intact:
removal of the claim reaction or of history by anyone holding `executorLogin` credentials (or an
administrator) is outside this proof and is not detectable by the source.

At-most-effect is per fixed `executorLogin`. No principal migration is currently authorized. Because a
known other login's reaction is ignored (only unattributable reactions are held), claims made by a former
executor are invisible to a new one: under a changed `executorLogin`, an ID that the old principal
already claimed or paid for would be evaluated again. The source cannot guarantee migration exclusion.
Any future, separately authorized migration therefore requires the grant author to exclude from the new
grant every comment ID previously granted to or claimed by the old principal.

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
