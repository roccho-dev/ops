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


`--accepted-source <json|jsonl>` is separate from `--fixture-accepted`. It only writes `POLICY_ENTRY_ACCEPTED=true` when the accepted-source record is `policy.projectedPolicyEntryAcceptedSource.v1`, has `accepted:true`, includes accepted structured refs for owner approval, semantic equivalence proof, consumer-zero proof, source authority, and its `policyEntryLock` exactly matches the generated policy/rules tree lock. The accepted source cannot approve policy deletion and generated output still is not authority.

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
denominator. Candidate dispositions are not accepted authority. The review
remains fail-closed: `cutoverReady` remains false and the command exits nonzero
until every review-required source span has accepted semantic approval,
dispositions are accepted authority, an accepted semantic equivalence proof
exists, and graph integrity/orphan counts are zero.

## ADRS Projection DuckDB Review

`review-adrs-projection-duckdb` consumes ADRS projection records directly from a
records directory and runs DuckDB-backed fail-closed gates. It expects:

- `policy.sourceFile.v1`
- `policy.sourceSpan.v1`
- `policy.semanticNode.v1`
- `policy.semanticEdge.v1`
- `policy.sourceSpanDisposition.v1`
- `policy.acceptedCoverageProof.v1`
- `policy.freshGenXReconstructionReview.v1`
- optional `policy.sourceFileDisposition.v1`

The command requires `--policy-rev` and rejects stale source traces, orphan
span/node/edge references, missing accepted coverage, candidate-only
file or span dispositions, contradictory dispositions, source spans without
accepted span disposition, and any generated/projection row that claims
authority. The accepted coverage proof must be `accepted:true`,
`status:"accepted"`, match the target policy revision, set
`generatedIsAuthority:false`, keep `policyDeletionApproved:false`, set
`fixtureOnly:false`, and reference accepted Fresh GenX reconstruction evidence
where `memoryUsed:false`, `policyBodyUsedAsSource:false`, and
`noRemainingObjections:true`.

When blocked, the command also emits detail JSONL files that can be used as the
next ADRS review queue input:

- `missing-accepted-span-dispositions.jsonl`
- `missing-accepted-coverage.jsonl`
- `candidate-only-span-dispositions.jsonl`
- `candidate-only-file-dispositions.jsonl`

`materialize-source-span-review-batches` reads
`missing-accepted-span-dispositions.jsonl` and emits
`source-span-disposition-review-batches.jsonl`. These batch rows are review
queue artifacts only; they set `accepted:false`, `claimAllowed:false`,
`generatedIsAuthority:false`, and point to the next provider record
`policy.sourceSpanDisposition.v1`.

`assign-source-span-review-batches` reads those batch rows and emits one
assignment per reviewer plus a direct cross-discussion requirement per batch.
The output still does not approve any disposition; it only records the
reviewer work that must happen before ADRS can append accepted
`policy.sourceSpanDisposition.v1` rows.

`check-source-span-review-completion` verifies that each assignment has an
accepted `policy.sourceSpanDispositionReviewResult.v1` and each batch has an
accepted same-revision `policy.sourceSpanDispositionDirectCrossDiscussion.v1`
with peer replies read and no remaining objections. Missing review results or
discussion results keep the gate blocked.

This checker can support the claim `facilitation policy semantic reconstruction
is proven for this policy ref` only after the ADRS provider emits accepted
coverage proof records and fresh GenX semantic reconstruction/review has no
remaining objections. It still cannot approve `policy.git` deletion; deletion
requires separate active-consumer-zero, policy-absent consumer pass, accepted
projected entry source, and owner deletion approval evidence.

## Typed JSON Extractor

`extract-typed-json` is a candidate-only `typed-json-v1` extractor for structured policy files such as schemas, routers, role profiles, protocol envelopes, and kernel indexes. It emits ADR-compatible candidate records with object-pointer `sourceTrace.jsonPointer` values plus fail-closed gates.

Allowed candidate claim: `typed-json-semantic-graph-candidate-ready-for-review`.

It must not claim semantic approval, cutover readiness, active `policy.git` dependency zero, fresh semantic equivalence, owner deletion approval, or that `policy.git` may be deleted. The extractor keeps `cutoverReady=false` and `policyDeletionApproved=false`; approval and equivalence remain separate gates.


## Policy Deletion Readiness Review

`review-deletion-readiness` scans selected repo roots for direct `policy.git` and `/home/nixos/repos/policy` runtime dependency candidates, then runs a missing-policy-root simulation. This is a deletion blocker review, not deletion approval.

It emits `consumer-references.jsonl`, `deletion-readiness-gates.jsonl`, `absent-simulation.json`, and `manifest.json`. The review keeps `cutoverReady=false` and `policyDeletionApproved=false`; direct active references or failed absent simulation keep deletion readiness blocked.
