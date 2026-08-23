# hq-modeling-runtime

`hq-modeling-runtime` is the canonical native Go runtime for carrying human-reviewed model-change intent through deterministic JSON/JSONL boundaries.

## Boundary

| Claim | Value |
|---|---|
| implementation | Go |
| canonical package | `packages/hq-modeling-runtime` |
| public input | serialized JSON and JSONL bytes |
| production authority | no |
| external Go modules | none |
| CGO | not required |
| carry unit | one static binary plus manifest |

The runtime deliberately does not accept arbitrary in-process JavaScript objects. Proxy, getter, prototype, sparse-array, non-enumerable-property, cycle, and shared-reference semantics are outside the public contract because they cannot cross serialized JSON/JSONL bytes.

Unused Node-only adapters for CUE append execution, local serving, CI receipts, GitHub readback, and staged canonical promotion were retired at cutover because no consumer depended on them. Reintroducing one requires a new explicit capability and test contract.

## Commands

```text
hq-modeling-runtime validate   --input <queue.jsonl> [--json]
hq-modeling-runtime work       --input <queue.jsonl> [--json]
hq-modeling-runtime receipts   --input <queue.jsonl> [--jsonl|--json]
hq-modeling-runtime projection --input <queue.jsonl> [--json]
hq-modeling-runtime admit      --input <queue.jsonl> [--accepted-jsonl|--receipt-jsonl|--json]
hq-modeling-runtime promote    --input <proposal.json> --confirmation <confirmation.json> [--queue-jsonl|--receipt-jsonl|--json]
```

Without a subcommand, the binary emits `hq.modelingRuntime.boundary.v1` and reports the serialized-byte boundary and implemented capabilities.

## Invariants

- unconfirmed proposals never become queue intent;
- agent tasks remain pending evidence and are never admitted as model commits;
- receipts and projections are deterministic and non-authoritative;
- authority-bearing and source/reconcile-smuggled payloads fail closed;
- exit class, stdout/stderr lane, line identity, row order, stable error codes, and compatible digests are tested;
- promotion output does not alias caller-owned input;
- 20,000-level JSON-compatible nesting is accepted with bounded resource growth.

## Build and test

```sh
cd packages/hq-modeling-runtime
go test ./...
go vet ./...
CGO_ENABLED=0 go build -trimpath -buildvcs=false \
  -o ./hq-modeling-runtime \
  ./cmd/hq-modeling-runtime
```

The produced binary executes by absolute path with an empty `PATH`; it does not invoke Node.js or another command.

## Historical test meaning

`test-meaning.inventory/*.jsonl` preserves the 154 behavior groups extracted from the former Node/MJS test corpus. Git history preserves the exact 16 source tests and their SHA-256 values. The current meta-test proves unique meaning IDs, complete 540-assertion accounting, and ownership of every serialized meaning by a current Go test.
