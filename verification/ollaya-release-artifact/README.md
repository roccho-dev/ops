# Ollaya release-artifact proof

Status: **PENDING**. Finite portability proof; not adoption.

## Purpose

Prove or falsify one narrow claim:

> A pinned Ollaya CPU release plus one pulled decision model can be packaged as one movable artifact and, in a fresh job with no repository checkout and no model pull, answer a typed decision through `/v1/systemone`.

This is the missing step beyond the existing generic Carry proof in #430. It does not replace Jev, select Ollaya for production, or add a permanent model runtime to ops.

## Frozen input

- Ollaya release: `v0.7.5`
- platform: `linux-amd64`
- model: `laya:multilingual`
- consumer device: CPU
- consumer registry: deliberately unreachable (`127.0.0.1:9`)

The producer verifies the upstream release archive against that release's `sha256sum.txt` before using it.

## PASS contract

PASS only if one PR workflow proves all of the following:

1. the pinned upstream release archive passes SHA-256 verification;
2. the pinned runtime can pull `laya:multilingual` once into an isolated model store;
3. runtime + model store are packed into one tar.zst artifact;
4. a second job downloads only that artifact and does **not** check out this repository;
5. the second job verifies the artifact digest, starts Ollaya from the unpacked runtime, and uses the unpacked model store;
6. the second job uses an unreachable registry and performs no pull;
7. `POST /v1/systemone` returns a valid typed `choice` answer from `laya:multilingual`.

Any missing item is RED.

## Boundary

The durable design target is:

```text
pinned upstream release
        +
pinned/materialized model store
        ↓
single movable artifact
        ↓
fresh CPU consumer
        ↓
TypeSafe-compatible typed decision
```

This PR should remain a proof. If PASS, production publication should reuse an existing generic release/Carry path rather than create an Ollaya-specific deployment framework.
