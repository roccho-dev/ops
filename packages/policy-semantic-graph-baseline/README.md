
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
`gate_matrix.json`, `gate_matrix.md`, `unresolved_matrix.md`,
`source_to_rule_drilldown.md`, JSONL ledgers, and `manifest.json`). It keeps the
corpus-level decision fail-closed: validator PASS can become a regression
fixture, but it cannot set retirement/cutover/canonical/SSOT gates to PASS and
cannot reduce authority-relevant unresolved rows.

The result is proposal evidence only. It is not owner approval, deletion
approval, retirement approval, cutover approval, canonical write, SSOT adoption,
or semantic completion.
