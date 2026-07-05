# Ops README materialization inventory for governance #144

## Purpose

Resolve the ops-specific unknown in governance #144 without adding copied README comparison logic.

## Current target

Ops should first declare whether root README is generated, checked handwritten, managed block, or residual. If generated mode is active, ops should import the governance common checker from roccho-dev/governance#145 and expose `checks.readme-materialized`.

## Residual path

If ops is not ready for generated README materialization, the repo must emit a bounded residual with:

- owner;
- reason;
- nextAction;
- returnCondition;
- expiry.

## Boundary

This is local materialization evidence only. It does not replace governance #81 / #131 final README projection enforcement and does not mutate branch protection.

Refs: roccho-dev/governance#144, roccho-dev/governance#145, roccho-dev/governance#131, roccho-dev/governance#81
