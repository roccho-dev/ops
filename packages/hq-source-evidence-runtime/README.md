# hq-source-evidence-runtime

`hq-source-evidence-runtime` is the separate source evidence lane for real observations and deterministic readback receipts.

## Purpose lineage

| Generation | Purpose |
|---|---|
| Scope | Accept `source.observation.v1` and emit `source.receipt.v1` outside the hq model queue. |
| Repo split | Keep model intent in `hq-modeling-runtime` and real source evidence in this package. |
| Meta | Preserve model/data separation with deterministic evidence-only digests. |
| Meta^10 | Make real-world observation auditable and transferable for sale-ready proof. |

## Boundary

| Area | Rule |
|---|---|
| source observation | `source.observation.v1` is valid only in this source evidence lane. |
| source receipt | `source.receipt.v1` is deterministic evidence only. |
| model queue | Source rows must not be accepted by the hq model queue. |
| authority | Source rows must not contain accepted/admission/ledger authority fields. |
| adapters | GitHub/local/remote-bare reads stay outside pure validation and digest core. |

## CLI

```text
hq-source-evidence-runtime validate --input <source.jsonl> [--json]
hq-source-evidence-runtime receipts --input <source.jsonl> [--jsonl|--json]
hq-source-evidence-runtime summary --input <source.jsonl> [--json]
```

## Minimal rows

`source.observation.v1` requires `kind`, `id`, `status`, `surface`, `observedAt`, `subjectRef`, `sourceRef`, `observation`, and `observedDigest`.

`source.receipt.v1` requires `kind`, `id`, `status`, `observationId`, `surface`, `observedDigest`, `receiptDigest`, and `evidenceOnly`.
