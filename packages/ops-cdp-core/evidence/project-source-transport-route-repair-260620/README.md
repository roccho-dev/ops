# Project Source Transport Route Repair 260620

## Classification

| field | value |
|---|---|
| policy status | PASS, Project Source-only rule preserved |
| packet status | PASS, handoff packet/schema/topology unaffected |
| transport status | BLOCKED |
| blocker class | transport / external-state |
| external gate | authenticated Project Source-capable browser/CDP session required |

This evidence records a transport blocker only. It is not semantic approval,
completion approval, merge approval, packet failure, schema failure, or Gen2
instruction failure.

## Required Gate

Gen2 execution may continue only after Project Source upload and worker-readable
readback succeed for the fixed revisioned packet files.

Allowed continuation:

- retry with an authenticated browser profile/session that can open the target
  Project Source surface; or
- use a user-provided Project Source-capable upload surface, with Gen0 acting
  only as transportOnlyActor and Gen1 retaining semantic review.

Forbidden fallback:

- inline source body
- thread attachment fallback
- base64 fallback

## Tested Routes

| route | result | classification |
|---|---|---|
| Codex in-app Browser | target Project and Project Source surface visible, but file upload unsupported | route-visible / upload-blocked |
| WSL chromium-cdp, no CDP session | wrappers present, no reachable CDP port | transport-blocked |
| WSL chromium-cdp headless + GPU/Viz disabled | CDP can stay alive, but Project access can crash on GPU process fatal | transport-unstable |
| WSL chromium-cdp headless + SwiftShader/ANGLE | CDP stable, ChatGPT reaches Cloudflare `Just a moment...` instead of Project shell | project-shell-blocked |
| WSL chromium-cdp non-headless under Xvfb + SwiftShader/ANGLE | avoids headless user agent, but Project load is not durable | transport-unstable |
| Windows Edge CDP | CDP reachable from Windows-side Node, but ChatGPT route is `/auth/login` | external-auth-missing |
| Windows Chrome default profile | launch absorbed into existing Chrome instance and no debugging port opened | transport-blocked |
| Chrome profile snapshot while Chrome running | locked cookie files prevent authenticated snapshot reuse | external-auth-missing |

## Evidence Files

- `project-route-ui-proof.md`
- `project-route-ui-project.snapshot.txt`
- `project-route-ui-sources.snapshot.txt`
- `project-route-ui-sources-hits.json`
- `project-source-upload-260620-gen2-split.sha256`
- `transport-doctor.json`
- `transport-env.json`
- `transport-doctor-9228-swiftshader.json`
- `transport-doctor-9229-xvfb-swiftshader.json`
- `transport-doctor-9229-xvfb-swiftshader-after-wait.json`
- `chromium-cdp.log`
- `chromium-cdp-gui.log`
- `chromium-cdp-xvfb.log`
- `chromium-cdp-headless-9228-swiftshader.log`
- `chromium-cdp-xvfb-9229-swiftshader.log`

## Repair Requirement

The missing capability is not another policy rule. The missing capability is a
durable, authenticated Project Source transport route:

1. start or attach to a browser/CDP session that can open the target Project;
2. prove the Project Source surface is visible in that same session;
3. upload fixed revisioned packet files unchanged;
4. list/read back visible Project Source files and hashes;
5. create the impl-work Project thread with a short control prompt;
6. require worker-readable readback before any semantic work continues.

Until that route exists, the Gen2 work/review proof remains incomplete.
