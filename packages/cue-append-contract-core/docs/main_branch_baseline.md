# Main branch baseline

This proof bundle should be treated as the initial `main` baseline before feature work.

Baseline commands:

```bash
bash scripts/run_baseline_tdd.sh
```

Baseline guarantees:

- Existing Go package compiles and `go test ./...` passes.
- Existing positive ledgers pass validation.
- Existing invalid ledgers fail closed.
- Negative fixture exit codes are explicitly asserted.
- `proof/main_baseline_receipt.json` records the baseline proof.

Branching rule:

```text
main = characterized current proof
feature/* = one TDD phase or smaller slice
merge = red proof observed + green proof retained + receipt appended
```

Do not merge speculative runtime growth. If a behavior can be enforced by generated types, CUE, JSON Schema, AJV, tsgo/tsc, or fixture tests, do that before adding a new runtime component.
