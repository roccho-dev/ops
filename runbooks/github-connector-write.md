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
