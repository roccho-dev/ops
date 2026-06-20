# Gate matrix

| Gate | Status | Actual | Expected |
|---|---|---|---|
| sourceFile-inventory | PASS | 500 | >0 |
| mdBlock-coverage | PASS | 57164 | >0 |
| table-first-class | PASS | 845 | >0 |
| tableCellBlock-coverage | PASS | 4498 | 4498 |
| disposition-before-semantics | PASS | 57164 | 57164 |
| source-span-integrity | PASS | True | True |
| authorityRelevantUnresolved-zero | BLOCK | 2308 | 0 |
| regression-fixtures-present | PASS | 14 | >0 |
| accepted-compiler-authority | BLOCK | False | True |
| conflictMatrix-evaluated | BLOCK | not evaluated | implemented conflictMatrix and supersessionGraph |
| consumerCutoverGate | BLOCK | not evaluated | all consumers use accepted projections and pass runtime/e2e checks |
