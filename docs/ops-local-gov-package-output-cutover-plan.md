# ops local gov-package-output cutover plan

This plan is intentionally blocked until governance #115 accepts active SSOT publish gate evidence.

Governance #133 has merged the provider-neutral merge/write boundary proof implementation. That is necessary evidence, but it is not enough to unblock ops local cutover by itself. Ops waits for governance #115 to accept the active bare repo SSOT + checked mirror publish gate evidence and publish the final gate evidence path plus receipt format for downstream repos.

It is not final compliance evidence. It is an ops-local cutover plan that keeps ops as an evidence owner and waits for governance to provide both the final gate authority and the active SSOT publish gate evidence.

## Current dependency state

- ops #30 is completed by ops #25 for selected ops package closure evidence.
- ops #31 evidence is merged.
- ops #32 evidence is merged.
- ops #29 remains open until post-governance-cutover local alignment is possible.
- governance #133 is merged and supplies proof implementation.
- governance #115 selected provider path is bare repo SSOT + checked mirror publish gate.
- governance #115 is still the upstream active enforcement blocker.
- governance #125 is still the root parent.

## Upstream #115 evidence required

- governance #133 proof implementation remains merged.
- final gate name: `gov-final-scope-purpose-join / gate`.
- same-name green evidence for the exact target SHA.
- active bare repo SSOT + checked mirror publish gate evidence is accepted.
- reject proof: publish/update without final gate pass is refused.
- reject proof: stale target SHA is refused.
- reject proof: digest or SHA mismatch is refused.
- accept proof: exact target SHA is allowed only after final gate pass.
- audit receipt records target SHA, selected ref, gate identity, decision, timestamp, actor/path, and digest.
- rollback receipt or recovery instructions are recorded.
- old-CI demotion evidence classifies old checks as producer, artifact, selftest, validator, or internal-step surfaces only.

## Preconditions for ops local cutover

- governance #115 is complete.
- SSOT publish gate acceptance packet and receipt format are stable.
- ops local output is aligned to the accepted final evidence path.
- old local checks are classified as `receipt-producer`, `artifact-producer`, `packet-validator`, `tool-selftest`, or `final-join-internal-step`.
- local recovery is documented before any required-check or CI-intent change.
- the exact PR head has green CI.
- ops remains non-authority.

## Proposed local surface

- local `ops-gov-package-output` remains an evidence producer until governance #115 completes.
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

This PR can leave draft only after governance #115 accepts active SSOT publish gate evidence and the final evidence path plus write-boundary receipt format are stable.

## Recovery

- keep existing `nix-check` and `gov package validation` until final gate is active at the SSOT publish boundary.
- revert only local CI-intent changes if cutover fails.
- keep evidence producers available during recovery.

## Boundary

This PR must remain blocked until governance #115 is complete. It does not claim `organization-active`, does not make ops a meaning authority, and does not claim governance #125 closure.

## Purpose path

scope: ops local gov-package-output cutover after active SSOT publish gate evidence -> direct purpose: align downstream ops evidence with the enforced final gate -> upper purpose: prevent ops-local green from becoming false final compliance -> meta: prevent false-green, manual write bypass, and authority drift -> highest purpose: support buyer-auditable, transferable operating evidence for a high-value company sale.
