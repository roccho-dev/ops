# Transfer receipt contract proposal

## Why

Corporate transfer readiness needs evidence that a buyer-like environment can build, restore, rotate access, and operate the system.

## Direction

Define transfer receipts for clean-room build, restore, access handoff, credential rotation, and operational handover checks.

## Decision

Transfer receipts should include scope, snapshot, environment, steps executed, artifacts restored, access transferred, secrets rotated, result, observed_at, and operator.

## Boundary

Transfer receipts are evidence for closure and DD views. They do not change authority or approve business transfer.

## Merge Gate

Implementation must fail when required transfer steps are missing, stale, or cannot be tied to the selected scope and snapshot.