# ui-raw-loop-runtime

Existing OPS owner for the UI-to-local semantic-log loop. Issue `ops#374` evolves this package into the deployable `semantic-log-runtime`; no parallel top-level runtime is introduced.

## Active V1 wire

Authority: `roccho-dev/adrs#348#issuecomment-5523046251`.

```text
POST /api/intents
schema       = semantic-intent.v1
intent_id    = sole logical/idempotency identity
topic_id
kind         = record
body
topic_title?
target_ref?  = semantic {kind,id} only
```

The prepared body is compact UTF-8 JSON in the fixed field order above, has no outer whitespace or trailing newline, and is at most 32,768 bytes. `body` is at most 16,384 UTF-8 bytes and `topic_title` at most 256 UTF-8 bytes. SHA-256 is computed over the exact prepared bytes. Equivalent but byte-different JSON is rejected rather than normalized behind the browser.

The exact UI request and four result fixtures from `ui#199@0eadffc8e9dfe38f312b9c1c2e74643f8335302c` are copied under `fixtures/semantic-intent-v1/` and verified by hash.

## Current Go core

```text
canonical request validation
→ intent_id idempotency
→ authoring-intent.jsonl durable append
→ canonical semantic-intent.result.v1
```

The local ledger is the accepted-intent source. A future GitHub effect must occur only after this append succeeds.

## Legacy surface awaiting atomic cutover

The current Node implementation still owns:

- `POST /api/raw`
- `owner.raw.input.v1`
- raw JSONL append and local read-model projection
- `GET /read-model`

It is not a second accepted V1 interface. It must be retired atomically when the Caddy `/api/intents` route becomes active; no permanent alias or parallel HTTP runtime is allowed.

## Still open in this same PR

- Caddy standard `file_server` and transport-only `/api/intents` handler;
- atomic Node runtime retirement;
- GitHub Issue/comment projection, readback, reconciliation and receipt ledger;
- custom Caddy + pinned cloudflared amd64/arm64 dist;
- one machine-readable verified-dist handoff for `envctl`;
- packaged-dist and explicitly authorized live proof.

No merge, Release, Cloudflare mutation, VM deployment, or live GitHub provider effect is authorized by the current core.
