# Ops README materialization inventory for governance #144

## Purpose

Resolve the ops-specific materialization state in governance #144 without adding copied README comparison logic.

## Selected mode

The committed root `README.md` remains `checked-handwritten`.

A repo-local generated README artifact packet exists at `packages/ops-readme-artifact`, and its manifest currently declares `readmeMode=generated`. However, the committed root README is not byte-materialized from that packet and the two README contents differ. Generated root materialization is therefore not yet complete.

## Implemented residual path

The `gov package validation` workflow imports the governance common README materialization checker from `roccho-dev/governance#145` through the existing `governance` flake input and emits `readmeMaterializationResidual.v1`.

The residual is bounded by:

- owner: `roccho-dev/ops`;
- reason: a generated artifact packet exists, but root README is still independently checked and is not byte-materialized from it;
- nextAction: select the artifact as the root README producer, materialize committed `README.md`, and switch to `mkReadmeMaterializedCheck`;
- returnCondition: the generated artifact is the declared root README source and its `README.md` is byte-identical to committed root README under the governance common checker;
- expiry: `2026-08-05`.

## Boundary

This is local materialization evidence only. It does not replace governance #81 / #131 final README projection enforcement, does not mutate branch protection, and does not claim final README projection compliance.

Refs: roccho-dev/governance#144, roccho-dev/governance#145, roccho-dev/governance#131, roccho-dev/governance#81
