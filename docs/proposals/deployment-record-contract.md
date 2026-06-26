# Deployment record contract proposal

## Why

CI artifacts and actual deployed runtime artifacts can drift. ops needs a record that connects release intent to deployed state.

## Direction

Define deployment records that bind repository commits, build artifacts, environment, deployment target, and observed runtime digest.

## Decision

Deployment records should include deployment id, repo commit, artifact digest, target environment, deployed digest, actor, observed_at, and rollback reference.

## Boundary

Deployment records describe effectful placement. They do not decide business meaning, package contracts, or artifact authority.

## Merge Gate

Implementation must detect deployed digest drift and missing rollback reference for blocking environments.