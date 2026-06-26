# Runtime receipt contract proposal

## Why

README artifacts explain existence but do not prove runtime behavior. ops must emit runtime receipts for closure and transfer views.

## Scope purpose

Make runtime behavior observable as scoped evidence, without letting ops approve authority, business meaning, or repository purpose.

This contributes to the purpose chain by turning runtime claims from person-dependent notes into replayable, freshness-checked receipts that governance can consume for closure and transfer views.

## Direction

Define a runtime receipt contract for effectful execution and observed runtime state.

## Decision

Runtime receipts should include scope, snapshot reference, repo commit, artifact digest, operation id, environment, observed_at, result, check version, operator or actor, validity window, and source digest.

A valid runtime receipt must bind the observed runtime state to the selected scope and snapshot. Stale, missing, or unknown runtime evidence must be represented explicitly so blocking closure can fail closed.

## Boundary

Receipts are evidence, not authority. They do not accept decisions, replace ADR records, render README artifacts, or mutate repositories.

## Merge Gate

Implementation must fail stale, missing, or unknown runtime receipts where blocking closure requires fresh evidence.
