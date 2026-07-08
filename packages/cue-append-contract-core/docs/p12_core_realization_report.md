# P12 Core Realization Report

## Branch

`feature/p12-core-realization`

## Purpose

P12 responds to the P11 review: keep the Go + CUE + JSONL core direction, avoid regression, and move core responsibilities out of Python proof scripts and the fat CLI.

## Implemented

- `cmd/contractcheck/main.go` is now a thin CLI dispatcher.
- Core behavior moved to `internal/core/kernel`:
  - contract JSONL validation
  - fast row validation
  - cross-row semantic indexing
  - synthetic large ledger generation
  - generated artifact creation and verification
  - admission gate
  - canonical admission verification
  - authority check
  - receipt check
  - graph check
  - source policy check
  - lineage / impact / closure projection
  - partition / snapshot proof
- `scripts/test_p1...p10...sh` now call `./bin/contractcheck` for core behavior instead of `tools/contract_kernel.py`.
- Generated manifest now declares `go/internal/core/kernel` as generator.
- Adapter directories now contain minimal Go implementation files:
  - `internal/adapters/typescript/adapter.go`
  - `internal/adapters/jsonschema/adapter.go`
  - `internal/adapters/duckdb/adapter.go`
- Architecture tests were added for:
  - thin CLI
  - Go core ownership of former proof-kernel responsibilities
  - adapter implementation presence
  - phase scripts not using Python proof kernel for core checks
  - generated manifest not claiming Python as generator

## Non-degradation checks

Executed:

```text
go test ./...
scripts/run_baseline_tdd.sh
scripts/test_p1_generated_integrity.sh
scripts/test_p2_jsonschema_validator_generation.sh
scripts/test_p3_ts_accessor_static_failure.sh
scripts/test_p4_admission_gate.sh
scripts/test_p5_authority_boundary.sh
scripts/test_p6_receipt_ledger.sh
scripts/test_p7_graph_checker.sh
scripts/test_p8_source_policy.sh
scripts/test_p9_lineage_impact_closure.sh
scripts/test_p10_partition_snapshot_scale.sh
```

All passed in the P12 worktree.

## What is now improved

| Area | Before P12 | After P12 |
|---|---|---|
| CLI size | `cmd/contractcheck/main.go` owned validation/generation details | CLI delegates to `internal/core/kernel` |
| Python proof kernel | P1-P10 core proof commands used Python | P1-P10 core proof commands use Go CLI |
| Generated manifest | `proof/python/contract_kernel.py` | `go/internal/core/kernel` |
| Adapter directories | README-only | minimal Go adapter implementations exist |
| Generated scope | already split in P11 | preserved |
| DuckDB / Python / AJV in Go core | absent | still absent |

## Remaining issues, intentionally not hidden

| Remaining issue | Status | Next action |
|---|---|---|
| `internal/core/kernel` is broad | improved but not ideal | split into `validate`, `artifacts`, `admission`, `authority`, `receipt`, `graph`, `lineage`, `partition` packages |
| JSON Schema validation in Go is a fast/generated parity check, not a full JSON Schema engine | known limitation | either keep Python/jsonschema as adapter or add Go JSON Schema adapter if truly needed |
| Adapter implementations are still thin | partial | wire them through `ports` in an integration test |
| `ports` are still mostly interface declarations | partial | add constructor wiring and dependency-inversion tests |
| Python proof kernel still exists | intentional historical/proof helper | keep outside runtime/core; do not let phase scripts depend on it for core checks |
| Some shell tests still use short Python snippets for assertions | acceptable proof helper | replace with Go assertion helpers only if CI portability requires it |
| P10 partitioning still performs full fast validation in proof | acceptable proof | add incremental validation proof later |
| Source trust / semantic drift / truth / legal / business value are not solved by P12 | out of core structural scope | handle in separate policy/evidence phases |

## Merge recommendation

P12 is mergeable as a responsibility-migration PR. It is not a claim of final product-core perfection. The correct next work is package split and port wiring, not new features.
