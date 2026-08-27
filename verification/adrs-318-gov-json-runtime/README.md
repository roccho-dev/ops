# ADRS #318 — gov JSON runtime reduce on Cloudflare Pages

This bounded proof verifies the smallest provider path after adopting:

```text
gov* owns semantic reduce
UI owns display reduce only
ops owns exact transport, provider binding, and readback
```

## Proof path

```text
exact public governance Release asset IDs
  -> CI download through GitHub Release Asset API
  -> byte length + SHA-256 verification
  -> byte-identical same-origin Pages mirror
  -> current.json
  -> deployed browser runtime fetch
  -> byte/digest/schema verification
  -> generic display-only reduce
  -> remote Chromium receipt
```

The application does **not** replay lifecycle events, decide authority, infer current state, or generate HTML per data update. The HTML/JS shell is deployed once; JSON is fetched at runtime.

## Why mirror exact bytes

Direct browser access to a GitHub Release asset depends on GitHub redirects and CORS behavior. Those are not adopted UI contracts. CI therefore selects exact asset IDs, verifies their declared bytes/digests, and deploys the same bytes under the Pages origin. A later protected mirror can use the same boundary.

## Current claim ceiling

```json
{
  "claim_ceiling": "PR_CANDIDATE_GREEN",
  "cloudflare_pages_permission": "PROVE_BY_WORKFLOW",
  "gov_release_fetch": "PROVE_BY_WORKFLOW",
  "byte_identical_mirror": "PROVE_BY_WORKFLOW",
  "remote_runtime_fetch": "PROVE_BY_WORKFLOW",
  "display_reduce": "PROVE_BY_WORKFLOW",
  "production_package_contract": false,
  "authenticated_ui": false,
  "provider_e2e": false,
  "authority_changed": false,
  "cutover": false
}
```

## Files

- `source.json`: exact governance Release and asset identities.
- `materialize.mjs`: downloads, verifies, mirrors, and writes `current.json`.
- `site/`: one static runtime shell; no generated decision HTML.
- `readback.py`: byte-exact remote Pages readback.
- `browser-smoke.py`: local/remote real-Chromium verification.

## Ownership ceiling

This is an `ops` verification package. Final Package Decision Atlas view reduction belongs in `ui`; final package semantics and immutable semantic Release belong in `gov*`. This proof only closes provider capability and the runtime JSON-fetch/display-reduce shape.
