# ops#374 integration blockers

This file records only blockers outside the OPS implementation owner. It is not a substitute implementation and does not authorize copying sibling source into this repository.

## Current architecture

```text
UI package  ─┐
             ├─ OPS integration root
ENVS package ─┘      ├─ semantic-log-runtime
                     ├─ semantic-ui-dist
                     └─ semantic-ui-e2e
```

OPS owns the final package producer and the single product E2E. Phase work remains inside one Draft PR and is not separately mergeable.

## BLOCKED_UI_PACKAGE_OUTPUT

`roccho-dev/ui#199` must expose the reviewed browser artifact as one immutable Nix package with an exact identity. OPS must consume that output directly.

Not permitted:

- copying UI source or fixtures into OPS;
- rebuilding the UI from an unpinned branch or worktree;
- hand-authoring a substitute browser artifact and calling it parity proof.

Exit condition:

```text
exact UI commit
+ exact package attribute
+ exact output path/hash
+ browser request/result contract
```

## BLOCKED_ENVS_ENVCTL_OUTPUT

`roccho-dev/envs#90` must expose envctl/systemd placement as one immutable Nix package with an exact identity and a machine-readable input contract for the OPS dist manifest.

Not permitted:

- copying ENVS scripts/templates into OPS;
- letting the target host infer paths or build producer artifacts;
- maintaining a second editable systemd/runtime contract.

Exit condition:

```text
exact ENVS commit
+ exact envctl package attribute
+ exact output path/hash
+ accepted dist-manifest input contract
```

## Work that remains GO inside OPS

The external blockers do not stop these same-PR tasks:

- one custom Caddy runtime and one `/api/intents` route;
- current local static bytes on the next GET;
- atomic retirement of the Node `/api/raw` runtime;
- durable local append before GitHub effect;
- fixed-repository Issue/comment projection;
- exact readback and unknown-effect reconciliation;
- bounded retry and receipt-ledger recovery;
- pinned Caddy/cloudflared producer definitions;
- final dist and E2E wiring prepared against explicit sibling package interfaces.

## Claim ceiling

Until both sibling package outputs exist and the exact OPS E2E consumes them:

```text
OPS_RUNTIME_MAY_PROGRESS
FINAL_SEMANTIC_UI_DIST_BLOCKED
FINAL_PRODUCT_E2E_BLOCKED
MERGE_AUTHORIZED=false
RELEASE_AUTHORIZED=false
PROVIDER_LIVE_EFFECT_AUTHORIZED=false
```
