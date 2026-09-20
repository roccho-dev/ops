# Active wire V1 — ops#374 / ui#198

Authority: `roccho-dev/adrs#348#issuecomment-5523046251`.

## Request

```text
POST /api/intents
Content-Type: application/json
schema = semantic-intent.v1
```

Canonical field order:

```text
schema
intent_id
topic_id
kind
body
topic_title?
target_ref?  # {kind,id}
```

Rules:

- `intent_id` is the sole logical/idempotency identity.
- `kind` is fixed to `record`.
- optional fields are omitted, never `null`.
- identifiers are ASCII tokens; `intent_id`, `topic_id`, and `target_ref.id` are at most 128 bytes; `target_ref.kind` is at most 64 bytes.
- `body` is nonblank and at most 16,384 UTF-8 bytes.
- `topic_title` is nonblank and at most 256 UTF-8 bytes.
- the whole request is at most 32,768 bytes.
- prepared bytes are UTF-8 compact JSON in the exact field order above, with nested `target_ref` ordered `kind,id`, no BOM, outer whitespace, or trailing newline.
- SHA-256 is computed over those exact prepared bytes.
- retry reuses the same `intent_id` and byte-identical body.
- `semantic.intent.v1`, `event_id`, a second `idempotency_key`, and compatibility aliases are absent.

Canonical request fixture:

```text
fixtures/semantic-intent-v1/request.json
bytes: 230
sha256: 8a094d3755e5f196b29d10ade7a259bba5f0f67ab243950180457969e015bb29
source: roccho-dev/ui@0eadffc8e9dfe38f312b9c1c2e74643f8335302c
```

## Result

Canonical field order:

```text
schema
intent_id
local_state
github_state
issue_number?
comment_id?
receipt_id?
```

```text
schema = semantic-intent.result.v1
local_state = accepted | no_change | rejected | failed | unknown
github_state = not_started | pending | applied | unknown | permanent_failure
```

`github_state=applied` requires `issue_number`; `comment_id` requires `issue_number`. Provider identities and receipts are diagnostic only. HTTP receipt, local acceptance, GitHub application, and ADRS acceptance remain separate facts.

Exact UI request/result fixtures are copied byte-for-byte under `fixtures/semantic-intent-v1/` and verified by SHA-256 in Go tests.
