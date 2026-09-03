# Wire parity decision — ops#374 / ui#198

This file records the Phase-A correction required by the merge reviews on ops#375 and ui#199.

## One V1 request

```json
{"schema":"semantic-intent.v1","intent_id":"intent-1","topic_id":"topic-1","kind":"record","body":"same"}
```

Rules:

- `intent_id` is the sole logical/idempotency identity.
- `kind` is fixed to `record` in V1.
- `topic_title` is optional and is meaningful for the first topic event only.
- `target_ref` is optional semantic `{kind,id}` only; path/repository/Issue/provider URL fields are rejected.
- canonical bytes are compact UTF-8 JSON in struct/schema field order, optional fields omitted, no trailing newline.
- retry resends the exact prepared bytes; changed content is a new `intent_id`.
- the provisional OPS names `semantic.intent.v1`, `event_id`, and `title` are retired before merge and are not aliases.

## Request limits

- `intent_id`, `topic_id`, `target_ref.id`: 128 ASCII token bytes.
- `target_ref.kind`: 64 ASCII token bytes.
- `body`: 16,384 Unicode characters.
- `topic_title`: 256 Unicode characters.
- HTTP total-body limit is owned by the upcoming Caddy transport gate and must be >= the maximum valid serialized V1 request while remaining explicitly bounded.

## Result boundary to freeze before transport implementation

The browser-visible result keeps three axes separate:

```text
transport_state = idle | sending | received | unknown | rejected
local_state     = accepted | no_change | rejected | failed | unknown
github_state    = not_started | pending | applied | unknown | permanent_failure
```

`transport_state` is UI/client state; the server response owns `local_state` and `github_state` plus diagnostic identities. HTTP success never implies GitHub applied.

The exact result fixture and HTTP status mapping are the next Canon RED before Caddy code. No compatibility shim is permitted.
