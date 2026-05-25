# Slim Branch Run Report

## Branch

- worktree: `/home/nixos/repos/ops/.worktrees/project-source-transport-proof-slim-20260526`
- branch: `codex/project-source-transport-proof-slim-20260526`
- raw evidence branch kept separate: `codex/project-source-transport-proof-20260525` at `49a0bbe`

## Result

The slim branch is prepared as the merge proposal for Project Source false-positive guard work.

It does not claim that the target Project Source handoff is solved. The latest issue state remains `blocked`.

## Checks

```text
nix shell nixpkgs#python3 --command env HQ_CDP_SCRIPT_SRC=packages/ops-cdp-core/src/cdp python3 packages/ops-cdp-core/src/cdp/test-project-transport-regressions.py
PASS: project transport false-positive regression tests

nix shell nixpkgs#python3 --command bash /home/nixos/repos/policy/.agents/tests/check-issue-ledger-jsonl.sh /home/nixos/repos/ops/.worktrees/project-source-transport-proof-slim-20260526/issues/260524.jsonl /home/nixos/repos/ops/.worktrees/project-source-transport-proof-slim-20260526/issues/260525.jsonl
issue-ledger-jsonl-gate-pass

sha256sum -c issues/evidence/project-source-worker-readable-20260524/SLIM_EVIDENCE_SHA256SUMS
OK

nix shell nixpkgs#python3 --command python3 -m py_compile packages/ops-cdp-core/src/cdp/project-transport.py packages/ops-cdp-core/src/cdp/test-project-transport-regressions.py
OK

nix flake check /home/nixos/repos/ops/.worktrees/project-source-transport-proof-slim-20260526 --no-write-lock-file
pass
```

## Excluded From Slim Branch

- `TEMPORARY_policy_git_bundle_handoff_*.zip`
- `policy-refs.bundle`
- `source-snapshot/`
- raw CDP DOM dump files
- full Project proof archive tree
