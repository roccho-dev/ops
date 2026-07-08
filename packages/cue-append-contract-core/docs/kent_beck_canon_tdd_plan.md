# Kent Beck canonical TDD plan for append-only contract JSONL proof

## 0. Scope

This plan promotes the current proof bundle to the `main` baseline, then grows the proof only by small red-green-refactor loops.

The proof target is not "build a large runtime". The target is to prove that append-only modeling definitions can keep growing while failures move as far left as possible:

1. CUE/meta-contract catches malformed contract JSONL.
2. Generated validators catch invalid JSONL rows.
3. Generated TS types/accessors plus tsgo/tsc catch removed-field usage.
4. Admission gate prevents raw/draft JSONL from becoming canonical directly.
5. Authority gate prevents projection/CI/agent output from becoming decision authority.
6. Receipt events prove what was executed, with what input/output hashes.
7. Graph checks catch missing endpoints, forbidden flows, and cycles.
8. Source policy prevents raw/extraction/trust/retention collapse.
9. Partition/snapshot/closure keeps volume and deep lineage tractable.

## 1. Kent Beck style working rule

Every implementation phase uses this loop:

```text
Test list
  -> pick one behavior
  -> RED: write the smallest failing test
  -> GREEN: implement the smallest change that passes
  -> REFACTOR: simplify without changing behavior
  -> commit while green
  -> append proof receipt
```

Rules:

- One behavior per TDD slice.
- No production code without a failing test first, except pure deletion or formatting.
- Prefer characterization tests before changing legacy/proof code.
- Prefer generated artifacts over hand-maintained registries.
- A phase is not complete until positive and negative tests both prove the boundary.
- Generated files are never edited by hand.
- Every phase writes a receipt or proof report.

## 2. Branch plan

```text
main
  Current working proof.
  Contains the existing CUE meta-contract, contract JSONL ledgers, current reports, and baseline receipt.

feature/p0-baseline-hardening
  Characterization tests and explicit negative exit assertions.

feature/p1-generated-integrity
  contract hash, generated manifest, no-dirty check.

feature/p2-jsonschema-validator-generation
  contract JSONL -> generated JSON Schema / generated validator.

feature/p3-ts-accessor-static-failure
  generated TS types/accessors and field-removal compile failure.

feature/p4-admission-gate
  draft/raw -> canonical gate and reject receipts.

feature/p5-authority-boundary
  projection/CI/agent decisionization prevention.

feature/p6-receipt-ledger
  first-class receipt events for validation, projection, migration, and action.

feature/p7-graph-checker
  missing endpoint, forbidden flow, cycle, projection/raw pollution tests.

feature/p8-source-policy
  source_kind, raw_ref, content_hash, retention_class, extraction separation.

feature/p9-lineage-impact-closure
  direct edge as source, closure/path/impact as regenerated projections.

feature/p10-partition-snapshot-scale
  partition manifest, snapshot hash, incremental validation.
```

Merge rule:

```text
No branch merges to main unless:
  1. Its red test failed for the expected reason at least once.
  2. All existing tests are green.
  3. Negative fixtures fail closed.
  4. The new behavior has a proof receipt.
  5. Generated artifacts are clean.
```

## 3. Phase completion criteria

### Phase 0: main baseline and characterization

Goal: freeze the current proof as the `main` branch baseline.

RED:
- Add a baseline script that explicitly fails if invalid fixtures exit with code 0.
- Before the script exists, CI cannot prove negative-fixture behavior.

GREEN:
- `go test ./...` passes.
- `small_before_fix` and `small_after_fix` pass.
- `invalid_shape`, `invalid_semantic`, `invalid_unknown` fail closed.
- `proof/main_baseline_receipt.json` exists.

REFACTOR:
- Move baseline commands into one script.
- Do not change contract semantics.

DONE:
- Current proof is tagged as baseline.
- Existing 120k/500k reports remain as historical scale evidence.

### Phase 1: generated integrity

Goal: generated artifacts cannot drift from contract JSONL.

RED:
- Manually edit a generated artifact.
- CI must fail with `generated_dirty`.
- Change contract JSONL without regenerating.
- CI must fail with `contract_generated_hash_mismatch`.

GREEN:
- Add `generated_manifest.json` containing generator version, contract hash, output hashes.
- Add `check-generated-clean`.

