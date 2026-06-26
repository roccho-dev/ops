# Rollback receipt contract proposal

## Why

High-value transfer and safe operations require evidence that important runtime changes can be reversed.

## Direction

Define rollback receipts for deployed artifacts and effectful operations.

## Decision

Rollback receipts should include deployment or effect plan id, previous artifact digest, restored artifact digest, result, observed_at, operator, and post-rollback checks.

## Boundary

Rollback receipts are evidence. They do not grant authority, approve decisions, or replace incident review.

## Merge Gate

Implementation must fail when required rollback evidence is missing, stale, or does not match the target deployment.