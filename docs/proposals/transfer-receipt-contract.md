# Transfer receipt contract proposal

## Why

Corporate transfer readiness needs evidence that a buyer-like environment can build, restore, rotate access, and operate the system.

## Scope purpose

Make transfer readiness observable as evidence, without letting ops approve authority, business transfer, or repository meaning.

This contributes to the purpose chain by turning transfer from a person-dependent claim into a scoped, replayable, and freshness-checked receipt.

## Direction

Define transfer receipts for clean-room build, restore, access handoff, credential rotation, operator independence, and operational handover checks.

## Decision

Transfer receipts should include scope, snapshot, clean-room or buyer-like environment proof, operator independence, environment, steps executed, artifacts restored, access transferred, secrets rotated, result, observed_at, validity window, and operator.

A valid transfer receipt must bind every required step to the selected scope and snapshot. It must show that the run was performed from a buyer-like or clean-room environment, not only from the original owner's normal workstation or privileged session.

## Boundary

Transfer receipts are evidence for closure and DD views. They do not change authority, accept decisions, mutate repositories, or approve business transfer.

## Merge Gate

Implementation must fail when required transfer steps are missing, stale, cannot be tied to the selected scope and snapshot, lack clean-room or buyer-like environment proof, or cannot show operator independence.
