# Issue 355 merge contract

Parent: `roccho-dev/ops#355`
Consumer parent: `roccho-dev/edits#118`

This branch is mergeable only when the exact tested head proves:

```text
exact accepted package/release inputs
+ package-owned finite operation declarations
→ strict deterministic operation-catalog.jsonl
+ manifest.json
+ exact Nix output
```

Required conditions:

- all producer Canon-TDD assertions Green without changing the RED specification;
- all pre-existing package-response checks Green;
- malformed, duplicate, orphan, missing-reference, unknown-kind, and digest-drift fixtures fail closed;
- compile, validate, and read cause zero runtime effect;
- two clean-checkout Nix builds produce the same store path and bytes;
- exact source, input, catalog, and manifest digests are retained;
- no mutable `latest`, runtime repository HEAD read, shell command, workflow graph, worker, retry, cancel, result authority, or editor behavior is introduced;
- skips, xfail, waivers, deleted tests, and weakened assertions are zero;
- the exact output is consumed unchanged by the `edits#118` WT-04 strict shadow adapter.

A PR or CI status without `evidence/issue-355/exact-nix-green.json` from the same head is not sufficient for merge.
