# artifact-app

`artifact-app` defines one carryable application closure over exact, independently owned source artifacts.

The current application is `artifact-runtime.interactive@1`:

```text
accepted UI Artifact Runtime Release
+ Ops-owned app definition
+ Ops-owned trusted action controller
= one content-addressed application publication
```

The carried application contains both interfaces:

- `index.html`: browser interface;
- `app/bin/artifact-app.mjs`: agent/local interface.

After App Carry, without source clone or source build, the agent interface supports:

```text
verify
encode
decode
execute
apply-action
source-plan
source-carry-request
```

The browser interface supports:

```text
#invoke URL
→ typed artifact-invocation/2
→ capability execution
→ A2UI UI
→ typed a2ui-client-action
→ next artifact-invocation/2
→ canonical #invoke URL
```

## Authority boundary

- Git commits remain source authority.
- The UI runtime Release, App Release, Carrier, Actions artifact, static host, and receipts are projections or transports.
- The app publication does not become decision, approval, or transaction authority.
- Mutable `latest` identity is forbidden.

## Source Carry

Normal use carries only the assembled application. `source-plan` exposes exact source authorities. `source-carry-request` asks the bounded GitHub Actions adapter to materialize one selected source as a one-commit shallow repository only when improvement work is required.

## Deliberate limits

- One typed action is admitted in v1: `artifact.invoke` with `artifact-app-action/1` context.
- The action compiler accepts a complete next `artifact-invocation/2`; it does not add domain branches to the shell.
- Local file/directory bindings remain local and are not falsely represented as URL-reproducible.
- URL size limits and sensitive-data restrictions remain those of the existing URL module contract.
