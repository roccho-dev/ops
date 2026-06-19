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

## Semantic Coverage Review

`review-semantic-coverage` reads ADR policy graph JSONL:

- `policy.sourceFile.v1`
- `policy.sourceSpan.v1`
- optional `policy.sourceFileDisposition.v1`
- `policy.semanticNode.v1`
- `policy.semanticEdge.v1`

It emits `semantic-coverage-review-packets.jsonl`, grouped by source path,
node kind, and edge kind, plus `semantic-coverage-summary.json`.

The summary reports `acceptedSemanticApprovalCount`, `totalSourceSpanCount`,
`reviewRequiredSourceSpanCount`, file-class non-normative span count,
mechanical orphan/integrity counts, and whether an accepted equivalence proof
exists. File dispositions with `requiresIndividualSemanticApproval:false` are
not semantic approval; they only remove source spans from the individual review
denominator. The review remains fail-closed: `cutoverReady` remains false and
the command exits nonzero until every review-required source span has accepted
semantic approval, an accepted semantic equivalence proof exists, and graph
integrity/orphan counts are zero.
