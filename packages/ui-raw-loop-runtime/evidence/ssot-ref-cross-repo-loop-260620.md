# SSOT-ref cross-repo UI raw loop proof, 2026-06-20

## Refs

- `ui.git` proposal commit: `6d27b232349fffe99ddce1b2c04d2284b2778423`
- `ops.git` proposal commit: `3674b928eb321ed6bac590e6eab090aca7ae1c97`
- `adrs.git` proposal commit: `efe1465eaac4171d355a67d7388a42f1198cd612`

## Checks

- `nix flake check git+ssh://100.124.250.91/home/nixos/repos/.bare/ui.git?rev=6d27b232349fffe99ddce1b2c04d2284b2778423` passed.
- `nix flake check git+ssh://100.124.250.91/home/nixos/repos/.bare/ops.git?rev=3674b928eb321ed6bac590e6eab090aca7ae1c97` passed.
- `adrs#package-discovery-projection` emitted 109 rows from SSOT proposal ref.
- `ops#find-packages` found `ops/find-packages` and `ops/ui-raw-loop-runtime` from that adrs projection.

## Cross-repo loop

Using only SSOT refs, the UI proposal generated an `owner.raw.input.v1` draft from `need-zoom.raw.jsonl`, and the ops proposal consumed it:

```json
{"kind":"ui.raw.loop.receipt.v1","projection":{"kind":"ui.raw.loop.read_model.v1","rawCount":1,"ownerInputCount":1,"byGoal":{"goal:repo-package-ui-loop":1}}}
```

The projected read model contained the mention index entry:

```json
{"kind":"ui.mention.ref.v1","refKind":"projectionNode","refId":"sum_purpose","label":"Purpose"}
```

## Boundary

This proves proposal-ref reproducibility for the mechanics. It does not approve adrs promotion, merge, fire authorization, or package authority.
