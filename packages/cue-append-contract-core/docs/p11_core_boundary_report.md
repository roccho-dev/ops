# P11 core boundary refactor report

Branch: `feature/p11-go-cue-jsonl-core-boundary`

## Result

P11 reflects the final stack decision:

- Core is Go + CUE + JSONL.
- `contracts/meta.cue` remains the small meta-contract.
- Python kernel moved to `proof/python/contract_kernel.py`.
- `tools/contract_kernel.py` is now only a compatibility wrapper.
- TypeScript static checking is an adapter surface under `internal/adapters/typescript`.
- JSON Schema export is an adapter surface under `internal/adapters/jsonschema`.
- DuckDB is documented as projection/read/scale adapter only, not core.
- Generated artifacts are split into `generated/core`, `generated/projections`, and `generated/cache`.

## Tests run

- `bash scripts/run_baseline_tdd.sh`
- `go test ./...`
- `bash scripts/test_p1_generated_integrity.sh`
- `bash scripts/test_p2_jsonschema_validator_generation.sh`
- `bash scripts/test_p3_ts_accessor_static_failure.sh`
- `bash scripts/test_p4_admission_gate.sh`
- `bash scripts/test_p5_authority_boundary.sh`
- `bash scripts/test_p6_receipt_ledger.sh`
- `bash scripts/test_p7_graph_checker.sh`
- `bash scripts/test_p8_source_policy.sh`
- `bash scripts/test_p9_lineage_impact_closure.sh`
- `bash scripts/test_p10_partition_snapshot_scale.sh`

Receipt: `proof/p11/receipt.json`.

## Non-goals

P11 does not add new modeling capability.  It is a boundary refactor and proof
isolation change designed to prevent Go/Python/DuckDB/AJV responsibility drift.
