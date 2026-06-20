# Coverage-first hardened hybrid audit

- route: `COVERAGE_FIRST_HARDENED_HYBRID`
- policyRef: `334997669f1889a8e2658730c616d2d4510d4536`
- decision: `BLOCK`
- source files: 500
- blocks: 57164
- table blocks: 845
- normative signals: 3782
- semantic candidates: 3782
- accepted semantic records: 0
- authority-relevant unresolved rows: 2308
- regression fixtures: 14

## Conclusion

This run makes the route reviewable, but it does not approve policy.git retirement.
The corpus-level decision remains BLOCK because accepted compiler authority, consumer cutover, and retirement/adoption gates are not proven here.

## Non-compressed repo conclusion

- `policy.git` remains the input corpus for this proof run only.
- `ops` owns the executable extractor/reducer proposal.
- `adrs` should receive evidence and decision records, not executable semantics.
- Proposal validators are preserved as regression fixtures; they cannot override reducer BLOCK.
- Generated JSONL/matrices are review products, not independent authority.

## Review x2 checklist

1. Verify source hashes and spans in `source_files.jsonl`, `md_blocks.jsonl`, and `semantic_candidates.jsonl`.
2. Verify table rows are first-class rows in `md_blocks.jsonl`.
3. Verify high-risk modal text in non-authority contexts is present in `unresolved_rows.jsonl`.
4. Verify `gate_matrix.json` keeps retirement/cutover/canonical/SSOT gates BLOCK.
5. Verify `regression_fixtures.jsonl` imports validator cases without making them authority.
6. Verify no artifact grants owner/deletion/retirement/cutover/canonical/SSOT approval.
