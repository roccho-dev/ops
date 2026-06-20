# UI to ops raw loop cross-repo proof, 2026-06-20

## Inputs

- UI proposal worktree: `/home/nixos/work/ui-v-o-follow-log-mention-a11y-loop-260620`
- ops proposal worktree: `/home/nixos/work/ops-v-o-follow-ui-raw-loop-runtime-260620`

## Procedure

1. `ui` parsed `fixtures/need-zoom.raw.jsonl`.
2. `ui` projected the Need Zoom surface.
3. `ui` built a JSONL mention index.
4. `ui` generated an `owner.raw.input.v1` envelope with body `@sum_purpose owner review`.
5. `ops#ui-raw-loop-runtime --post` appended that envelope to raw JSONL.
6. `ops#ui-raw-loop-runtime --project` regenerated the read model.

## Observed receipt

```json
{"kind":"ui.raw.loop.receipt.v1","projection":{"kind":"ui.raw.loop.read_model.v1","rawCount":1,"ownerInputCount":1,"byGoal":{"goal:repo-package-ui-loop":1}}}
```

## Observed read model

```json
{"kind":"ui.raw.loop.read_model.v1","rawCount":1,"ownerInputCount":1,"byGoal":{"goal:repo-package-ui-loop":1},"mentionIndex":{"kind":"ui.mention.index.v1","mentions":[{"kind":"ui.mention.ref.v1","refKind":"projectionNode","refId":"sum_purpose","label":"Purpose"}]}}
```

## Boundary

This proves the proposal-level loop mechanics only: UI draft -> ops append -> ops projection -> UI-readable model. It does not approve adrs promotion and does not authorize merge/fire.
