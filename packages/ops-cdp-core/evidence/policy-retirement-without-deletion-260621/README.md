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
- coverage-first review batches: `118`
- proposed review decisions: `792`
- proposed accepted law/projection candidates: `752`
- proposed rejected non-law candidates: `40`
- proposed manual review leftovers: `0`
- proposed exhaustive obligation table rows: `2648`
- Gen2 law behavior expectation rows: `2648`
- Gen2 law behavior packets: `27`

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
| `coverage_first_review_batches.jsonl` | 118 source-path batches for reviewing the 792 accepted-law candidates |
| `coverage_first_review_batches.md` | Human-readable review batch index |
| `coverage_first_review_decision_summary.proposed.json` | Proposed accept/reject summary for the 792 review-required candidates |
| `coverage_first_review_decisions.proposed.jsonl` | One proposed decision row for each review-required candidate |
| `coverage_first_review_accepted_projection.proposed.jsonl` | Proposed accepted rows to project as law/policy/runtime |
| `coverage_first_review_rejections.proposed.jsonl` | Proposed rejected rows such as iteration logs, package metadata, README docs, and local notes |
| `coverage_first_review_manual_queue.jsonl` | Manual remainder queue; currently empty |
| `legacy_policy_exhaustive_obligation_table.proposed.jsonl` | Proposed exhaustive table: 1896 compiler obligations plus 752 accepted coverage-first additions |
| `legacy_policy_exhaustive_obligation_table.proposed.md` | Human-readable proposed exhaustive obligation table |
| `gen2_law_behavior_expectations.proposed.jsonl` | One expected law behavior row for each proposed exhaustive obligation |
| `gen2_law_behavior_packets.proposed.jsonl` | 27 Gen2 verification packets covering all 2648 expectation rows |
| `gen2_law_behavior_packet_summary.proposed.json` | Summary of packet counts, behavior classes, and approval boundary |
| `gen2_law_behavior_packet_index.proposed.md` | Human-readable packet index |
| `gen2_coverage_first_reconciliation_verification.jsonl` | Fresh Codex as Gen2 verification of the reconciliation counts and claim boundary |
| `gen2_coverage_first_review_decision_verification.jsonl` | Fresh Codex as Gen2 verification of proposed accept/reject decision evidence |
| `gen2_legacy_policy_exhaustive_obligation_table_verification.jsonl` | Fresh Codex as Gen2 verification that the proposed exhaustive table is exactly 1896 compiler rows plus 752 accepted additions |
| `gen2_law_behavior_packet_verification.jsonl` | Fresh Codex as Gen2 verification that all 2648 law rows have matching expected behavior packet coverage |

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
coverage-first gap. It is a bounded `792` row review queue, grouped into `118`
source-path review batches. Each row must be accepted or rejected through
decision JSONL, then replayed by refreshed Codex as Gen2 before claiming
exhaustive legacy-policy law replacement.

This proposal now materializes proposed decisions for that queue: `752`
accepted projection candidates, `40` rejected non-law candidates, and `0`
manual remainders. These proposed decisions are not canonical approval; they
still require refreshed Gen2 verification and ADRS decision authority before
they can be treated as accepted law.

The proposed exhaustive obligation table has `2648` rows: `1896` compiler-lane
legacy obligations plus the `752` proposed accepted coverage-first additions.
Fresh Codex as Gen2 verified that rejected rows are not included and approval
flags remain false.

Each proposed exhaustive row now has one Gen2 law behavior expectation, grouped
into `27` packets. Fresh Codex as Gen2 verified that every row has exactly one
expectation, every packet reference resolves, polarity-to-behavior mapping is
consistent, and deletion/cutover/canonical approval remain false.

Fresh Codex as Gen2 verified the proposed decision evidence integrity, while
explicitly rejecting any interpretation that it is canonical approval, deletion
approval, or cutover approval.
