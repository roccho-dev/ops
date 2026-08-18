# GitHub Connector write closure

1. Read `proposals` immediately before effect. Stop with `STALE_BASE` when it differs from `plan.base.commit`.
2. Execute `blobOperations` in order. Compare every returned SHA with `expectedOid`.
3. Create the tree using `base.tree` and `treeOperations`. Require returned tree SHA to equal `candidate.tree`.
4. Create the commit with exactly one parent `base.commit`, exact tree, and exact message.
5. Read the commit back and compare parent, tree, and message.
6. Create only `proposal/connector/<requestId>` without force.
7. Read the ref back and require it to point to the candidate commit.
8. Create or reuse one draft PR with exact head/base.
9. Read ref, commit, recursive tree, changed blobs, and PR again.
10. Write `ops.gitWriteEffectResult.v1`; run `verify`; PASS only when all identities match.

`PARTIAL_EFFECT` must retain every written object, branch, and PR URL. It must never be collapsed into a generic failure.

## Mandatory authoritative blob readback

`verify` requires canonical Base64 readback bytes for every changed blob and recomputes byte count, payload SHA-256, and the Git blob OID. Echoed object IDs without authoritative bytes never produce `PASS`. Candidate-tree SHA, commit parent/tree/message, ref, and draft PR are still independently read back and compared.

## Idempotent external effect

Before writing, inspect the deterministic target branch and matching head/base PRs:

- missing branch: execute normally;
- branch at the planned candidate commit: skip object/ref creation and continue with PR/readback;
- branch at the base commit: resume only after proving the planned candidate objects;
- branch at any other commit: `BRANCH_CONFLICT`;
- zero matching PRs: create one draft PR;
- one matching PR: reuse it;
- more than one matching PR: `BRANCH_CONFLICT`.

The effect result records `matchingCount`; `verify` requires exactly one. The request ID is bound to its plan in local Git metadata and a different plan never reuses the same request.
