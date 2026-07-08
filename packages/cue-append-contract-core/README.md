# CUE append contract core

This is an ops package for the CUE + append-only contract JSONL core. It is
kept as an isolated Go module under `packages/cue-append-contract-core` so the
core proof tree can be reviewed before SSOT adoption without becoming repo root
state.

The checked binary is built by Nix/Go from source. Prebuilt `bin/contractcheck`
artifacts from the source bundle are intentionally not vendored.

## Original Proof Summary

This proof checks whether schema/modeling definitions can keep growing as append-only JSONL without creating one CUE file per schema.

## Core idea

- `contracts/meta.cue` is the small fixed meta-contract.
- `ledgers/*.contract.jsonl` contains schema, field, edge, query, fixture, deprecation, and authority-rule definitions as append-only events.
- `cmd/contractcheck` validates rows and builds cross-row indexes.
- CUE is used as the contract source and direct row validator.
- For high volume, `--row-validator fast --cue-sample N` uses a compiled fast validator plus CUE sampling. In a product version this fast validator should be generated from the CUE/contract AST, not hand-maintained.

## What this proves

1. Individual CUE schemas do not have to grow with each schema. The CUE file remains a small meta-contract.
2. Modeling definitions can be appended as JSONL events.
3. Cross-row relations are checked outside CUE: missing schemas, missing fields, query-to-fixture mismatch, duplicate IDs, and schema-change impact.
4. Schema change impact is visible: `field.deprecated` creates affected query/fixture lists. If a later query version stops using the field, unresolved impact disappears.
5. CUE direct validation works for moderate batches; large batches need a generated/compiled validator for practical speed.

## Commands

```bash
go build -o bin/contractcheck ./cmd/contractcheck

# CUE + fast validator on a small schema-change ledger
./bin/contractcheck validate --meta contracts/meta.cue \
  --ledger ledgers/small_before_fix.contract.jsonl \
  --row-validator both \
  --report proof/report_small_before_fix_both.json

# After appending the replacement field and query v2
./bin/contractcheck validate --meta contracts/meta.cue \
  --ledger ledgers/small_after_fix.contract.jsonl \
  --row-validator both \
  --report proof/report_small_after_fix_both.json

# Large stress ledger generator
./bin/contractcheck generate --out ledgers/stress_500k.contract.jsonl \
  --schemas 25000 --fields 8 --queries 100000 --edges 75000 --fixtures true

# Large stress validation
./bin/contractcheck validate --meta contracts/meta.cue \
  --ledger ledgers/stress_500k.contract.jsonl \
  --row-validator fast --cue-sample 1000 \
  --report proof/report_stress_500k_fast.json
```

## Result summary

| Case | Rows | Mode | Result |
|---|---:|---|---|
| `small_before_fix` | 11 | fast + CUE | PASS; deprecated `claim.v1#confidence` affects `q_claim_summary.v1` and fixture `fx_claim_summary`; unresolved family `claim_summary` |
| `small_after_fix` | 14 | fast + CUE | PASS; historical affected query remains listed, but unresolved impact is empty after appending `q_claim_summary.v2` |
| invalid shape | 1 | CUE | FAIL |
| invalid unknown field | 1 | fast | FAIL |
| invalid semantic reference | 4 | CUE + semantic | FAIL; query references missing field |
| direct CUE 50k | 50,000 | CUE | PASS in ~20.5s |
| large 120k | 120,025 | fast + CUE sample | PASS in ~1.84s, peak app alloc ~58.9MB |
| stress 500k | 500,025 | fast + CUE sample | PASS in ~6.38s, peak app alloc ~242.8MB |

## Boundary

This does not prove infinite or arbitrary volume. It proves that the design is append-only and linearly scalable at least to the 500k-definition scale in this environment. Beyond that, the next required measures are partitioning, snapshots, and closure/index materialization.

## TDD upgrade plan

This bundle now includes a Kent Beck style TDD plan for extending the proof without turning it into a large runtime:

- `docs/kent_beck_canon_tdd_plan.md`
- `docs/main_branch_baseline.md`
- `plans/tdd_phase_matrix.jsonl`
- `scripts/run_baseline_tdd.sh`
- `proof/main_baseline_receipt.json`

Start by treating the current state as `main`, then implement each phase by red-green-refactor with explicit positive and negative completion criteria.
