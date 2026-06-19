# Policy Semantic Compiler

Status: candidate harness only.

This package inventories markdown files in the current local policy repository,
emits graph JSONL skeleton records, and runs DuckDB-backed gates over the
generated candidate graph. It does not prove semantic equivalence, approve
cutover, approve deletion, or prove active `policy.git` dependency 0.

The default source is `/home/nixos/repos/policy`. The source must exist; the
package does not fall back to an embedded corpus.

A successful `compile` command means `candidateArtifactValid`, not
`cutoverReady`. `duckdb-gates.jsonl` includes an explicit
`semantic-cutover-blocked` row until edge coverage, counterexamples,
fresh-agent equivalence, and active `policy.git` dependency 0 are proven.

Allowed candidate claim: `semantic-authority-closure-ready-for-review`.

Forbidden claims:

- `cutover-ready`
- `policy.git may be deleted`
- `policy logic deleted`
- `semantic approval granted`
