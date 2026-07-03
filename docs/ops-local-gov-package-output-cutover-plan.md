# ops local gov-package-output cutover plan

This issue is intentionally blocked until governance final gate cutover is complete.

## Current dependency state

- ops #27 evidence is merged.
- ops #28 evidence is merged.
- governance final gate cutover is still the remaining blocker.

## Preconditions

- governance `gov-final-scope-purpose-join / gate` exists and has same-name green evidence.
- old local checks are classified as `receipt-producer`, `artifact-producer`, `tool-selftest`, or `final-join-internal-step`.
- rollback is documented before any local required-check change.

## Proposed local surface

- local `ops-gov-package-output` remains an evidence producer until governance cutover.
- no standalone green check may claim final governance compliance.
- branch protection or CI intent changes must be paired with rollback.

## Old check classification

| current surface | final role |
|---|---|
| `nix-check` | receipt producer |
| `gov package validation` | packet validator / final-join input |
| `README artifact exporter` | artifact producer |
| package e2e checks | package-internal evidence producer |

## Rollback

- keep existing `nix-check` and `gov package validation` until final gate is green.
- revert only local ruleset or intent changes if cutover fails.
- do not remove evidence producers as part of rollback.

## Boundary

This PR must remain blocked until governance final gate cutover is complete. It does not claim `organization-active`, does not change branch protection, and does not remove old checks.
