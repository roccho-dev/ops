# P13: core package split and adapter wiring

## Status

`feature/p13-core-package-split` is a local sandbox branch based on `feature/p12-core-realization`.
It is not merged to `main`.

## Purpose

P13 is a responsibility-separation PR. It does not add a new contract feature.
It moves the P12 broad kernel implementation into domain packages while preserving P0-P10 behavior.

## TDD order

1. Added P13 architecture tests first.
2. Verified they failed against P12 shape:
   - missing split packages,
   - `internal/core/kernel` still owning implementation,
   - CLI importing the legacy kernel surface.
3. Moved implementation responsibilities.
4. Re-ran Go tests and P0-P10 behavior scripts.

## Main change

Before P13:

```text
internal/core/kernel
  kernel.go      validate / index / synth / IO / hash / helpers
  artifacts.go   generated artifacts
  gates.go       admission / authority / receipt / graph / source / lineage / partition
```

After P13:

```text
internal/core/validate
internal/core/artifacts
internal/core/admission
internal/core/authority
internal/core/receipt
internal/core/graph
internal/core/sourcepolicy
internal/core/lineage
internal/core/partition
```

`internal/core/kernel` is now documentation-only. The CLI no longer imports it.

## Adapter wiring

The adapter layer now has executable tests and compile-time port assertions where applicable.

```text
internal/adapters/jsonschema
  implements ports.ArtifactGenerator through Exporter.Generate
  can export JSON Schema surface

internal/adapters/typescript
  implements ports.ArtifactGenerator through AccessorGenerator.Generate
  can generate TypeScript accessor output from a ledger/index

internal/adapters/duckdb
  remains read/projection-only and explicitly non-authority
```

## Verified behavior

Passed:

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
scripts/test_p10_partition_snapshot_scale.sh equivalent completion
```

P10 validation completed with:

```text
lines: 500025
partitions: 6
fast_checked: 500025
cue_sampled: 1000
```

The wrapper call for the final P10 rerun hit the surrounding tool timeout after the validation report was written. The remaining assertion and receipt step was completed directly from the generated manifest and validation report. The earlier P10 run also passed as a script.

## What improved

| Area | Before | After |
|---|---|---|
| Kernel ownership | broad `internal/core/kernel` | split domain packages |
| CLI | imported `kernel` | imports concrete packages |
| Adapters | implementation-light | minimal executable adapter tests |
| Ports | defined but not asserted | JSONSchema/TypeScript compile-time assertions |
| P13 tests | absent | architecture RED/GREEN tests |

## Remaining issues

P13 is not perfect. Remaining issues are intentionally explicit:

| Remaining issue | Why it matters | Proposed next step |
|---|---|---|
| `internal/core/validate` is still large | validation, index, IO, hash, synthetic generation remain together | P14 split into `rowvalidate`, `index`, `synth`, `iohash` |
| `internal/core/artifacts` is still large | JSON Schema, TS generation, manifest, directory comparison live together | P14/P15 split `schemaexport`, `tsgen`, `manifest` |
| Some packages use dot-import from `validate` | fast split avoided churn, but it hides dependencies | Replace with explicit imports after behavior is stable |
| CLI is still a single command file | command parsing is still centralized | Move each subcommand into `cmd/contractcheck/commands` |
| Ports are still minimal | only artifact generation is wired strongly | Add ports for admission, receipt, authority, lineage stores |
| DuckDB adapter is still a marker | no actual DuckDB read/projection implementation in Go core | Keep out of core; implement only when projection/read is needed |
| JSON Schema validation is generated-surface parity, not a full external validator | acceptable for P0, not enough for external conformance | Add optional AJV/jsonschema adapter later if needed |
| P10 is full fast validation | not true incremental validation | P14/P15 add incremental partition validation |
| Source truth, semantic drift, legal, PII, business value | outside structural contract safety | separate policy/compliance/product lines |

## Final judgment

P13 is a merge candidate as a responsibility-separation PR.
It does not claim final product-core maturity.
It establishes the package boundaries needed for the next refactor without regressing P0-P10 behavior.
