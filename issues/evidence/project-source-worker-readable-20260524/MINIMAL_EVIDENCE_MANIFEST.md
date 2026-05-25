# Minimal Evidence Manifest

## Scope

This slim branch keeps the code, docs, issue records, regression test, and small proof files needed to review the Project Source false-positive guard work.

It intentionally excludes the raw 46 MB evidence archive from `codex/project-source-transport-proof-20260525` commit `49a0bbe`, including the temporary policy zip, git bundle, source snapshot, board dump, legacy policy snapshot tree, and raw CDP DOM dumps.

## Included Evidence

| Evidence | Purpose |
|---|---|
| `policy-read-snapshot-20260525T201619.json` | Policy read snapshot for the 2026-05-25 blocked issue record. |
| `policy-selected-20260525T201619.sha256` | Policy file hashes for the 2026-05-25 blocked issue record. |
| `policy-read-snapshot-20260526T041315.json` | Policy read snapshot for the slim-branch proposal record. |
| `policy-selected-20260526T041315.sha256` | Policy file hashes for the slim-branch proposal record. |
| `target-project-handoff-20260525/project-transport-env.json` | Target Project route was reachable through the wrapper. |
| `target-project-handoff-20260525/transport-run-194231/project-source-put-handoff-source-readback-20260525T194231JST.txt.json` | Upload reached visible-only state, which must not be treated as worker-readable proof. |
| `target-project-handoff-20260525/readback-retry-194231.json` | Assistant could not find the newly uploaded `194231` source and only saw older source state. |
| `target-project-handoff-20260525/readback-retry-195449.json` | `TOKEN` wording triggered a target Project refusal. |
| `target-project-handoff-20260525/transport-run-200011/project-source-put-handoff-source-readback-20260525T200011JST.txt.json` | Non-secret readback mark upload did not become visible within 180 seconds. |
| `target-project-handoff-20260525/source-list-sequential-final/project-source-list.json` | Final source list was stable but empty, so the target Project handoff remained blocked. |
| `target-project-handoff-20260525/readback-existing-193414-after-read-thread-fix.json` | Assistant-role marker filtering works for a negative `MARK_NOT_FOUND` readback. |
| `packages/ops-cdp-core/src/cdp/test-project-transport-regressions.py` | Small regression coverage for visible-only, source-list unreliability, assistant-only marker matching, streaming rejection, and parser guard terms. |
| `SLIM_BRANCH_RUN_REPORT.md` | Gate summary for the slim branch. |

## Review Claim Boundary

This slim branch does not claim that Project Source handoff is solved. It only claims that false-positive states are no longer promoted to worker-readable success, and that the remaining target Project failure is recorded as a transport/evidence blocker.

## Raw Evidence Location

Raw evidence remains in the non-merge branch:

- branch: `codex/project-source-transport-proof-20260525`
- commit: `49a0bbe`
- evidence root: `issues/evidence/project-source-worker-readable-20260524`

Do not merge that raw evidence branch to `main`.
