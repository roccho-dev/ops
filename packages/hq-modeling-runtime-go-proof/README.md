# hq-modeling-runtime-go-proof

`hq-modeling-runtime-go-proof` is a native Go portability and behavioral-parity proof for the serialized JSON/JSONL CLI boundary of `hq-modeling-runtime`.

It is deliberately **not** a replacement package, accepted implementation, or cutover proposal. The existing Node.js package remains canonical.

## Status and authority

| Claim | Value |
|---|---|
| canonical implementation | `packages/hq-modeling-runtime` |
| proof implementation | this directory |
| input boundary | serialized JSON and JSONL bytes |
| package-registry replacement | no |
| production authority | no |
| cutover ready | no |
| external Go modules | none |
| CGO requirement | none |

Running the proof binary without a subcommand, or with `--json`, emits `hq.modelingRuntime.goParityProof.boundary.v1`. It explicitly reports `proofOnly=true`, `cutoverReady=false`, and `replacementAuthorized=false`.

## Why this proof exists

The current Node.js runtime is already small and carryable. Go is useful only if it can add a native single-binary option without weakening the existing model/source, authority, digest, stdout/stderr, or fail-closed contracts.

This proof tests that proposition before any package or runtime cutover:

```text
unchanged MJS oracle tests
+ Node CLI oracle
+ native Go candidate
+ identical serialized fixtures
-> parity gate
```

## Implemented proof surface

The Go candidate implements these CLI paths:

- `validate`
- `work`
- `receipts`
- `projection`
- `admit`
- `promote`

For the checked valid serialized JSON/JSONL fixture corpus, the parity gate compares:

- exit status;
- stdout/stderr routing;
- plain-text summaries;
- JSON and JSONL semantics;
- row order;
- validation and authority error codes;
- queue, receipt, state, projection, admission, proposal, confirmation, evidence, and integrity digests;
- repeat-run byte determinism.

The proof builds with `CGO_ENABLED=0` and then executes the absolute binary with an empty `PATH`, proving that the resulting runtime does not invoke Node.js or another command.

## Existing MJS tests remain the oracle

`tests/parity.mjs` first runs the existing `hq-modeling-runtime` MJS tests unchanged, excluding only the external CUE `contractcheck` integration. It then builds the Go candidate and compares both CLIs over positive, schema-negative, authority-bearing, source-smuggling, duplicate-ID, missing-vs-null, status-order, raw negative-zero, promotion, output-mode, and malformed-input cases.

The existing JavaScript-only complete-object defenses remain canonical and are not translated into artificial Go concepts:

- Proxy and accessor rejection;
- prototype and descriptor inspection;
- sparse-array rejection;
- non-enumerable property detection;
- mutation-on-read protection.

Those values cannot cross the Go proof's serialized JSON/JSONL byte boundary. The Go candidate therefore validates parsed JSON data rather than claiming parity for arbitrary in-process JavaScript objects.

## Explicit residual

Malformed JSON must fail closed with the same exit class, output lane, line identity, and `invalid-json` code. Parser wording is runtime-specific, so exact parser message text is not a parity requirement. Digests derived from that parser message are also classified as parser-dependent evidence, not portable semantic identity.

Checked valid-JSON schema failures and successful paths retain exact digest parity.

## Non-goals

This proof does not implement or replace:

- CUE append-contract execution;
- `hq serve local`;
- CI, GitHub readback, or staged-to-canonical promotion adapters;
- the existing package registration;
- accepted-ledger or production governance authority;
- the Node.js complete-object snapshot boundary.

It also does not modify any existing MJS implementation or test.

## Run

```sh
go test ./packages/hq-modeling-runtime-go-proof/...
node packages/hq-modeling-runtime-go-proof/tests/parity.mjs
```

Build the proof binary directly:

```sh
cd packages/hq-modeling-runtime-go-proof
CGO_ENABLED=0 go build -trimpath -buildvcs=false \
  -o ./hq-modeling-runtime-go \
  ./cmd/hq-modeling-runtime-go
```

## Promotion boundary

A later replacement proposal would require a separate decision and evidence for at least:

1. every registered MJS check or an explicitly accepted boundary mapping;
2. CUE adapter parity;
3. local-root, serve, CI, GitHub-readback, and canonical-promotion ownership;
4. cross-platform binary artifacts and readback;
5. exact digest compatibility over the accepted fixture corpus;
6. one explicit package-registry cutover with rollback.

Passing this proof authorizes none of those effects.
