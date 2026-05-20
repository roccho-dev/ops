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

## Project URL shapes

Use the URL for the door you are opening.

| command | accepted URL shape | reason |
|---|---|---|
| `project-source-put` | Project URL, including `?tab=sources` | this command opens the Project Sources file area |
| `project-thread-create` | base Project URL without `?tab=sources` | this command creates a new Project thread |
| `project-thread-send` | existing `/c/<thread-id>` URL | this command sends a short pointer/control message to one thread |
| `project-thread-readback` | existing `/c/<thread-id>` URL, preferably with `--id` | this command reads one target thread |
| `project-transport-run` | base Project URL without `?tab=sources` when it will create a thread | this command uploads source, then creates a thread |

If `project-thread-create` or the thread-create phase of `project-transport-run`
receives `?tab=sources`, it fails with `project-url-wrong-shape`. This is
intentional: the Project Sources tab is the file-upload door, not the
thread-creation door.

## Profile and Project access

Generic ChatGPT login is not enough. A profile route is usable only when it can
open the requested Project URL itself.

Use:

```sh
project-transport-doctor --project-url "$PROJECT_URL"
project-transport-env --project-url "$PROJECT_URL" --ports 9222,9223,9224
```

Expected behavior:

- no reachable CDP port is `no-cdp-port-reachable`
- generic auth without target Project access is not `ok`
- Project login redirect is `project-access-profile-missing`
- a usable candidate returns `recommendedRoute`

Do not make deprecated `flakes` commands, raw `.mjs` scripts, or proof worktree
paths normal actor instructions. They are debug or migration evidence only.
