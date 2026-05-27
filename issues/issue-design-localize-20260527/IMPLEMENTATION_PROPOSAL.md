# Ops issue-design closing proposal

createdAt: 2026-05-27T05:10:00+09:00

## Scope

- repo: `/home/nixos/repos/ops`
- branch: `codex/ops-issue-design-localize-20260527`
- base: `4c903a0eea596d31665f78046614871071559cd2`
- issue records: `issues/260527-issue-design-localize.jsonl`

## What this proposal closes

This candidate turns the issue-design open records into a closeable proposal.
It does not canonical-close them by itself.

## Local issue ledger design

Ops keeps current issue state in `issues/*.jsonl`. Markdown issues and older
evidence files remain legacy evidence until represented by a v1 record.

Generated outputs may include Markdown summaries, HTML views, SQLite/latest
indexes, and migration reports. They are projections only. The latest state is
the newest valid v1 record by `recordedAt` with a valid `supersedes` chain.

Large proof trees stay behind an index. A current issue record may point to a
manifest or digest, but raw Project DOM dumps, browser profiles, credentials,
and private artifacts are not copied into main as the current issue truth.

## Validation and fsck gate

This candidate keeps the policy issue-ledger validator as the schema/authority
gate and adds an ops fsck report through the existing `ops-runbook-checks`
package.

Policy gate:

```text
/home/nixos/repos/policy/.agents/tests/check-issue-ledger-jsonl.sh issues/260527-issue-design-localize.jsonl
```

Ops fsck gate:

```text
ops-runbook-checks --issue-ledger issues/260527-issue-design-localize.jsonl --legacy-glob 'issues/*.jsonl' --json
```

The ops gate validates:

- parse all v1 records;
- validate schema, status, and recordType consistency;
- verify `recordedAt` uniqueness per issue;
- verify `supersedes` points to the previous latest record;
- require blocker and closure fields for blocked/closed states;
- enforce active `targetRepo + suggestedBranch` uniqueness;
- report legacy/non-v1 records separately from current v1 validation.

The checked-in fsck evidence is:

- `issues/issue-design-localize-20260527/evidence/issue-ledger-fsck-report.json`
- `issues/issue-design-localize-20260527/evidence/ops-runbook-checks-issue-ledger-fsck.log`

## Migration plan

The checked-in migration inventory is
`issues/issue-design-localize-20260527/MIGRATION_INVENTORY.md`.

1. Keep existing Markdown issues and legacy JSONL files as evidence.
2. Add v1 records for active work before changing implementation state.
3. Use generated inventories to map legacy Markdown files to v1 issueIds.
4. Do not delete or rewrite legacy evidence during migration.
5. For large evidence directories, keep a manifest or digest in Git and move
   raw credential-bearing material to redacted, encrypted, excluded, or
   local-only handling.

Rollback is simple: remove the candidate branch from review and return to the
previous canonical `issues/*.jsonl` state. No canonical files are edited by
this candidate until localizer approval.

## Project Source proof implementation

This candidate imports the focused Project transport fix from
`codex/one-worktree-all-active-issues-20260526` without importing the full raw
proof tree.

The implementation distinguishes:

- source upload or visibility;
- env route probe;
- source-list probe;
- target-thread delayed assistant readback;
- semantic approval.

The proof summary keeps `semanticApproval=false`,
`completionApproval=false`, and `routeDecision=false`. Env/list probe failures
cannot override a same-run delayed assistant readback proof.

## Discussion FSM hardening

This candidate imports the focused marker fix from
`codex/one-worktree-all-active-issues-20260526`.

Marker fallback no longer treats `NO_UNRESOLVED_OBJECTIONS` as
`UNRESOLVED_OBJECTIONS` by substring. Discussion convergence remains a
discussion state only; it is not implementation approval, merge approval,
localizer approval, push approval, cleanup approval, or canonical issue
closure.

## Deferred choices

The checked-in decision table is
`issues/issue-design-localize-20260527/DEFERRED_DECISIONS.md`.

The following remain design choices with owners and triggers, not hidden
requirements for this candidate:

- SQLite/latest index threshold: add only when JSONL scans become a measured
  bottleneck.
- Same-issue multi-agent mutation: add only when conflicting active updates are
  observed and a resolver owner is defined.
- Compression and archive SLA: add after specs archive publication contract is
  accepted.
- Git ref/tree publication: add only when the current Git-tracked issue state
  cannot carry the required public summary safely.

Current issue operation remains usable without these choices.
