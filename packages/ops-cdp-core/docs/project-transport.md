# Project Transport Scripts

These commands replace the routine work previously assigned to a
`transportOnlyActor`. They move payloads, prove visibility/readback, and write
machine-readable transport results. They do not judge content.

Every result is `ops.projectTransportResult.v1` and must keep:

```json
{
  "semanticApproval": false,
  "completionApproval": false,
  "routeDecision": false
}
```

## Commands

| command | responsibility |
|---|---|
| `project-transport-doctor` | check low-level CDP route command availability and report wrapper visibility |
| `project-transport-env` | probe CDP address and common ports |
| `project-source-put` | upload one file to Project Source and require visibility readback |
| `project-thread-create` | create one Project thread from short pointer/control text |
| `project-thread-send` | send short pointer/control text to an existing thread |
| `project-thread-readback` | read a thread and require markers |
| `project-artifact-fetch` | download one artifact and write `ARTIFACTS_MANIFEST.json` |
| `project-transport-claim` | append a transport result into a claim JSONL |
| `project-transport-run` | run the common Project Source -> thread create transport sequence |

## Boundaries

- Project Source is the default payload route.
- Thread attachment fallback is not used by these commands.
- Inline text is limited to short control, pointers, status, and artifact names.
- Source, diff, review report, handoff body, and result artifacts must be files.
- Successful transport is not approval, merge readiness, or completion.
- Individual `nix run .#project-transport-*` commands may not expose sibling
  wrappers in `PATH`; use `nix shell .#ops-cdp-core` or the flake check when
  verifying the whole wrapper set.
- `project-thread-readback --id <targetId>` pins an already-open target. Without
  `--id`, it may open the URL when needed.
- `project-transport-doctor` validates the requested CDP port, not just any
  ChatGPT session found on another port.
