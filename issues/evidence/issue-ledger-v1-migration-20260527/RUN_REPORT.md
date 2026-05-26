# Issue Ledger v1 Migration Run Report

Repo: ops
Worktree: /home/nixos/repos/ops/.worktrees/issue-ledger-v1-migration-20260527
Branch: codex/ops-issue-ledger-v1-migration-20260527
Base head: 4c903a0eea596d31665f78046614871071559cd2
Recorded at: 2026-05-27T06:00:01+09:00

## Scope

- Migrated legacy records: 27
- Preserved existing v1 records: 9
- Final validator record count: 38
- Added migration issue records: issues/260527.jsonl
- Migration evidence: issues/evidence/issue-ledger-v1-migration-20260527/migration-report.json

## Gates

- policy issue ledger validator: pass
- git diff --check: pass

## Notes

This migration changes issue ledger shape only. It does not close the underlying migrated open issues unless a legacy terminal record already existed.
