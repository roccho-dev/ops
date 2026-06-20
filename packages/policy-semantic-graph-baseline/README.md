# policy-semantic-graph-baseline

Builds a deletion-readiness baseline for `policy.git` from a fixed checkout.

The tool does not decide that `policy.git` can be retired. It emits evidence:

- source nodes for policy files;
- heuristic semantic edges with source spans;
- coverage and gap report;
- deletion-readiness gates;
- counterexamples for missing or ambiguous semantic coverage.

The output is intended for proposal review and later Gen2 challenge/review.

Reviewability outputs:

- sharded `policy_source_nodes` and `policy_semantic_edges` JSONL;
- compact source/edge/consumer/untyped indexes;
- `REVIEW_SUMMARY.json` with gate, metric, shard, and must-not-claim pointers;
- a deterministic rerun transcript;
- a negative-control plan for the semantic loss cases that must block before
  `policy.git` deletion can be claimed.

The generator remains a heuristic baseline. A `BLOCK` result is useful evidence;
it is not deletion readiness, semantic approval, cutover approval, or SSOT write.
