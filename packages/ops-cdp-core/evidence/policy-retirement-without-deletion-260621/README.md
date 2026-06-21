# policy.git Retirement Without Deletion Proof

Status: proposal evidence.

This evidence pack proves the compiler-lane repo-executable parts of
policy.git retirement except actual deletion approval. It does not yet prove
exhaustive coverage-first replacement for every semantic candidate.

## Result

- legacy policy obligation rows: `1896`
- projected policy rules: `1896`
- projected rules cover legacy obligations: `true`
- per-obligation projection checks: `1896`
- per-obligation projection failures: `0`
- active runtime policy.git references in projected consumer root: `0`
- absent-policy consumer proof: `PASS`
- explicit projected-consumer proof: `PASS`
- deletion approval gate: `BLOCKED`
- refreshed Codex as Gen2 verification: `PASS`
- coverage-first candidate reconciliation: `CLASSIFIED_REVIEW_REQUIRED`
- coverage-first unclassified candidates: `0`
- coverage-first review-required candidates: `792`

## Key files

| File | Purpose |
|---|---|
| `legacy_policy_obligation_table.jsonl` | Full machine-readable table of legacy policy obligations extracted from policy.git |
| `legacy_policy_obligation_table.md` | Human-readable table for audit review |
| `legacy_policy_obligation_projection_verification.jsonl` | One PASS row for each legacy obligation confirming the projected rule exists |
| `projected_policy_entry_manifest.json` | Accepted-source projected policy/law/runtime entry manifest |
| `accepted_projected_policy_entry_source.json` | Accepted-source record used to authorize the projection, without deletion approval |
| `deletion_readiness_gates.jsonl` | Gate results showing non-deletion gates pass and deletion approval remains blocked |
| `without_deletion_proof_summary.json` | Compact summary for downstream ADRS packaging |
| `gen2_refreshed_codex_verification.jsonl` | Fresh Gen2 verification result for the legacy obligation table, projection, and gates |
| `coverage_first_reconciliation_gap.json` | Gap record showing compiler-lane completion is not full coverage-first exhaustiveness |
| `coverage_first_candidate_reconciliation.jsonl` | One reconciliation row for each coverage-first semantic candidate |
| `coverage_first_candidate_reconciliation_summary.json` | Summary of compiler matches, non-authority classifications, and review-required candidates |
| `coverage_first_candidate_review_queue.jsonl` | Coverage-first candidates that still require accepted/rejected law review |
| `legacy_policy_unified_obligation_table.jsonl` | Combined compiler-projected plus review-required candidate law table |
| `legacy_policy_unified_obligation_table.md` | Human-readable combined table for audit review |
| `gen2_coverage_first_reconciliation_verification.jsonl` | Fresh Codex as Gen2 verification of the reconciliation counts and claim boundary |

## Boundary

This pack does not approve:

- policy.git deletion
- policy.git retirement
- cutover
- canonical write
- SSOT adoption
- merge

It proves that the compiler lane can be replayed from repo evidence:

1. compile the fixed policy input into semantic/native rows,
2. project those rows into policy entry artifacts,
3. accept the projection source without making generated output authority,
4. verify no active runtime policy.git references in the projected consumer root,
5. verify projected consumers pass with policy.git absent,
6. keep deletion approval blocked.

## Remaining Non-Deletion Gap

coverage-first has `3782` semantic candidates. This pack now classifies all
`3782` candidates:

- `682` are covered by the compiler lane (`669` signal-id matches plus `13`
  text-hash-only matches),
- `2308` are classified as non-authority, historical, generated, fixture,
  board, proposal, report, or metadata sources,
- `792` remain accepted-law candidates requiring explicit review and adoption
  before they can be treated as projected law.

Therefore the remaining non-deletion work is no longer an unbounded
coverage-first gap. It is a bounded `792` row review queue that must be
accepted or rejected through decision JSONL, then replayed by refreshed Codex as
Gen2 before claiming exhaustive legacy-policy law replacement.
