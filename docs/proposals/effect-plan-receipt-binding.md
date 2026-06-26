# Effect plan and receipt binding proposal

## Why

Effectful operations must be separated into planned intent and observed result.

## Scope purpose

Make every effect traceable from approved intent to observed result, without letting the receipt itself approve policy, business meaning, or authority.

This contributes to the purpose chain by preventing unplanned effects from becoming trusted closure or transfer evidence.

## Direction

Define a binding between effect plans and effect receipts.

## Decision

Effect plans should include scope, snapshot reference, target, intended operation, expected artifact, allowed side effects, rollback path, approval reference, validity window, and severity.

Effect receipts should link to the plan and record observed result, actor, observed_at, source digest, and freshness state. A receipt without its corresponding plan must not become blocking evidence.

## Boundary

ops executes and records effects. It does not own policy authority, accept business decisions, render README artifacts, or mutate repositories outside the explicit effect plan.

## Merge Gate

Implementation must reject effect receipts that have no corresponding plan when blocking mode is enabled.
