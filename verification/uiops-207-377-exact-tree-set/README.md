# UI/OPS exact tree-set gate

`uiops-207-377-exact-tree-set/1` is the only final cross-PR gate for UI #207 and OPS #377. It is evidence, not authority, and cannot replace either Issue, PR review, merge permission, or User acceptance.

## Owned surface

- runner: `verification/uiops-207-377-exact-tree-set/verify.mjs`
- contract facade: `verification/uiops-207-377-exact-tree-set/contract.mjs`
- pure validators: `contract-core.mjs`, `provider-snapshot.mjs`, `gate-input.mjs`, and `typed-receipts.mjs`
- repo-local process/self-test: `verification/uiops-207-377-exact-tree-set/contract-selftest.mjs`
- final receipt: `<fresh-work-root>/uiops-207-377-exact-tree-set.receipt.json`
- delegated presentation receipt: `<fresh-work-root>/presentation-shared-visual/presentation-shared-visual.receipt.json`

The gate joins exact evidence; it does not implement UI, maxGraph, codec, artifact assembly, policy-app, or browser meaning.

## Canonical inputs

The runner requires four canonical JSON inputs plus the immutable UI archive:

```text
node verification/uiops-207-377-exact-tree-set/verify.mjs \
  --input <uiops-207-377-exact-tree-set.input/2.json> \
  --provider-snapshot <uiops.github-provider-snapshot/1.json> \
  --ui-publication-receipt <ui.policy-app-publication.receipt/1.json> \
  --ui-artifact <accepted-immutable-ui-archive> \
  --ops-consumer-receipt <ops.policy-app-consumer.receipt/1.json> \
  --mobile-agent-root <clean-exact-checkout> \
  --ops-root <clean-exact-checkout> \
  --ui-root <clean-exact-checkout> \
  --work-root <nonexistent-path-outside-all-repositories>
```

Every JSON file must use canonical UTF-8 JSON with sorted object keys and one final LF. Missing, extra, duplicate, stale, or non-canonical fields are Red.

### Provider snapshot

The provider snapshot is collected independently by D or R from GitHub. It contains:

- exact UI and OPS Issue tuples: URL, database ID, node ID, updated time, marker, state, and body digest;
- UI and OPS PR tuples: base commit/tree, terminal head/tree, evaluated commit/tree, merge state, and actual merge commit/tree when merged;
- explicit required-check sets and run/job/attempt/head/tree/conclusion evidence;
- latest W and R identities targeting the terminal head/tree;
- R conclusion `GREEN` and unresolved blocking findings `0`;
- exact mobile-agent evaluated commit/tree and checks.

The gate validates and binds the snapshot bytes. It does not turn a W-created string into provider evidence. R independently re-reads the same provider objects.

### UI publication receipt

The UI owner receipt binds:

- producer PR terminal and evaluated identities;
- exact owner-validator blob and successful required-check context;
- immutable locator;
- archive name, bytes, and SHA-256;
- manifest and host-closure digests;
- core-port and adapter contract versions.

The successful provider check must bind the exact receipt digest. The gate verifies the archive bytes and the validator blob from the evaluated UI commit.

### OPS consumer receipt

The OPS owner receipt binds:

- consumer PR terminal and evaluated identities;
- exact owner-validator blob and successful required-check context;
- the consumed UI publication receipt and archive digests;
- one exact lock row and immutable locator;
- artifact-assembly receipt, assembled output tree, and host closure;
- `packages.<system>.policy-app` and `checks.<system>.policy-app` as the same derivation;
- installed-browser receipt, no source fallback, and forbidden-path 404 proof.

The successful provider check must bind the exact receipt digest. The gate cross-checks the UI→OPS edge instead of reimplementing either owner validator.

## Candidate and merged stages

The same schema family supports two stages:

- `candidate`: evaluated commit/tree equals the terminal PR head/tree; merge identity is absent.
- `merged`: terminal PR head/tree remains recorded, while evaluated commit/tree equals the actual merge commit/tree.

A candidate receipt is invalid after merge. The merged stage requires newly collected provider/check/review evidence and a complete rerun.

## Process and mutation proof

The repo-local self-test executes the real gate process against isolated Git fixtures. It proves one positive candidate run and rejects, through the process boundary:

- copied/shadow gate runner;
- dirty checkout;
- fake PR tuple and stale check evidence;
- wrong-schema UI receipt and semantically inconsistent OPS receipt;
- UI archive byte mutation;
- missing Issue, review, or check tuples and extra provider fields;
- non-canonical input bytes.

It also validates the merged-stage representation and rejects recursive cleanup in both gate verifiers. Full production evidence still requires the accepted UI publication, completed OPS consumer, current provider snapshot, and exact real repositories.

## Green and invalidation

Green requires all exact identities, typed receipts, bytes, owner checks, required checks, R/W terminal reviews, repository checkouts, verifier blobs, and delegated proofs to match. Any Issue version, terminal/evaluated/merge identity, provider snapshot, check run, review, unresolved count, contract version, owner validator, artifact, receipt, verifier blob, repository, or canonical input change invalidates the previous receipt and requires a full rerun.

Until accepted UI publication and the OPS policy-app consumer receipt exist, production final-gate execution and Issue closure remain blocked.
