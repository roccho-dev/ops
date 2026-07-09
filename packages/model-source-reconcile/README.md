# model-source-reconcile

`model-source-reconcile` compares model expectations with source evidence without mutating model rows and without promoting source evidence to authority.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Compare model projection edges with source observations and receipts. |
| Repo split | Keep model runtime, source evidence, and reconcile as separate lanes. |
| Meta | Make model/data separation inspectable and replayable. |
| Meta^10 | Provide sale-ready audit proof that model claims are checked against real observations. |

## Boundary

| Area | Rule |
|---|---|
| input | Reads model projection, source observations, and source receipts. |
| output | Emits `model_source_reconcile.v1` findings and a non-authority projection. |
| model | Reconcile never mutates model rows or model projection. |
| source | Source evidence remains evidence only and is never model authority. |
| admission | Reconcile rows must not be admitted by hq model admission. |

## CLI

```text
model-source-reconcile check --model <projection.json> --source <source.jsonl> --receipts <source-receipts.jsonl> [--json|--jsonl]
model-source-reconcile projection --model <projection.json> --source <source.jsonl> --receipts <source-receipts.jsonl> [--json]
```

## Results

`model_source_reconcile.v1` emits one of `matched`, `missing_source_observation`, `conflict`, `stale_source_receipt`, or `invalid_source_receipt`.

The projection keeps three layers: `model`, `source`, and `reconcile`.
