# Ops issue-ledger deferred decisions

createdAt: 2026-05-27T08:23:25+09:00

## Scope

This file records deferred backend, concurrency, compression, archive, and
publication choices for the ops issue ledger. These choices are intentionally
not hidden requirements for the current candidate.

## Decisions

| item | owner | trigger | required evidence before implementation | current status |
|---|---|---|---|---|
| SQLite or latest-state index | ops package owner | JSONL scan time becomes a measured bottleneck, or current-v1 validation cannot complete within the repo gate budget. | Timing report, selected package boundary, rebuild command, stale-index failure test. | Deferred; current JSONL scan remains usable. |
| Same-issue multi-agent mutation | policy plus ops owner | Two actors need to update status, owner, dependency, blocker, closure, or supersedes for the same issue concurrently. | Conflict example, claim/CAS rule, loser retry behavior, validator test. | Deferred; current work uses one candidate writer for this ledger. |
| Compression for large issue/evidence trees | specs archive owner plus ops owner | Evidence volume must move out of normal Git working tree or exceed the agreed size budget. | Archive manifest, hash list, restore command, redaction boundary, fresh-clone behavior. | Deferred; current issue records point to small evidence summaries and hashes. |
| Archive SLA | specs archive owner | A release gate requires archived evidence reachability beyond current local evidence. | SLA statement, storage tier, availability check, failure classification. | Deferred; not required for this candidate's current v1 issue state. |
| Git ref/tree publication for issue state | policy plus ops owner | Git-managed file publication cannot carry code and issue state together safely. | Publication invariant, no-drift check, rollback procedure, merge-review evidence. | Deferred; current state remains Git-tracked JSONL plus review gates. |

## Non-blocking invariant

Current issue operations remain usable without these deferred designs because
the latest state is available from v1 JSONL and checked by
`ops-runbook-checks --issue-ledger` plus the policy issue-ledger validator.

## Evidence

- `packages/ops-runbook-checks/bin/ops-runbook-checks.py`
- `issues/issue-design-localize-20260527/evidence/issue-ledger-fsck-report.json`
- `issues/issue-design-localize-20260527/evidence/ops-runbook-checks-issue-ledger-fsck.log`
