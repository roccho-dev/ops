# Ops issue-design localize-ready report

createdAt: 2026-05-27T04:39:30+09:00

## Scope

- repo: `/home/nixos/repos/ops`
- base branch: `main`
- candidate branch: `codex/ops-issue-design-localize-20260527`
- worktree: `/home/nixos/repos/ops/.worktrees/ops-issue-design-localize-20260527`
- issue records: `issues/260527-issue-design-localize.jsonl`

## Purpose

Localize the ops-side implementation proposal and proposed closed issue records
from the two-thread discussion. These records split the operation work into
local issue ledger design, gates, migration, Project Source proof, discussion
FSM hardening, and deferred backend/archive choices.

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
review/localization, not canonical closure.

## Source evidence

- `/home/nixos/repos/ops/issues/evidence/issue-ledger-policy-design-discussion-20260526/ISSUE_DESTINATION_TABLE.md`
- `/home/nixos/repos/ops/issues/evidence/one-worktree-all-issues-final-shape-discussion-20260526/ONE_WORKTREE_ALL_ISSUES_DISCUSSION_V1.md`
- `/home/nixos/repos/ops/issues/evidence/project-source-worker-readable-20260524/live-reproof-20260526/LIVE_REPROOF_SUMMARY.json`
- `/home/nixos/repos/ops/issues/evidence/one-worktree-all-active-issues-20260526/RUN_REPORT.md`

## Boundaries

- This candidate opens ops-owned work only.
- It does not close the already identified implementation issues by itself.
- It does not merge, push, clean up, or approve canonical closure.
- Large raw Project evidence remains evidence input, not approval.

## Gates

- `issues/issue-design-localize-20260527/evidence/issue-ledger.log`: pass
- `issues/issue-design-localize-20260527/evidence/ops-cdp-core-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/ops-thread-fsm-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/nix-flake-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/git-diff-check.log`: pass
- `issues/issue-design-localize-20260527/evidence/GATE_SHA256SUMS`: recorded

## Implementation proposal

- `issues/issue-design-localize-20260527/IMPLEMENTATION_PROPOSAL.md`

## State

```text
ready-for-localizer
```
