# Selected governance universe → Semantic Map → Ops Worker proof

This proof consumes one exact existing governance JSONL and one exact UI semantic-map artifact.

```text
governance selected-universe.jsonl
+ UI-owned projection profile
+ exact semantic-map HTML
→ Ops gov-release-proxy
→ one Cloudflare Worker root
   ├─ Accept: text/html → map UI
   └─ Accept: application/x-ndjson → exact governance JSONL
→ byte readback
→ real Chromium visual evaluation
```

## Boundaries

- Governance owns the meaning JSONL; this proof does not rewrite it.
- UI owns semantic-map rendering and the projection profile.
- Ops owns exact assembly, delivery, deployment, and readback.
- HTML is generated and deployed only for visual evaluation.
- HTML, Worker state, receipts, and screenshots are not authority.
- No production cutover is claimed.
