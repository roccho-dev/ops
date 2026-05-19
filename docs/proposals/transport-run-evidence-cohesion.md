# CDP Project Transport UX Proposal: todo-20260520-transport-run-evidence-cohesion

Status: proposal-only

This worktree contains exactly one proposal and one matching issue ledger record.
It does not implement code, approve merge, push, cleanup, or close the issue.

## 14. `todo-20260520-transport-run-evidence-cohesion`

Proposal: make `project-transport-run` write one cohesive run directory.

- Problem: upload result, thread result, readbacks, artifact manifest, and knowledge JSONL are scattered.
- Change: wrapper creates a run directory containing all phase outputs and a summary manifest.
- Done when: a parent actor can inspect one directory to know transport status.
- Risk: wrapper may become too large. Keep it orchestration-only and call existing phase wrappers.
