# Ollaya release-artifact proof

Status: **DONE / PASS**. Finite portability proof; not adoption.

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

## Execution evidence

Canonical PASS run:

- workflow run: https://github.com/roccho-dev/ops/actions/runs/36407408386
- executed PR head: `ec233cb689170b5cf2e3490beeb58200530d27a4`
- producer: **PASS**
- artifact-only replay: **PASS**
- Actions artifact ID: `10963036217`
- Actions artifact bytes: `628605373`
- Actions artifact digest: `sha256:d62df35f1a5a82251349fc923e5520968d478584047ec38d30a0a2f79b86e6cd`
- bundled tar.zst SHA-256: `f528cd51c4910099bed0010b29b0e19284260aaa9a4b6f90e09667a66682b839`

Observed producer facts:

- upstream `ollaya-linux-amd64.tar.zst`: SHA verification **PASS**
- running daemon version: `0.7.5`
- `laya:multilingual` pull into isolated store: **success**

Observed artifact-only consumer facts:

- no repository checkout
- no model pull
- artifact SHA verification: **PASS**
- bundled model visible as `ollaya.dev/library/laya:multilingual`
- `POST /v1/systemone`: **PASS**
- answer type: `choice`
- observed choice: `refund`
- confidence: `0.9843`
- probabilities: `refund=0.9921`, `other=0.0079`
- input tokens: `36`
- output tokens: `0`

The consumer ran with `OLLAYA_REGISTRY=127.0.0.1:9`; the request addressed the already-bundled model by its canonical stored name. Therefore the successful decision did not depend on resolving the configured default registry or issuing a model pull.

## Result

The claim is proven for this fixed environment:

> Ollaya v0.7.5 + a materialized Laya model store can be distributed as one Linux amd64 artifact and replayed on a fresh Ubuntu 24.04 CPU runner to serve a TypeSafe-compatible typed decision without repository source or a consumer-side model pull.

This proves portability and runtime closure for the tested artifact. It does not prove production quality, cross-OS portability, or that Ollaya should replace Jev.

## Final-tree boundary

The proof workflow was intentionally transient. After the PASS above was recorded, `.github/workflows/ollaya-release-artifact-proof.yml` was removed from the final PR tree so a one-shot experiment does not become permanent CI or an Ollaya-specific deployment framework.

Exact executed workflow source remains recoverable from Git history at `ec233cb689170b5cf2e3490beeb58200530d27a4` and from run `36407408386`.
