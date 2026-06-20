# policy-semantic-graph-baseline

Builds a deletion-readiness baseline for `policy.git` from a fixed checkout.

The tool does not decide that `policy.git` can be retired. It emits evidence:

- source nodes for policy files;
- heuristic semantic edges with source spans;
- coverage and gap report;
- deletion-readiness gates;
- counterexamples for missing or ambiguous semantic coverage.

The output is intended for proposal review and later Gen2 challenge/review.
