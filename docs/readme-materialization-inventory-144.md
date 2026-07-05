# Ops README materialization inventory for governance #144

## Purpose

Resolve the ops-specific unknown in governance #144 without adding copied README comparison logic.

## Selected mode

Ops is currently in `checked-handwritten` README mode. Root `README.md` is a checked artifact, but there is not yet a repo-local generated README artifact that can be byte-compared against the committed README.

## Implemented residual path

The `gov package validation` workflow imports the governance common README materialization checker from `roccho-dev/governance#145` through the existing `governance` flake input and emits `readmeMaterializationResidual.v1`.

The residual is bounded by:

- owner: `roccho-dev/ops`;
- reason: root README is checked handwritten, not generated;
- nextAction: add an ops generated README artifact and switch to `mkReadmeMaterializedCheck`;
- returnCondition: generated README artifact and committed README can be compared by the governance common checker;
- expiry: `2026-08-05`.

## Boundary

This is local materialization evidence only. It does not replace governance #81 / #131 final README projection enforcement, does not mutate branch protection, and does not claim final README projection compliance.

Refs: roccho-dev/governance#144, roccho-dev/governance#145, roccho-dev/governance#131, roccho-dev/governance#81
