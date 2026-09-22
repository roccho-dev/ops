# Vercel native Go proof

Small standard-library Go HTTP server used only to prove the Vercel provider adapter.

```text
main.go
  -> net/http
  -> $PORT
  -> Vercel
  -> GET /health
  -> {"runtime":"go","status":"ok"}
```

Properties:

- normal `package main`
- `net/http` only
- listens on Vercel-provided `PORT`, defaulting to `3000` locally
- no Dockerfile
- no `vercel.json`
- no database
- no external service dependency

The live proof is complete only when the deploy adapter returns PASS and public
`/health` readback contains the exact expected identity.