DONE:
- Regeneration is deterministic.
- Generated files cannot become second truth.

### Phase 2: generated JSON Schema / validator

Goal: remove hand-maintained fast validator risk.

RED:
- Add a new field constraint to contract JSONL.
- Existing hand fast validator should be shown to miss it or require manual change.
- Parity test between CUE and generated validator fails.

GREEN:
- Generate JSON Schema from contract JSONL/meta-contract.
- Generated validator matches CUE on fixture corpus.

DONE:
- Unknown field, invalid enum, missing required, bad reference all fail.
- Fast validator is generated or generated-schema-backed.

### Phase 3: generated TS types/accessors and tsgo/tsc static failure

Goal: removed fields break projection/query code at compile time.

RED:
- Write projection code that reads `claim.v1#confidence` through generated accessor.
- Remove/deprecate the field in contract.
- Compile must fail.

GREEN:
- Generate TS types and accessors from contract.
- Projection code may only read through generated accessors.
- Direct string field access is prohibited.

DONE:
- Field removal produces compile error before runtime.
- Deprecated field usage produces warning or fail depending policy.

### Phase 4: admission gate

Goal: raw/draft JSONL cannot directly enter canonical ledger.

RED:
- Try to append draft/raw contract event directly to canonical ledger.
- Expect fail.
- Invalid draft must produce reject receipt.

GREEN:
- Add `admit` command.
- Only admitted events are canonical.

DONE:
- Every rejection has `target_id`, `reason_code`, `input_hash`.
- Canonical ledger has no bypass path.

### Phase 5: authority boundary

Goal: correct projection cannot become accepted decision by itself.

RED:
- Projection writes `decision.accepted`.
- CI green writes approval.
- Agent output writes accepted decision without authority.
- All must fail.

GREEN:
- Add policy for allowed authorities.
- Split contract gate from authority gate.

DONE:
- Projection is read-only.
- CI is receipt/violation only.
- Accepted decision requires authority and pass receipt.

### Phase 6: receipt ledger

Goal: execution, validation, migration, and action are receipt-backed.

RED:
- Projection run without receipt passes today; test expects fail.
- Receipt without `target_id`, `input_hash`, `output_hash`, `runner_version` fails.

GREEN:
- Add receipt event schema and writer.
- Add migration/check receipts.

DONE:
- Every side-effecting or decision-relevant run appends receipt.
- Report files are not the only proof; receipt events are first-class.

### Phase 7: graph checker

Goal: schema-valid graph can still be rejected when meaning relation is invalid.

RED:
- Missing endpoint passes row schema but must fail graph check.
- `raw -> decision`, `projection -> raw`, `projection -> decision` fail.
- Cycle fails.

GREEN:
- Add thin graph checker over direct edges.

DONE:
- Direct edge is source.
- Closure/path are generated projections, not authority.

### Phase 8: source minimal policy

Goal: source/raw/extraction/trust/retention do not collapse.

RED:
- raw event without `raw_ref`, `content_hash`, `source_kind`, `retention_class` fails.
- LLM output as raw fails.
- extractor output without extractor version fails.

GREEN:
- Add source policy contract.
- Add raw/extraction distinction.

DONE:
- Source capability is explicit.
- Derived content is not raw.

### Phase 9: lineage / impact / closure

Goal: direct edges can regenerate impact and closure projections.

RED:
- Deep dependency requires too many joins or misses deletion impact.
- Deprecated field misses affected projection/fixture.
- Stale extractor output is not detected.

GREEN:
- Generate `closure`, `path`, `impact_index`, `stale_report` from direct edges.

DONE:
- Closure/path are reproducible from direct edge ledger.
- Impact report is generated, not hand-maintained.

### Phase 10: partition / snapshot / scale

Goal: growth does not require full revalidation forever.

RED:
- One append forces full 500k+ scan.
- Duplicate ID across partitions is missed.
- Snapshot hash mismatch is not detected.

GREEN:
- Add partition manifest, snapshot hash, incremental validation.

DONE:
- Append-only behavior remains deterministic.
- Partitioned validation identifies affected partitions.
- Snapshot can be discarded and regenerated.

## 4. Non-goals

This plan does not prove truth, market value, legal compliance, or business quality. It proves structural, code, admission, authority, receipt, graph, source-policy, and scale boundaries. Truth, legal, and business value remain outside contract testing.
