# voice-ui target runtime

This package owns the Ops side of the `voice-ui` consumer proof.

It consumes only exact, non-secret handoffs:

- a complete `voice-ui-dist/1` artifact and manifest digest;
- an `envs.projectionReceipt.v1` bound to an exact envs SHA;
- an `ops.secretEffectBoundary.check.v1` verdict bound to an exact ops SHA;
- exact deploy and public-readback adapters.

The runner verifies every input before provider mutation, deploys the existing artifact without rebuilding it, performs public byte/Function readback, and invokes the artifact-pinned apps runtime acceptance twice from separate temporary workspaces. It emits `NEW_PROJECTION_REAL_USE_PROVEN` only when every stage is PASS.

It never checks out envs, invokes `envctl` or `auth exec`, decrypts SOPS, reads an age identity, or accepts `envs-old`/private-artifact fallback. Projection presence alone, a successful deploy without readback, or one successful application run cannot produce PASS.

## Commands

```console
node packages/voice-ui-target-runtime/capture-isolation.mjs \
  --root . \
  --ops-sha <exact-ops-sha> \
  --output isolation.json

node packages/voice-ui-target-runtime/run.mjs --request request.json
```

The source contract and destructive tests can merge before physical dev projection. A real PASS remains blocked until envs provides the real projection receipt, apps provides the exact complete artifact, Ops provides approved effect credentials/adapters, and both independent application executions succeed.
