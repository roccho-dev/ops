# Rollback receipt contract proposal

## Why

High-value transfer and safe operations require evidence that important runtime changes can be reversed.

## Scope purpose

Make reversibility observable as scoped evidence, without letting rollback evidence approve incidents, authority, or business decisions.

This contributes to the purpose chain by proving that a buyer or successor operator can recover from important changes instead of relying on the original owner.

## Direction

Define rollback receipts for deployed artifacts and effectful operations.

## Decision

Rollback receipts should include scope, snapshot reference, deployment or effect plan id, previous artifact digest, restored artifact digest, result, observed_at, operator, validity window, source digest, and post-rollback checks.

A valid rollback receipt must match the target deployment or effect plan and prove the restored state with post-rollback checks. Missing, stale, or mismatched rollback evidence must be explicit.

## Boundary

Rollback receipts are evidence. They do not grant authority, approve decisions, replace incident review, render README artifacts, or mutate repositories.

## Merge Gate

Implementation must fail when required rollback evidence is missing, stale, or does not match the target deployment.
