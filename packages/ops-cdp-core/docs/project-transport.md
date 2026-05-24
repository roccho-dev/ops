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
| `project-source-list` | list visible Project Source files and write the source inventory |
| `project-source-delete` | remove one exact-title Project Source file with before/after inventory evidence |
| `project-thread-create` | create one Project thread from short pointer/control text |
| `project-thread-send` | send short pointer/control text to an existing thread |
| `project-thread-readback` | read a thread and require markers |
| `project-artifact-fetch` | download one artifact and write `ARTIFACTS_MANIFEST.json` |
| `project-transport-claim` | append a transport result into a claim JSONL |
| `project-handoff-preflight` | validate Project URL shape, Project Source policy, threadFunction roster, bootstrap artifacts, and expected artifact contract before worker launch |
| `project-transport-run` | run the common Project Source -> thread create transport sequence |

## Boundaries

- Project Source is the default payload route.
- Thread attachment fallback is not used by these commands.
- Project Source deletion is transport hygiene only. It is not semantic
  approval, completion approval, or route decision.
- Inline text is limited to short control, pointers, status, and artifact names.
- Source, diff, review report, handoff body, and result artifacts must be files.
- Successful transport is not approval, merge readiness, or completion.
- `project-handoff-preflight` is structural route/input validation. It does not prove semantic review, localizer readiness, or approval.
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
| `project-source-list` | Project URL, including `?tab=sources` | this command reads the Project Sources file area |
| `project-source-delete` | Project URL, including `?tab=sources` | this command opens the Project Sources file area and removes one exact file |
| `project-thread-create` | base Project URL without `?tab=sources` | this command creates a new Project thread |
| `project-thread-send` | existing `/c/<thread-id>` URL | this command sends a short pointer/control message to one thread |
| `project-thread-readback` | existing `/c/<thread-id>` URL, preferably with `--id` | this command reads one target thread |
| `project-transport-run` | base Project URL without `?tab=sources` when it will create a thread | this command uploads source, then creates a thread |

If `project-thread-create` or the thread-create phase of `project-transport-run`
receives `?tab=sources`, it fails with `project-url-wrong-shape`. This is
intentional: the Project Sources tab is the file-upload door, not the
thread-creation door.

## Project Source retention

Use `project-source-list` before deleting sources. Use `project-source-delete`
only for one exact filename at a time:

```sh
project-source-delete \
  --project-url "$PROJECT_URL" \
  --title "OLD_REQUEST.md" \
  --reason "free Project Source slot after superseding request" \
  --allow-remove
```

Deletion is intentionally narrow:

- exact title is required
- `--reason` is required
- `--allow-remove` is required for non-dry-run deletion
- fuzzy matching is not used
- duplicate exact matches are refused
- before/after source inventories are recorded in the result JSON

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
- a fresh unauthenticated profile must not produce a `recommendedRoute`
- a route is complete only after Project Source upload, Project thread creation,
  and delayed thread readback prove that the target Project can read the source

Do not give actors alternate legacy/script/proof paths as normal instructions.
The normal route is this package's Project transport wrapper surface.

The compact proof for the current route gate is under
`packages/ops-cdp-core/evidence/profile-route-gate-20260520/`.
It records the authenticated positive route, the fresh-profile negative route,
and an unauthenticated-to-existing-snapshot-runtime-copy proof.

## ChatGPT session route

`chromium-cdp-chatgpt-login` and related probes classify login state. They do
not enter credentials, OTP values, or account selections.

The accepted automatic session route is authenticated snapshot reuse:

```text
existing authenticated snapshot
  -> published authenticated snapshot
  -> fresh runtime copy
  -> Chromium CDP
  -> target Project route proof
```

If a fresh profile reaches `/auth/login`, the route is not automatic. The
normal Project transport route starts from an existing authenticated snapshot
runtime copy and must still prove the requested Project route.

The currently proven recovery from an unauthenticated route is narrower:
reject the fresh profile, copy an existing authenticated snapshot into a fresh
runtime profile, then prove the requested Project URL, Project Source upload,
thread creation, and delayed readback. This does not prove credential or OTP
automation.
