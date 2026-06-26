# R4 ops README artifact CI adoption

## Why

ops should publish its own README artifact packet as repo CI evidence for runtime, deployment, rollback, and transfer work.

## Direction

Add an ops-local README artifact package and a declared artifact exporter workflow.

## Decision

`ops` should expose a Nix-built README artifact packet under `packages/ops-readme-artifact`. The packet must include `README.md`, `manifest.json`, `sources.jsonl`, and `receipt.json`.

## Boundary

The generated README artifact is non-authority evidence. ops emits receipts and execution evidence; it does not decide accepted meaning.

## Proof

The implementation adds a Nix-built artifact packet, a check for required files, and a GitHub artifact exporter workflow declared in `ci.intent.v1.jsonl`.

## Change Summary

- Add `packages/ops-readme-artifact/flake.nix`.
- Add `.github/workflows/readme-artifact.yml`.
- Add artifact exporter row to `ci.intent.v1.jsonl`.

## Merge Gate

Merge only if `nix-check` and `README artifact exporter` pass.
