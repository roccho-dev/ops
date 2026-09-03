# ui-raw-loop-runtime

Existing OPS owner for the UI-to-local log loop. Issue `ops#374` evolves this package toward `semantic-log-runtime`; no parallel runtime package is introduced.

## Active legacy surface

The current Node implementation remains unchanged until the atomic Caddy cutover:

- `POST /api/raw`
- `owner.raw.input.v1`
- raw JSONL append and local read-model projection
- `GET /read-model`

It remains non-authoritative and does not decide ADRS acceptance, approval, merge readiness, or external effects.

## Frozen semantic-intent V1 wire

The cross-repo request contract is now the UI Phase-1 shape:

```text
schema       = semantic-intent.v1
intent_id    = sole logical/idempotency identity
topic_id
kind         = record
body
topic_title? = first-topic title
target_ref?  = semantic {kind,id} only
```

Canonical bytes are compact JSON in that field order, optional fields omitted when absent, UTF-8, no trailing newline. Retry reuses the same `intent_id` and exact prepared bytes. The runtime must not accept the earlier provisional `semantic.intent.v1` / `event_id` names as aliases.

The Go files currently close only validation, canonical digest, and durable `authoring-intent.jsonl` append. Caddy transport, provider projection/readback, receipt ledger, dist, and live effects remain later gates in this same PR.
