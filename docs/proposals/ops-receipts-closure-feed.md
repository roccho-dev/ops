# ops receipts closure feed proposal

## Why

closureView needs runtime, deployment, rollback, and transfer evidence without making ops an authority source.

## Scope purpose

Make ops evidence consumable by gov-lib closure projection, without letting ops decide closure, accept ADRs, render artifacts, or mutate repositories.

This contributes to the purpose chain by separating effect evidence production from closure judgment, so DD and transfer views can be checked and replayed.

## Direction

Define how ops emits receipt feeds consumed by gov-lib closure projection.

## Decision

ops receipt feeds should include receipt type, scope, snapshot reference, source digest, validity window, severity, freshness state, producer version, and non-authority marker.

A valid feed must preserve missing, stale, unknown, and blocking states as data so gov-lib can fail closed for blocking closure scopes.

## Boundary

The feed is evidence input for projection. It does not decide closure, accept decisions, render README artifacts, mutate repositories, or replace accepted ADR records.

## Merge Gate

Implementation must mark stale, missing, or unknown receipts so gov-lib can fail closed for blocking closure scopes.
