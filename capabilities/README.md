# Local capabilities

This directory is the temporary single home for local script implementations that may later be exposed through `gosh`.

It is a migration/placement convention, not a new skill system or package manager. The agent-facing target is one `gosh` skill as described in `roccho-dev/ops#384`.

`capabilities/index.jsonl` is intentionally only a staging index for now. Current `gosh` v0 does not consume it as an event contract or accepted authority.

## Layout

```text
capabilities/
  README.md
  index.jsonl
  local/
    <capability>.py
    <capability>.js
    <capability>.ps1
    <capability>.sh
```

## Placement rules

1. Put local Python, JavaScript, PowerShell, and shell capability implementations under `capabilities/local/` instead of creating one Agent Skill per script.
2. Register only capabilities intended to be queryable in `capabilities/index.jsonl`; an unregistered script is not an admitted capability.
3. Keep the capability ID stable when its implementation later changes language or becomes a native binary.
4. Treat the runtime/interpreter as an explicit dependency/binding. Do not depend on ambient `PATH`, shims, `latest`, or shell-profile activation.
5. Execute as exact executable plus `argv[]`, for example `python <script> ...` or `pwsh -File <script> ...`; do not turn scripts into command strings or `sh -c` / `cmd /c` / PowerShell command-mode execution.
6. `query` selects from an admitted/indexed set. It must not silently search the web, install an approximate package, or adopt unknown software.
7. Materialization and host convergence stay outside the script implementation. Missing exact material may later cross the explicit ensure/materialize boundary described by `roccho-dev/adrs#383` and `roccho-dev/ops#384`.
8. State-changing capabilities still need their own bounded input/output/effect contract and proof before promotion.
9. Keep secret values out of the index and scripts where possible; use explicit secret references instead.

## Candidate index row

The exact schema is deliberately not fixed yet. During migration, keep rows minimal and explicit, for example:

```json
{"id":"example.capability","description":"example local capability","runtime":"python","entry":"local/example.py","platforms":["windows","linux"]}
```

This shape is a staging convention only. `ops#384` owns the future agent-facing `query -> ensure -> exact run` product shape; `packages/gosh/README.md` remains the current `gosh` implementation contract.
