# Transport Route Failure 260620

This directory records transport evidence for the Gen2 ChatGPT two-thread handoff packet.

## Scope

This is transport evidence only. It is not semantic approval, completion approval, merge approval, packet failure, schema failure, or Gen2 instruction failure.

## Result

The packet and role split were structurally valid, but Gen2 execution is blocked until Project Source upload and worker-readable readback succeed.

## Observed Route State

- The target ChatGPT Project route was reachable through the Codex in-app Browser.
- The target Project resolved as `remove-policy`, not `/auth/login`, account chooser, permission page, or blank page.
- The Project Source route was reachable and showed the Source tab, the add-source control, and existing source files.
- The in-app Browser cannot upload files. The runtime rejected file chooser upload with `File uploads are not supported by Codex In-app Browser.`
- Raw CDP file input mutation was rejected by the runtime and directed to Playwright file chooser instead.
- WSL `chromium-cdp` routes were not durable in this environment:
  - no initial CDP port reachable on 9222/9223/9224
  - headless launch exposed DevTools briefly, then failed or became unreachable
  - non-headless launch failed because WSL had no `$DISPLAY`
  - Xvfb launch exposed DevTools briefly, then Project route probing still failed with `cdp-bridge:error:fetch failed`

## Evidence Files

- `project-route-ui-proof.md`
- `project-route-ui-project.snapshot.txt`
- `project-route-ui-sources.snapshot.txt`
- `project-route-ui-sources-hits.json`
- `transport-doctor.json`
- `transport-env.json`
- `chromium-cdp.log`
- `chromium-cdp-gui.log`
- `chromium-cdp-xvfb.log`
- `transport-doctor-xvfb.json`
- `project-source-upload-260620-gen2-split.sha256`

## Required Next Gate

A valid continuation requires one of these Project Source-capable routes:

1. durable `ops-cdp-core` route with authenticated profile reuse and file upload support; or
2. another Project Source-capable transport surface where the actor is transport-only, uploads the fixed revisioned files unchanged, records file list/hash/route/readback evidence, and leaves semantic judgment to Gen1.

Inline source body, thread attachment fallback, and base64 fallback are not valid continuations for this packet.
