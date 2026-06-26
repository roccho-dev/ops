# Effect plan and receipt binding proposal

## Why

Effectful operations must be separated into planned intent and observed result.

## Direction

Define a binding between effect plans and effect receipts.

## Decision

Effect plans should include target, intended operation, expected artifact, allowed side effects, rollback path, and approval reference. Effect receipts should link to the plan and record observed result.

## Boundary

ops executes and records effects. It does not own policy authority or accept business decisions.

## Merge Gate

Implementation must reject effect receipts that have no corresponding plan when blocking mode is enabled.