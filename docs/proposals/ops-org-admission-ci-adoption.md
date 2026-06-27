# Ops organization admission CI adoption proposal

## Why

The claim system becomes useful only when repo CI fails on missing or stale evidence.

## Decision

Add an ops-local check after the governance port fixture is merged.

The check should:

1. emit downstream claim port rows from `spec/implements.json`
2. emit receipt port rows from check/build evidence
3. consume an ADRS-derived upstream grant fixture or pinned projection
4. run governance admission join
5. fail when admission is not `organization-active`

## Required failures

- no downstream claim
- no matching upstream grant
- no receipt
- stale claim digest
- stale source closure
- blocking lifecycle

## Boundary

Ops emits claims and receipts only.
Governance performs admission.
ADRS remains authority.
