# Seed repo note proposal

## Why

The ops repository needs a small repo-owned note that points back to the accepted records it follows.

## Direction

Add a proposal for an ops-owned seed repo note. The note should identify ops as runtime, deployment, rollback, transfer, and receipt evidence surface, not accepted meaning authority.

## Decision

A later implementation may include a repo-owned note beside the README artifact packet. For ops, the note should say that ops emits evidence and does not decide accepted meaning.

## Boundary

This proposal is documentation only. It does not change artifact packet shape, CI, branch protection, or runtime behavior.

## Merge Gate

Merge only if ops remains evidence surface rather than accepted meaning source.
