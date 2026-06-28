# Strict real claim admission closure

## Why

`ops-real-claim-admission` can warn on drift today, but strict closure must not turn green by guessing the universe or inventing upstream grants.

## Decision

Add a strict closure wrapper for real claim admission.

The wrapper requires an explicit selected universe in strict mode, filters both ops claims and upstream grants to that selected set, then runs the existing real-claim admission checker in strict mode.

## Implemented

- Added `tools/check-ops-real-claim-admission-strict-closure.mjs`.
- Added `tools/check-ops-real-claim-admission-selected-universe-fixture.mjs`.
- Added `ops-real-claim-closure-fixture` to generated checks.

## Target condition

The strict closure path passes only when every selected admission row is `organization-active`.

## Boundary

This PR does not add real upstream grants, does not make ops authority for ADRS selection, and does not hide drift by using a silent default universe. Missing selected universe is a strict failure.

## Merge gate

Merge when CI proves the selected-universe fixture and the existing staged warning check still pass. Enabling strict mode for real ops inputs still requires ADRS selected universe and ADRS-derived upstream grants.
