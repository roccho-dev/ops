# Issue Run Report: todo-20260520-transport-run-evidence-cohesion

## Issue improved

- `todo-20260520-transport-run-evidence-cohesion`

## Purpose lineage

- Purpose: close one governance issue with issue-specific evidence.
- Meta purpose: keep each issue separately reviewable, mergeable, and closeable.
- Meta-meta purpose: reduce manual transport evidence collation.
- Meta-meta-meta purpose: make Project handoff and review evidence recoverable from one run directory.

## Change summary

This worktree makes `project-transport-run` write one cohesive evidence
directory for both success and failure paths.

Changed files:

- `packages/ops-cdp-core/src/cdp/project-transport.py`
- `flake.nix`

## Evidence files written per run

| file | purpose |
|---|---|
| `TRANSPORT_RUN_REPORT.md` | concise human index |
| `transport-result.json` | wrapper result with non-approval flags; mutable because `evidenceBundle` is added after bundle generation |
| `transport-result.snapshot.json` | stable hash-covered wrapper result snapshot |
| `TRANSPORT_STATUS.jsonl` | machine status row |
| `TRANSPORT_KNOWLEDGE.jsonl` | redaction/manual-collation policy row |
| `ARTIFACTS_MANIFEST.json` | artifact manifest, empty when no artifact was fetched |
| `TRANSPORT_RUN_MANIFEST.json` | file inventory and checksums |
| `SHA256SUMS.tsv` | stable checksum list |
| `TRANSPORT_RUN_INDEX.md` | entrypoint for the run directory |

## Local gate

Expected gate:

```sh
nix build /home/nixos/repos/ops/.worktrees/issue-todo-20260520-transport-run-evidence-cohesion#checks.x86_64-linux.ops-cdp-core --no-write-lock-file
```

The check asserts the evidence files exist and that approval flags remain false.
It also verifies success and failure run directories, requires manifest/checksum
coverage for `TRANSPORT_RUN_INDEX.md` and `transport-result.snapshot.json`, and
verifies `SHA256SUMS.tsv` with `sha256sum -c`.

Observed result on 2026-05-25: pass.

## Residual risks

- This wraps transport evidence. It does not approve content, completion, merge, or route decisions.

## Handoff readiness

Ready for `impl-review` as an issue-scoped implementation branch.
