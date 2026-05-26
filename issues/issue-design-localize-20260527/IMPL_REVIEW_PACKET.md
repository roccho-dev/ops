# Ops issue-design impl-review packet

createdAt: 2026-05-27T07:20:00+09:00

## Scope

- repo: `/home/nixos/repos/ops`
- base branch: `main`
- base head: `4c903a0eea596d31665f78046614871071559cd2`
- candidate branch: `codex/ops-issue-design-localize-20260527`
- worktree: `/home/nixos/repos/ops/.worktrees/ops-issue-design-localize-20260527`
- issue records: `issues/260527-issue-design-localize.jsonl`

## Purpose

Submit the ops-side implementation proposal, concrete gate changes, and
proposed closed issue records for impl-review. This packet is not
localize-ready evidence.

## Issue records opened

- `ops.issue-ledger-local-design`
- `ops.issue-ledger-validation-fsck-and-divergence-gates`
- `ops.issue-ledger-migration-plan`
- `ops.cdp-project-source-worker-readable-proof`
- `ops.thread-fsm-discussion-classification-hardening`
- `ops.issue-ledger-backend-concurrency-and-archive-deferred`

## Proposed closed records

The same issueIds have later `closed` records in
`issues/260527-issue-design-localize.jsonl`. They are proposed latest states for
review. They are not canonical closure.

## Concrete additions since v3 reject

- `packages/ops-runbook-checks/bin/ops-runbook-checks.py` now includes an
  `--issue-ledger` fsck mode for current v1 ledgers.
- `flake.nix` checks the new fsck mode with a v1 supersedes/closure fixture and
  a separate legacy/non-v1 report fixture.
- `issues/issue-design-localize-20260527/MIGRATION_INVENTORY.md` inventories
  current v1, legacy JSONL, Markdown, and evidence paths with preservation and
  rollback handling.
- `issues/issue-design-localize-20260527/DEFERRED_DECISIONS.md` records owner,
  trigger, and required evidence for SQLite/latest index, same-issue
  concurrency, compression, archive SLA, and Git ref/tree publication.

## Source evidence

- `/home/nixos/repos/ops/issues/evidence/issue-ledger-policy-design-discussion-20260526/ISSUE_DESTINATION_TABLE.md`
- `/home/nixos/repos/ops/issues/evidence/one-worktree-all-issues-final-shape-discussion-20260526/ONE_WORKTREE_ALL_ISSUES_DISCUSSION_V1.md`
- `/home/nixos/repos/ops/issues/evidence/project-source-worker-readable-20260524/live-reproof-20260526/LIVE_REPROOF_SUMMARY.json`
- `/home/nixos/repos/ops/issues/evidence/one-worktree-all-active-issues-20260526/RUN_REPORT.md`

## Boundaries

- This candidate opens ops-owned work only.
- It does not close the already identified implementation issues by itself.
- It requires impl-review before merge-review.
- It is not ready for localizer action before impl-review-pass, merge-review-pass, post-merge-review preflight, and the required parent/localizer authorization.
- It does not merge, push, clean up, or approve canonical closure.
- Large raw Project evidence remains evidence input, not approval.

## Gates

- `issues/issue-design-localize-20260527/evidence/issue-ledger.log`: pass
- `issues/issue-design-localize-20260527/evidence/ops-runbook-checks-issue-ledger-fsck.log`: pass
- `issues/issue-design-localize-20260527/evidence/issue-ledger-fsck-report.json`: pass report
- `issues/issue-design-localize-20260527/evidence/ops-cdp-core-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/ops-thread-fsm-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/ops-runbook-checks-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/nix-flake-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/git-diff-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/GATE_SHA256SUMS`: recorded

## Implementation proposal

- `issues/issue-design-localize-20260527/IMPLEMENTATION_PROPOSAL.md`

## State

```text
ready-for-impl-review
```
