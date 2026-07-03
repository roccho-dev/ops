# ops local gov-package-output cutover plan

This plan is intentionally blocked until governance final gate cutover is complete.

It is not final compliance evidence. It is an ops-local cutover plan that keeps ops as an evidence owner and waits for governance to provide the final gate authority.

## Current dependency state

- ops #30 is completed by ops #25 for selected ops package closure evidence.
- ops #31 evidence is merged.
- ops #32 evidence is merged.
- ops #29 remains open until post-governance-cutover local alignment is possible.
- governance #125 is still the root parent.
- governance final gate cutover is still the remaining blocker.

## Preconditions

- governance `gov-final-scope-purpose-join / gate` exists and has stable same-name green evidence.
- ops local output is aligned to that final evidence path.
- old local checks are classified as `receipt-producer`, `artifact-producer`, `packet-validator`, `tool-selftest`, or `final-join-internal-step`.
- local recovery is documented before any required-check or CI-intent change.
- the exact PR head has green CI.

## Proposed local surface

- local `ops-gov-package-output` remains an evidence producer until governance cutover.
- no standalone local green check may claim final governance compliance.
- any local CI-intent change must be paired with recovery instructions.

## Old check classification

| current surface | final role | authority boundary |
|---|---|---|
| `nix-check` | receipt producer | local health only |
| `gov package validation` | packet validator / final-join input | not final compliance alone |
| `README artifact exporter` | artifact producer | artifact only |
| package e2e checks | package-internal evidence producer | package-local only |
| selected package closure gate | selected ops evidence producer | consumed by governance final gate |

## Unblock rule

This PR can leave draft only after governance final gate cutover is complete and the final evidence name/path is stable.

## Recovery

- keep existing `nix-check` and `gov package validation` until final gate is green.
- revert only local CI-intent changes if cutover fails.
- keep evidence producers available during recovery.

## Boundary

This PR must remain blocked until governance final gate cutover is complete. It does not claim `organization-active`, does not make ops a meaning authority, and does not claim governance #125 closure.

## Purpose path

scope: ops local gov-package-output cutover after governance final gate -> direct purpose: align downstream ops evidence with the final gate -> upper purpose: prevent ops-local green from becoming false final compliance -> meta: preserve auditability and authority separation -> highest purpose: support buyer-auditable, transferable operating evidence for a high-value company sale.
