# UI/OPS exact tree-set gate

`uiops-207-377-exact-tree-set/1` is the only final cross-PR gate for UI #207 and OPS #377.
It is evidence, not authority, and cannot replace either Issue, PR review, or User acceptance.

## Runner and contract

- runner: `verification/uiops-207-377-exact-tree-set/verify.mjs`
- contract: `verification/uiops-207-377-exact-tree-set/contract.mjs`
- repo-local owner check: `verification/uiops-207-377-exact-tree-set/contract-selftest.mjs`
- receipt: `<fresh-work-root>/uiops-207-377-exact-tree-set.receipt.json`
- delegated historical proof receipt: `<fresh-work-root>/presentation-shared-visual/presentation-shared-visual.receipt.json`

The canonical input schema is `uiops-207-377-exact-tree-set.input/1`. It requires exact UI, OPS, and mobile-agent repository identities; UI and OPS PR/base/head/tree values; check identities; UI artifact and OPS consumer-receipt digests; UI core-port and adapter contract versions; the OPS policy-app contract version; and exact blobs for both verifier files.

The input does not hard-code an unaccepted UI candidate. The final UI values must come from the accepted UI PR handoff. Any missing or mismatched field is Red.

## Invocation

```text
node verification/uiops-207-377-exact-tree-set/verify.mjs \
  --input <canonical-input.json> \
  --mobile-agent-root <clean-exact-checkout> \
  --ops-receipt <exact-consumer-receipt> \
  --ops-root <clean-exact-checkout> \
  --ui-artifact <accepted-immutable-ui-artifact> \
  --ui-root <clean-exact-checkout> \
  --work-root <nonexistent-path-outside-all-repositories>
```

The runner verifies clean checkouts, origin repository identities, exact heads and trees, base ancestry, verifier blobs, artifact bytes, receipt bytes, and the delegated presentation proof. It creates the work root exclusively and never removes it. Partial or failed evidence is retained for the caller to inspect and dispose of outside the reusable verifier.

## Green and invalidation

Green requires all exact identities and bytes to match and every delegated proof to pass. A change to any repository, PR, base/head/tree, artifact or receipt digest, check identity, contract version, verifier blob, or canonical input invalidates the prior receipt and requires a complete rerun.

Until the accepted UI handoff, OPS policy-app receipt, and all exact checks exist, this gate is not executable as a final acceptance claim and dependent closure remains blocked.
