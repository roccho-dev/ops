# Exact base + small text delta → source ZIP proof

## Result

`EXACT_BASE_SMALL_TEXT_DELTA_TO_GIT_OBJECT_AND_PR = PASS`

GitHub Actions reconstructed a deterministic source ZIP from exact base commit
`0d639abef299536e0800175d4c6e1d34f763d1c7` plus a **419-byte text-only delta**.
The materialized branch was then rewritten so the request, delta, and temporary materializer workflow are absent.
A separate GitHub Actions run read the ZIP back through the Git Blob API, checked its exact bytes,
safely extracted it, and recomputed the expected Git source tree.

| Boundary | Exact result |
|---|---|
| Base commit | `0d639abef299536e0800175d4c6e1d34f763d1c7` |
| Text delta | 419 bytes / `5909110a799699a89c179ffcb032cde0bb805517639ab22bb3df507a75446939` |
| Added source | 183 bytes / `0cfaa7859ee1a25d27ab8a03da4f5f14f4ceab3c0a499f189f1074c7c421d7cb` |
| Materialized commit | `3b1857fc72b81e6f0fd4ba3422bb7b84d6e8273d` |
| Materialized commit parent | exact base only |
| Target ZIP | 1,997,397 bytes |
| Target ZIP SHA-256 | `132d8f40e494a0a201fc6737a9c7cd69440b37163cb6fb8f02fa11e2927179e0` |
| Target ZIP Git blob OID | `fa1889d86b1554d75c2294504d8aa3e70aa19d19` |
| Exact target source tree | `b7c336dfb6f4cffea41a6d66e381129257834a82` |
| Complete target ZIP carried in ingress | no |
| Seed-based regeneration | no |
| Model repair | no |
| Remote Git Blob API byte readback | PASS |
| ZIP CRC and safe extraction | PASS |
| Recomputed source tree | exact match |
| Pull request | #335 |

## Evidence

- Materializer run: `33109904579`
- Independent Green readback run: `33110229421`, attempt 2
- Evidence artifact: `9662219671`
- Artifact digest: `sha256:173ccf6bccef2a17ecb316e34fd4c62d1781ac32ae8917334929117ed46e558f`
- Final receipt: `receipt.json`

The materializer run itself ended non-Green only after its successful force-push, at its original fresh-fetch adapter.
The independent readback run closes that boundary and is Green. Its first attempt reached PR creation after all byte and tree checks,
but repository policy rejected PR creation by `GITHUB_TOKEN`; PR #335 was created through the authenticated Connector,
and attempt 2 completed successfully and uploaded the evidence artifact.
