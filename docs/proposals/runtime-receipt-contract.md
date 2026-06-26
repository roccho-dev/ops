# Runtime receipt contract proposal

## Why

README artifacts explain existence but do not prove runtime behavior. ops must emit runtime receipts for closure and transfer views.

## Direction

Define a runtime receipt contract for effectful execution and observed runtime state.

## Decision

Runtime receipts should include repo commit, artifact digest, operation id, environment, observed_at, result, check version, operator or actor, and validity window.

## Boundary

Receipts are evidence, not authority. They do not accept decisions or replace ADR records.

## Merge Gate

Implementation must fail stale, missing, or unknown runtime receipts where blocking closure requires fresh evidence.