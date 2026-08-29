# Root JSONL map delivery

Bounded Cloudflare Worker transport for `roccho-dev/adrs#318`.

```text
GET /  Accept: text/html
  -> exact UI asset

GET /  Accept: application/json | application/x-ndjson
  -> exact semantic source asset
```

The browser has one URL and one path. It does not know the GitHub repository, Release, asset ID, or credential.

## Current public proof

```text
source: roccho-dev/governance
asset: accepted-decision.json
bytes: 942
sha256:6c6409f27657eec4b497d5a0da7a6940416a45508fbf5c7032b57e4ab178f1f6
```

Public data is fetched from the exact immutable Release download URL without a GitHub credential. A private source uses the Release Asset API with a server-side read credential. The browser contract remains `/`.

## UI boundary

The staged UI is pinned to an exact `roccho-dev/ui` commit. It parses JSON or JSONL and creates an in-memory map projection.

```text
id      = package_id | decision_id | id | schema | record index
label   = title | name | package_id | decision_id | id | schema
summary = responsibility | summary | description | status | schema
```

No relation, lifecycle state, responsibility, or authority is inferred. No display-purpose JSONL is produced or persisted.

## Closed states

```text
401 -> 認証が必要です
403 -> このデータを表示する権限がありません
invalid media type / size / JSON / JSONL -> fail closed
```

Stale cards are removed before an error is displayed.

## Endpoint boundary

Allowed:

```text
GET /
HEAD /
```

Forbidden:

```text
all other paths
query or fragment input
POST / PUT / PATCH / DELETE
arbitrary repository / Release / asset / URL input
```

## Responsibility

- `gov*` owns semantic reduction and Release assets.
- UI owns view-only projection.
- `ops` owns exact delivery and remote readback.
- No DB, KV, R2, D1, mirror, generated decision HTML, or current-state reduction.

## Verified proof

Actions run `33238288024` proved:

```text
candidate and destructive checks PASS
Cloudflare deploy               PASS
root JSON byte/digest readback  PASS
real Chromium root UI           PASS
map projection                  PASS
page and console errors         0
other path                      404
POST /                          405
```

Hosted proof:

```text
https://stg-gov-release-proxy.roccho.workers.dev/
```

This is a replaceable minimum adapter while the final semantic-map UI integration is still in progress. `authority=false`, `cutover=false`.
