# ops receipts closure feed proposal

## Why

closureView needs runtime, deployment, rollback, and transfer evidence without making ops an authority source.

## Direction

Define how ops emits receipt feeds consumed by gov-lib closure projection.

## Decision

ops receipt feeds should include receipt type, scope, snapshot reference, source digest, validity window, severity, and freshness state.

## Boundary

The feed is evidence input for projection. It does not decide closure, accept decisions, render README artifacts, or mutate repositories.

## Merge Gate

Implementation must mark stale, missing, or unknown receipts so gov-lib can fail closed for blocking closure scopes.