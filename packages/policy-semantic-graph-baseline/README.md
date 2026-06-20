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

Negative controls:

```sh
python packages/policy-semantic-graph-baseline/bin/policy-semantic-graph-negative-controls.py \
  --generator packages/policy-semantic-graph-baseline/bin/policy-semantic-graph-baseline.py \
  --policy-ref 334997669f1889a8e2658730c616d2d4510d4536 \
  --out-dir packages/ops-cdp-core/evidence/policy-semantic-graph-baseline-reviewable-260620
```

This emits:

- `policy_negative_control_results.json`
- `policy_independent_rerun_receipt.json`
- `policy_negative_control_traceability.json`
- `policy_verifier_manifest.json`

The controls use synthetic fixtures. They prove the current measurement harness
can detect selected loss/tamper classes; they do not prove policy deletion
readiness.

The current control set also includes gap-detection controls for heuristic
false positives and false negatives. A PASS on those controls can mean "the gap
is explicitly detected and preserved", not that the gap is fixed.

`policy_negative_control_traceability.json` maps planned control classes to the
executed controls. Partial controls are explicit and remain future work.

`policy_verifier_manifest.json` pins the verifier and baseline generator hashes
for external review mirrors. It improves reviewability only; it is not Project
Source proof or canonical SSOT proof.

Coverage-first hardened hybrid route:

```sh
python packages/policy-semantic-graph-baseline/bin/policy-coverage-first-hardened-hybrid.py \
  --policy-root /home/nixos/work/policy-semantic-baseline-input-3349976 \
  --policy-ref 334997669f1889a8e2658730c616d2d4510d4536 \
  --regression-fixture packages/ops-cdp-core/evidence/policy-owner-adoption-validator-260621/owner_adoption_validator_cases.jsonl \
  --out-dir packages/ops-cdp-core/evidence/policy-coverage-first-hardened-hybrid-260621
```

This route is the anti-consensus result of the upper-route debate. It emits
non-compressed review artifacts (`README.audit.md`, `authority_matrix.md`,
`gate_matrix.json`, `coverage_report.json`, JSONL ledgers, and `manifest.json`).
It keeps the corpus-level decision fail-closed: validator PASS can become a
regression fixture, but it cannot set retirement/cutover/canonical/SSOT gates
to PASS and cannot reduce authority-relevant unresolved rows.

The result is proposal evidence only. It is not owner approval, deletion
approval, retirement approval, cutover approval, canonical write, SSOT adoption,
or semantic completion.
