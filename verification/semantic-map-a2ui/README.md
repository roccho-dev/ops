# semantic-map-a2ui verification

This directory preserves the original 220 t=0 completion gates and keeps the added merge-gate IDs stable. The former diagrams-transfer gates now prove current-tree retirement, URL-to-source recovery, append-only acceptance, and fresh-bundle reproduction instead of requiring the obsolete draw.io package to remain installed.

- `data/jsonl/criteria.jsonl`: stable requirements and methods.
- `data/jsonl/status.jsonl`: current appendable status projection.
- `generated/completion-gates.md`: deterministic, non-authority projection.
- `render.mjs check`: rejects stale projection, criteria/status drift, and `BLD-002` digest or `BLD-003` revision drift from `locks/semantic-map-a2ui.jsonl`.
- `render.mjs require-complete`: fails while any blocking gate is not `PASS`.

`PENDING_INPUT`, `NOT_STARTED`, and `IN_PROGRESS` are intentionally not promoted to green.
