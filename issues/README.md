# ops issues

This directory records implementation issues that belong to `repos/ops`.

Scope rule:

- `repos/specs` owns package contracts, policy contracts, role contracts, and expected output shape.
- `repos/ops` owns operational implementation: CDP transport, Project Source upload/readback, artifact fetch, thread FSM, artifact materialize, tailnet push tooling, refs-vault tooling, and runbook checks.
- These issue files must not redefine specs policy. They point to specs contracts and record the ops implementation gap.

Current issue set:

| issue | title | primary ops package |
|---|---|---|
| [001](001-thread-fsm-handoff-created-not-terminal.md) | `handoff-created` must not be terminal success | `ops-thread-fsm` |
| [002](002-project-transport-live-proof-hardening.md) | Project Source upload/readback/artifact fetch live-proof hardening | `ops-cdp-core` |
| [003](003-end-to-end-handoff-generator.md) | end-to-end handoff generator | new package or `ops-cdp-core` wrapper |
| [004](004-src-pack-offline-nix-cache-payload.md) | Src Pack + Offline Nix Cache payload | new package |
| [project-handoff-preflight-command](project-handoff-preflight-command/262205-054419.md) | Project handoff preflight command | `ops-cdp-core` or new wrapper |
| [localize-readiness-classifier](localize-readiness-classifier/262205-054419.md) | classify localize readiness route | new package or `ops-thread-fsm` integration |
| [chatgpt-project-handoff-runner](chatgpt-project-handoff-runner/262205-054419.md) | ChatGPT Project handoff runner | `ops-cdp-core` wrapper |
| [handoff-result-importer](handoff-result-importer/262205-054419.md) | import ChatGPT handoff result into claim/evidence | `ops-agent-events` or new wrapper |

Shared non-goals:

- Do not make `flakes` a second canonical implementation.
- Do not treat transport success, readback, artifact visibility, or handoff creation as semantic approval.
- Do not move role definitions or organization authority into generated handoff files.
- Do not add fallback paths that bypass Project Source-first / artifact-first rules.
