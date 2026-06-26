# ops seed repo note

## Purpose

This note fixes the local role of the ops repository beside the generated README artifact packet.

ops is the runtime, deployment, rollback, transfer, and receipt evidence surface. ops does not decide accepted meaning.

## Authority boundary

- adrs records accepted meaning.
- governance resolves accepted inputs and emits non-authority checks/projections.
- ops emits execution evidence and receipts.
- README artifact output is evidence, not authority.

## Followed records and local sources

- `docs/proposals/seed-repo-note.md` records the accepted local proposal for this note.
- `packages/ops-readme-artifact/flake.nix` builds the README artifact packet.
- The README artifact source list points to ops receipt/record contracts such as `roccho-dev/ops#6`, `roccho-dev/ops#7`, and `roccho-dev/ops#10`.

## Required behavior

ops may emit operational evidence for runtime, deployment, rollback, transfer, receipt, closure, and handoff views.

ops must not claim semantic approval, accepted meaning authority, artifact lifecycle authority, or route-decision authority.

## Merge gate

Keep this note as repo-owned source documentation. Do not use it to override ADRS accepted meaning or governance checks.
