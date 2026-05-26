# One Worktree Active Issues Run Report

createdAt: 2026-05-26T20:50:00+09:00

## Scope

- repo: `/home/nixos/repos/ops`
- worktree: `/home/nixos/repos/ops/.worktrees/one-worktree-all-active-issues-20260526`
- branch: `codex/one-worktree-all-active-issues-20260526`
- base head: `8d064517f4a827c6043e53c832152d3a696e204a`

## Purpose Lineage

| depth | purpose |
|---|---|
| 3 | Submit one ops candidate worktree that resolves the current active v1 issues. |
| 2 | Keep Project Source transport and discussion FSM states from creating false blockers or false approvals. |
| 1 | Keep ChatGPT/Codex/local repo operation recoverable through evidence and issue records. |
| 0 | Make local repo development verifiable and mergeable without relying on conversation prose. |

## Issues Closed

| issueId | latest record | summary |
|---|---|---|
| `ops.project-source-worker-readable-upload` | `issue-record.ops.project-source-worker-readable-upload.closed.20260526T204700+0900` | Env/list probes are marked advisory and cannot override same-run delayed assistant readback proof. |
| `ops.thread-fsm-marker-substring` | `issue-record.ops.thread-fsm-marker-substring.closed.20260526T204701+0900` | Marker fallback no longer treats `NO_UNRESOLVED_OBJECTIONS` as `UNRESOLVED_OBJECTIONS` by substring. |

## Changes

- `packages/ops-thread-fsm/lib/ops_thread_fsm/discussion.py`
  - Adds line-level / token-boundary marker matching.
- `packages/ops-thread-fsm/tests/test_ops_thread_fsm.py`
  - Adds regression coverage for assistantText-only no-objections, JSON text, and real objections.
- `packages/ops-cdp-core/src/cdp/project-transport.py`
  - Adds explicit advisory authority fields for route and source-list probes.
  - Adds `classify_transport_proof_steps` for same-run worker-readable proof summary.
- `packages/ops-cdp-core/src/cdp/test-project-transport-regressions.py`
  - Covers env/list false-negative probes after delayed assistant readback succeeds.
- `packages/ops-cdp-core/docs/project-transport.md`
  - Documents that delayed assistant readback is worker-readable proof and probe failures are advisory.
- `packages/ops-cdp-core/src/cdp/docs/chatgpt-command-map.md`
  - Updates operator-facing command map with the same boundary.
- `issues/260526.jsonl`
  - Adds closed records for both active v1 issues.
- `issues/evidence/...`
  - Adds gate logs and imports small supporting live/repro evidence.

## Gates

| gate | evidence |
|---|---|
| ops-thread-fsm unit | `issues/evidence/one-worktree-all-active-issues-20260526/gates/ops-thread-fsm-unit.log` |
| ops-cdp-core transport regression | `issues/evidence/one-worktree-all-active-issues-20260526/gates/ops-cdp-core-transport-regressions.log` |
| nix build ops-thread-fsm check | `issues/evidence/one-worktree-all-active-issues-20260526/gates/nix-build-ops-thread-fsm-check.log` |
| nix build ops-cdp-core check | `issues/evidence/one-worktree-all-active-issues-20260526/gates/nix-build-ops-cdp-core-check.log` |
| issue ledger v1 chain | `issues/evidence/one-worktree-all-active-issues-20260526/gates/issue-ledger-v1-chain.log` |
| diff whitespace | `issues/evidence/one-worktree-all-active-issues-20260526/gates/git-diff-check.log` |
| repo flake check | `issues/evidence/one-worktree-all-active-issues-20260526/gates/nix-flake-check.log` |

Hashes are in `issues/evidence/one-worktree-all-active-issues-20260526/GATE_SHA256SUMS`.

## Boundaries

- This is an `impl-work` candidate artifact, not an `impl-review-pass`.
- This is not `merge-review-pass`, canonical merge approval, push approval, cleanup approval, or final issue closure on canonical.
- The imported Project discussion evidence remains review input. It is not approval.

## Residual Risk

- Full `issues/*.jsonl` validation still includes legacy/non-v1 records by current policy glob and is intentionally not used as the active v1 gate here.
- The broader policy/specs issue-design work remains outside this ops-only worktree.
