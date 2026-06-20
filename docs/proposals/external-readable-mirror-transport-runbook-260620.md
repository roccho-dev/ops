# External-readable mirror transport runbook

Status: proposal

## Scope

This runbook covers the degraded route used when authenticated Project Source
upload is unavailable but an external-readable fixed mirror can be produced
from SSOT. The route is for Gen2 readback only.

## Inputs

- SSH SSOT repo/ref for the canonical source.
- Fixed external mirror commit URL or content-addressed release URL.
- `MANIFEST.json` describing mirrored files, source refs, and route limits.
- `files.sha256` covering all mirrored files.
- `HANDOFF_BUNDLE.md.sha256` when a handoff bundle is included.
- Initial Gen2 readback prompt requiring `GEN2_IMPL_WORK_READBACK.json`.

## Procedure

1. Record Project Source upload failure or capability unavailability.
2. Record wrapper-first repair attempts checked before mirror selection.
3. Build the mirror from SSOT-controlled files only.
4. Include source refs and hash manifests in the mirrored package.
5. Push the mirror from an authenticated SSOT environment when GitHub is used.
6. Give Gen2 only the fixed mirror URL and readback prompt.
7. Require Gen2 to return `GEN2_IMPL_WORK_READBACK.json` before any work.
8. Have Gen1 classify the result as one of:
   - `external-mirror-readback-pass`;
   - retry Project Source;
   - blocked.

## Required readback fields

- actor binding and `threadFunction`;
- mirror URL and commit/ref read;
- file list read;
- hash manifest references seen;
- statement that the mirror is not canonical SSOT;
- statement that the route is lower-ceiling transport evidence, not Project
  Source proof;
- statement that Gen2 will not claim semantic approval, completion, merge, or
  canonical write;
- files that could not be read.

## Non-goals

This runbook does not authorize GitHub as SSOT. It does not authorize connector
or local credential use when only SSOT is authenticated. It does not authorize
inline source, thread attachment, or base64 fallback.
