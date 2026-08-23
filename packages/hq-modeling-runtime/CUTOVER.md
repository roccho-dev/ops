# Go cutover decision

## Decision

`hq-modeling-runtime` uses Go as its canonical implementation. The supported public boundary is serialized JSON/JSONL bytes.

The switch is justified by the accepted completion rule:

> exact carry, SHA-256 verification, fresh native execution, and no existing consumer dependency are sufficient for cutover.

## Evidence

- the Node implementation and existing MJS tests were used as the semantic oracle before cutover;
- all required serialized meanings were moved to Go tests;
- Node/Go parity passed for queue, promotion, positive, negative, output-lane, malformed-input, and determinism corpora;
- the static CGO-free binary was carried, read back, and executed with an empty `PATH`;
- no production consumer existed at the time of cutover;
- the canonical package registry and Nix package now point to Go.

## Retired surface

The following former Node-only surfaces are not part of the canonical runtime because they had no consumer:

- arbitrary in-process JavaScript object semantics;
- CUE append command execution;
- local-root catalog/status and local HTTP serving;
- CI receipt and GitHub readback adapters;
- staged-to-canonical promotion adapter.

These are explicit retirements, not silent implementation omissions. A future need creates a new capability with its own owner and tests.
