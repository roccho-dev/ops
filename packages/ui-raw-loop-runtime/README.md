# ui-raw-loop-runtime

Existing OPS owner for the UI-to-local log loop. Issue `ops#374` evolves this
package toward the product identity `semantic-log-runtime`; no parallel
runtime package is introduced.

## Active legacy surface

The current Node implementation remains unchanged in the initial phase:

- `POST /api/raw`
- `owner.raw.input.v1`
- raw JSONL append and local read-model projection
- `GET /read-model`

It remains non-authoritative and does not decide ADRS acceptance, approval,
merge readiness, or external effects.

## Initial semantic-log phase

The Go files in this directory own the smallest irreversible core required by
all later adapters:

```text
semantic.intent.v1
  -> event_id as the sole idempotency identity
  -> deterministic canonical digest
  -> durable authoring-intent.jsonl append
```

The initial phase deliberately has no HTTP/Caddy adapter, GitHub adapter,
receipt ledger, Cloudflare configuration, dist, or provider effect. The active
Node endpoint is neither modified nor duplicated. Caddy cutover and Node
retirement are a later atomic phase after the exact consumer inventory is
accepted.

Run the focused proof with:

```text
go test ./...
```

`nix flake check` also exposes the exact
`semantic-log-runtime-core` check from the repository root.
