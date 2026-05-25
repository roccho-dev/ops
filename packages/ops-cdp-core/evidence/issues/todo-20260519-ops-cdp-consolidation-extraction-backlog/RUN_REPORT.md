# Issue Run Report: todo-20260519-ops-cdp-consolidation-extraction-backlog

## Issue improved

- `todo-20260519-ops-cdp-consolidation-extraction-backlog`

## Purpose lineage

- Purpose: close one governance issue with issue-specific evidence.
- Meta purpose: keep each issue separately reviewable, mergeable, and closeable.
- Meta-meta purpose: prevent broad raw proof-tree merges.
- Meta-meta-meta purpose: make CDP runtime knowledge discoverable through package-owned evidence and issue links.

## Change summary

This worktree closes the consolidation issue as an extraction-control backlog,
not as a bulk proof-tree import.

Changed files:

- `packages/ops-cdp-core/_incoming/proof-tree-extraction-inventory.tsv`
- `packages/ops-cdp-core/_incoming/proof-tree-source-files.tsv`
- `packages/ops-cdp-core/_incoming/rejected-raw-source-boundary.tsv`
- `flake.nix`
- this `RUN_REPORT.md`

## Evidence against close criteria

| criterion | evidence | status |
|---|---|---|
| package-scoped inventory | `_incoming/proof-tree-extraction-inventory.tsv` | satisfied |
| source file inventory | `_incoming/proof-tree-source-files.tsv` lists canonical ops-cdp-core source/docs/schema files and ownership class | satisfied |
| proof-tree items mapped | inventory classifies durable items as package source, evidence-only, migration-source-only, rejected/no-op, package-boundary, specs-contract, or ops package work | satisfied |
| no broad raw proof-tree merge | `_incoming/rejected-raw-source-boundary.tsv` rejects browser profiles, CDP roots, downloads, nested `.git`, temporary bundles, raw Project artifacts, and raw thread readbacks as package source | satisfied |
| child issue/package links | inventory links nontrivial work to concrete `ops-cdp-core`, `ops-handoff-core`, `ops-src-runtime-pack`, `ops-chrome-cdp-service`, `ops-cdp-zig-lib`, and specs contract boundaries | satisfied |

## Local gate

Expected gate:

```sh
nix build /home/nixos/repos/ops/.worktrees/issue-todo-20260519-ops-cdp-consolidation-extraction-backlog#checks.x86_64-linux.ops-cdp-core --no-write-lock-file
```

The gate checks that the inventory, source-file index, raw-source rejection
boundary, and split package boundaries are present.

Observed result on 2026-05-25: pass.

## Residual risks

- This is an extraction-control closure. It does not claim every old raw proof log is canonical evidence.
- The source inventory is a generated ownership index for review. It is not a second package manifest and does not replace specs.

## Handoff readiness

Ready for `impl-review` as an issue-scoped evidence branch.
