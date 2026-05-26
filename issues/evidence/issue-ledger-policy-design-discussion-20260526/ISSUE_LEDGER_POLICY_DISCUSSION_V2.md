# ISSUE_LEDGER_POLICY_DISCUSSION_V2

discussionId: issue-ledger-policy-design-20260526
proposalRevision: v2
threadFunction: impl-review

## Required Source Files

Before returning a verdict, each review thread must read these Project Source files:

- `ISSUE_LEDGER_POLICY_DISCUSSION_V1.md`
- `THREAD_A_REPLY_V1.md`
- `THREAD_B_REPLY_V1.md`
- `THREAD_A_PEER_REVIEW_V1.md`
- `THREAD_B_PEER_REVIEW_V1.md`

If any file is not readable, return `UNRESOLVED_OBJECTIONS` and name the missing file.

## Proposal

The v1 discussion should not become one monolithic policy patch.

Adopt this split:

1. Policy patch seed
2. Ops repo-local issue design task
3. Migration task
4. Explicitly deferred design discussion

No thread should claim implementation approval, merge approval, cleanup approval, or issue closure from this discussion alone.

## Policy Patch Seed

Policy should define invariants, not repo-specific HOWTOs.

Add or clarify these global rules:

- Git may hold the issue control plane, but Git is not automatically the evidence data plane.
- Each repo must expose a minimal worker-readable issue interface, even if the repo uses a richer local issue schema.
- `issues/*.jsonl` must not silently mean both current v1 records and legacy historical records.
- Repos must declare active, archive, legacy, migration, and release validation scopes, either by path convention or manifest.
- Validation modes must have different meanings:
  - active: current worker-startable issues and their current causal chains.
  - full-v1 or full-replay: all declared current-schema issue history.
  - migration: permits known legacy exceptions but fails on new unclassified ones.
  - release: active plus required archive/evidence checks for merge/release hygiene.
  - archive-restore: cold evidence and replay restoration checks.
- `blocked` is scoped to the issue record's target, allowed paths, close criteria, and blocker. It is not a global statement that the tool, repo, or subsystem cannot be used.
- Policy should support narrowing: a broad issue may be superseded by a narrower latest record when some close criteria are satisfied but the worker-facing identity remains continuous.
- Policy should define split-vs-supersede at invariant level:
  - use same `issueId` with `supersedes` when the worker-facing problem, owner, target repo, and main close criteria remain continuous.
  - split to a new issue when ownership, target repo, allowed paths, risk class, or close criteria diverge enough that one worker should not inherit the old issue as-is.
- Issue evidence should move from bare string refs toward structured `evidenceRefs[]` with at least:
  - `ref`
  - `kind`
  - `sha256` when available
  - `sizeBytes` when available
  - `storageTier`
  - `retentionClass`
  - `sensitivity`
  - `requiredForClose`
- Uploads, readbacks, generated reports, issue records, facilitator summaries, and discussion replies are evidence, not approval.
- Generated views such as Markdown issue pages, dashboards, latest-state databases, and review packets are not authoritative unless policy or repo-local design explicitly promotes them.
- Repos must declare issue backend/concurrency mode:
  - single-writer
  - multi-writer event stream
  - hybrid, where append-only comments/evidence are multi-writer but status/owner/dependency/blocker/closure mutations require claim/CAS or single-writer control.

## Ops Repo-Local Issue Design Task

Ops should own concrete mechanics, not global policy.

Ops should decide and document:

- whether active/archive/legacy are represented by paths such as `issues/active`, `issues/archive`, `issues/legacy`, or by an `issues/ledger-manifest.json`.
- whether current issue state remains complete-snapshot JSONL or moves to an event stream plus generated latest-state view.
- how latest-state views are generated and marked non-authoritative.
- whether and when SQLite or another materialized view is used.
- evidence storage tiers and size thresholds for keeping evidence in normal Git, cold Git archive, LFS/annex/artifact store, or outside the repo.
- replay/fsck checks for duplicates, missing supersedes/parents, evidence hashes, generated-view rebuild, and archive restore.
- post-push or post-merge checks that issue state and code state did not diverge.

## Migration Task

Do not rewrite legacy history casually.

Minimal migration path:

1. Preserve legacy files as evidence.
2. Classify `ops/issues/260519.jsonl` as legacy, not active current-schema input.
3. Keep the currently passing v1 chain intact:
   - `260524.jsonl`
   - `260525.jsonl`
   - `260526.jsonl`
4. Add a v1 migration/index record that points to legacy records where useful.
5. Inventory Markdown issues and existing evidence directories.
6. Add validation modes before broad movement of files.
7. Backfill indexes or manifests; do not mutate old records just to make them appear native.

## Deferred Design Discussion

These are important but should not block the first policy/design split:

- exact event schema if ops moves from snapshot JSONL to event-sourced issue state.
- exact SQLite/latest-state threshold.
- exact cold archive restore SLA.
- exact artifact-store credentials policy.
- exact same-issue multi-agent mutation implementation.
- exact compression format.
- exact Git refs vs tree-file publication model.

## Required Verdict Format

Return exactly one top-level verdict block:

```text
VERDICT_JSON: {"actorId":"<your actorId>","proposalRevision":"v2","verdict":"NO_UNRESOLVED_OBJECTIONS","unresolvedObjections":[]}
```

or:

```text
VERDICT_JSON: {"actorId":"<your actorId>","proposalRevision":"v2","verdict":"UNRESOLVED_OBJECTIONS","unresolvedObjections":[{"objectionId":"...","objectionText":"...","requiredChange":"..."}]}
```

After the verdict block, briefly explain the decisive reason.

Do not claim `impl-review-pass`; this is a direct cross-discussion no-objections check for proposalRevision `v2`.
