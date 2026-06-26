# Deployment record contract proposal

## Why

CI artifacts and actual deployed runtime artifacts can drift. ops needs a record that connects release intent to deployed state.

## Scope purpose

Make deployed state traceable from release intent to observed runtime evidence, without letting ops decide product meaning, package contracts, or authority.

This contributes to the purpose chain by making deployment drift visible before closure, DD, or transfer claims depend on it.

## Direction

Define deployment records that bind repository commits, build artifacts, environment, deployment target, and observed runtime digest.

## Decision

Deployment records should include scope, snapshot reference, deployment id, repo commit, artifact digest, target environment, deployment target, deployed digest, actor, observed_at, validity window, and rollback reference.

A valid deployment record must prove that the selected artifact was placed in the selected target and that the observed deployed digest matches the intended artifact or reports drift explicitly.

## Boundary

Deployment records describe effectful placement. They do not decide business meaning, package contracts, artifact authority, or transfer approval.

## Merge Gate

Implementation must detect deployed digest drift and missing rollback reference for blocking environments.
