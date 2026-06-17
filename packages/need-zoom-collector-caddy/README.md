# need-zoom-collector-caddy

Ops-owned local runtime harness for raw UI events.

This package owns ingress and process wiring only:

- HTTP collector for `jsonl.record.generic.v1`.
- Caddy reverse proxy example.
- Durable local raw JSONL append path.
- DuckDB projection endpoint for local verification.

It intentionally does not own UI modeling. The UI projection contract belongs
to `ui.git`; this package only proves that raw records can be collected and
projected through an operational runtime.

## Boundaries

| boundary | owner |
|---|---|
| UI modeling core/ports | `ui.git` |
| collector HTTP process | `ops.git` |
| Caddy reverse proxy | `ops.git` |
| raw JSONL authority design | `adrs.git` |
| rendered UI state | not canonical |

## Local Run

```sh
need-zoom-collector \
  --addr 127.0.0.1:19081 \
  --data-dir /tmp/need-zoom-collector \
  --projection-sql packages/need-zoom-collector-caddy/sql/need_zoom_projection.sql
```

Caddy can reverse proxy to it using `Caddyfile.example`.

## API

| endpoint | purpose |
|---|---|
| `GET /api/health` | runtime status |
| `POST /api/raw` | append one payload as raw envelope |
| `POST /api/raw/batch` | append payload batch |
| `GET /api/raw.jsonl` | local raw log |
| `GET /api/pool.json` | local pool summary |
| `GET /api/projection/need-zoom.voronoi_surface.v1` | DuckDB projection |

All accepted records are explicitly marked:

```json
{
  "meta": {
    "canonicalStatus": "local-runtime-not-ssot",
    "approval": false
  }
}
```
