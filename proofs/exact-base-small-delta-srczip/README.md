# Exact base + small text delta → native Git source tree proof

## Result

`EXACT_BASE_SMALL_TEXT_DELTA_TO_NATIVE_GIT_TREE_AND_PR = PASS`

The mergeable result is **not** a source ZIP. The ZIP was only a temporary reconstruction and readback projection and has been removed from this pull request.

GitHub now represents the reconstructed target as ordinary source Git objects at their real repository paths:

```text
exact base commit
+ 419-byte text delta
→ packages/chatgpt-capability/zz-exact-delta-proof.txt
→ ordinary Git blob
→ exact packages/chatgpt-capability subtree
→ pull request
```

## Exact identities

| Boundary | Result |
|---|---|
| Base commit | `0d639abef299536e0800175d4c6e1d34f763d1c7` |
| Base package tree | `69ce4609beaa12f97681ad833e15ac921dd27d53` |
| Text delta | 419 bytes / `5909110a799699a89c179ffcb032cde0bb805517639ab22bb3df507a75446939` |
| Materialized source path | `packages/chatgpt-capability/zz-exact-delta-proof.txt` |
| Source bytes | 183 |
| Source SHA-256 | `0cfaa7859ee1a25d27ab8a03da4f5f14f4ceab3c0a499f189f1074c7c421d7cb` |
| Source Git blob OID | `9f8ca8df1b869104e7f92bf8ec9f3e630262a615` |
| Source mode | `100644` |
| Expected target package tree | `b7c336dfb6f4cffea41a6d66e381129257834a82` |
| Observed target package tree | `b7c336dfb6f4cffea41a6d66e381129257834a82` |
| ZIP present in final PR | **no** |
| Native source blob present in final PR | **yes** |
| Pull request | #335 |

The unchanged source files are not duplicated. They remain reachable from the exact base tree; Git composes those existing blobs with the new source blob to form the target package tree above. This is the normal mergeable Git representation.

## Historical reconstruction evidence

The prior deterministic ZIP proved that the same target source tree could be reconstructed and independently read back. It is retained only as external evidence, not as a merge artifact.

- former ZIP: 1,997,397 bytes
- former ZIP SHA-256: `132d8f40e494a0a201fc6737a9c7cd69440b37163cb6fb8f02fa11e2927179e0`
- materializer run: `33109904579`
- independent Green readback run: `33110229421`, attempt 2
- evidence artifact: `9662219671`
- artifact digest: `sha256:173ccf6bccef2a17ecb316e34fd4c62d1781ac32ae8917334929117ed46e558f`

See `receipt.json` for the machine-readable boundary.
