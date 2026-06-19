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

## Projected Policy Entry

`project-policy-entry` materializes the bootstrap projected-mode directory:

- `policy-entry.accepted.env`
- `policy.md`
- `rules/*.md`
- `manifest.json`

Real compiler output is fail-closed and writes `POLICY_ENTRY_ACCEPTED=false`.
That output is a blocked candidate artifact only. It exists so bootstrap can
reject it explicitly instead of silently falling back or treating generation as
authority.

`--fixture-accepted --fixture-reason ...` is reserved for bootstrap projected
mode contract tests. It writes `POLICY_ENTRY_ACCEPTED=true`,
`POLICY_ENTRY_FIXTURE_ONLY=true`, and a content lock so the bootstrap proposal
can prove the consumer path works without claiming a real accepted projection
exists.
