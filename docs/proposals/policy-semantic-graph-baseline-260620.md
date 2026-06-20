# Policy semantic graph deletion-readiness baseline

Status: proposal evidence

## Purpose

The degraded external mirror lane proved that bounded fallback transport can
move Gen2 work/review without raising authority. The next policy retirement
question is semantic: can the natural-language policy surface be represented,
checked, challenged, and handed off without losing meaning?

This proposal adds a reproducible baseline extractor and current result for
`policy.git` at fixed ref:

`334997669f1889a8e2658730c616d2d4510d4536`

## Output

The generated baseline is stored at:

`packages/ops-cdp-core/evidence/policy-semantic-graph-baseline-260620/`

Key files:

- `policy_source_nodes.jsonl`
- `policy_semantic_edges.jsonl`
- `policy_graph_coverage.md`
- `policy_graph_coverage.json`
- `policy_deletion_readiness_gates.json`
- `policy_consumer_refs.jsonl`
- `policy_untyped_sources.jsonl`
- `counterexamples.md`
- `manifest.json`

Gen2 review of this first baseline is recorded at:

`packages/ops-cdp-core/evidence/policy-semantic-graph-baseline-260620/gen2-impl-review/`

The review accepted the result only as a first reproducible `BLOCK` baseline and
identified the next reviewability gaps: large JSONL row review, missing
negative-control fixture outputs, untyped-file classification, consumer-ref
classification, and deterministic rerun evidence.

The reviewability-hardened follow-up output is stored at:

`packages/ops-cdp-core/evidence/policy-semantic-graph-baseline-reviewable-260620/`

Additional files:

- `REVIEW_SUMMARY.json`
- `policy_source_nodes.index.json`
- `policy_semantic_edges.index.json`
- `policy_consumer_refs.index.json`
- `policy_untyped_sources.index.json`
- `policy_source_nodes.shards.json`
- `policy_semantic_edges.shards.json`
- `policy_negative_controls.json`
- `policy_rerun_transcript.json`
- `shards/policy_source_nodes/part-*.jsonl`
- `shards/policy_semantic_edges/part-*.jsonl`

## Current result

The baseline result is `BLOCK`.

| gate | status | actual | expected |
|---|---:|---:|---:|
| all source files have semantic edges | BLOCK | 64 | 0 |
| all required edge kinds observed | PASS | 0 missing | 0 |
| low-density prose reviewed | PASS | 0 | 0 |
| active policy repo consumer refs eliminated | BLOCK | 89 | 0 |
| heuristic extraction accepted as final authority | BLOCK | heuristic | typed compiler |

## Interpretation

This is progress because it turns the deletion question into concrete graph
coverage and counterexample classes. It is not deletion approval.

The current baseline proves:

- the source inventory can be fixed to a policy ref;
- semantic edge candidates can be extracted with source spans;
- deletion blockers can be listed and handed to a reviewer.

The current baseline does not prove:

- that `policy.git` can be retired;
- that every policy meaning has been typed correctly;
- that downstream consumers no longer depend on policy repo paths;
- that the heuristic extractor is an accepted compiler.

## Next gate

The next work unit after the reviewability-hardened output is to replace the
negative-control plan with executed fixture outputs and to convert the heuristic
baseline into an accepted typed semantic graph compiler. Until then the result
remains `BLOCK`.
