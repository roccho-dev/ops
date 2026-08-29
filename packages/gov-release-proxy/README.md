# Root semantic JSON delivery

Bounded Cloudflare Worker transport for `roccho-dev/adrs#318`.

```text
GET /  Accept: text/html
  -> exact UI asset

GET /  Accept: application/json | application/x-ndjson
  -> current real gov Release semantic asset
```

The browser has one URL and one path. It does not know the GitHub repository, Release, asset ID, or credential.

## Producer-to-page closure

```text
governance publishes a real non-draft, non-prerelease Release
  -> GitHub exposes that Release as /releases/latest
  -> Worker resolves the latest Release at request time
  -> Worker selects the single accepted-decision.json asset
  -> Worker verifies GitHub metadata, byte count and SHA-256
  -> UI fetches / and recreates its in-memory map
```

No Worker or UI redeploy is required for the next valid gov Release. The old hard-coded public Release identity and the private ADRS runtime fixture are absent.

## Gov/Web file contract

The contract is more than a filename.

```text
repository      roccho-dev/governance
release         latest published, non-prerelease GitHub Release
release tag     gov-release/<release-id>/<64 lowercase hex manifest digest>
release title   exactly <release-id>
target          exact 40-hex commit
asset count     exactly one accepted-decision.json
asset state     uploaded
asset type      application/json or application/x-ndjson
asset size      1..2,000,000 bytes
asset digest    sha256:<64 lowercase hex>
```

The Worker validates the Release and asset metadata before download, then validates downloaded bytes against the metadata. A matching filename alone is insufficient.

## Public and private source behavior

```text
public repository
  -> anonymous latest-Release request succeeds
  -> anonymous immutable asset download

private repository
  -> anonymous latest-Release request returns 404
  -> Worker retries the same fixed repository with GITHUB_RELEASE_TOKEN
  -> authenticated Release Asset API download
```

The token is server-side only. Public access never requires it. Repository, Release, asset, and URL remain non-user-selectable.

## UI boundary

The UI parses JSON or JSONL and creates an in-memory map projection.

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
invalid Release / asset / media type / size / digest -> fail closed
invalid JSON or JSONL -> fail closed
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

- `gov*` owns semantic reduction and real Release publication.
- UI owns view-only projection.
- `ops` owns current Release resolution, exact delivery, and remote readback.
- No runtime fixture, DB, KV, R2, D1, mirror, generated decision HTML, or current-state semantic reduction.

`authority=false`, `cutover=false`.
