# structured-diagnostic

`structured-diagnostic` fixes one small boundary:

```text
application value
→ diagnostic/1
→ environment adapter
→ optional existing durable authority mapping
```

It is not a logger framework and it is not a durable event authority.

## Contract

A diagnostic has exactly four required fields and one optional field.

| Field | Meaning |
|---|---|
| `schema` | Exactly `diagnostic/1`. |
| `code` | Stable machine token. Human text must not be used as the machine key. |
| `level` | `debug`, `info`, `warn`, or `error`. |
| `message` | Human-readable text. |
| `fields` | Optional flat object containing only JSON scalar values. |

Every unknown top-level field, duplicate object key, symbol, accessor, and non-enumerable property is rejected. Text must contain well-formed Unicode. Numbers use finite IEEE-754 binary64 semantics. Identity, order, time, lifecycle, and final result fields are reserved for the host:

```text
event_id
run_id
instruction_id
seq
recorded_at
timestamp
status
target
final
```

`contract.json` is the language-neutral contract. The MJS core and Node adapter are its current executable reference implementation.

## Responsibility boundary

| Layer | Owns | Must not own |
|---|---|---|
| pure core/application | domain result, typed error, optional diagnostic value | logger, console, stdio, file, network, clock, durable lifecycle |
| environment adapter | redaction policy, transport, one-line write | domain decision authority |
| host/worker | event identity, sequence, time, lifecycle, durable mapping | application meaning |
| this package | strict validation, canonical encoding, Node stdio adapter | storage, collector, accepted authority |

The caller must redact sensitive values before `writeDiagnostic`. This package deliberately does not define a universal redaction policy.

## Public API

`lib/diagnostic.mjs` is pure and accepts the contract explicitly:

- `validateDiagnostic(value, contract)`
- `encodeDiagnostic(value, contract)`
- `parseDiagnosticLine(line, contract)`
- `canonicalizeDiagnosticJsonl(text, contract)`

`adapters/node.mjs` loads `contract.json` and exposes bound functions plus:

- `writeDiagnostic(value, stream = process.stderr)`

The adapter encodes first, then calls `stream.write` exactly once. It never calls `console.*`.

The CLI validates a complete input before writing any stdout:

```text
structured-diagnostic check [file|-]
```

Valid input becomes canonical JSONL. Invalid input exits non-zero and leaves stdout empty.

## Runtime profiles

| Runtime | Primary output | Diagnostic transport |
|---|---|---|
| CLI/batch | stdout | stderr JSONL |
| pure library | return value | return value or caller-supplied port |
| browser | UI/callback | callback; console is only a projection |
| service | response/queue | host sink or existing event contract |
| hq worker | canonical result | transient output mapped by the worker to `result.v1` |

The schema is shared. Transport and durable envelopes remain environment-owned.

## Limits

The exact limits are in `contract.json`:

- one encoded row: 64 KiB;
- code: 128 UTF-8 bytes;
- message: 8 KiB;
- fields: 32;
- field name: 128 UTF-8 bytes;
- string field value: 8 KiB;
- nested field values: prohibited;
- duplicate JSON object keys: prohibited;
- malformed Unicode scalar sequences: prohibited.

## Shift Left boundary

This package has zero runtime and build dependency on Issue #116 or `policyctl`.

A separate later assurance change may execute package entrypoints, observe primary and diagnostic streams, and fold the evidence through #116. That receipt proves conformance; it does not provide the runtime feature.

```text
this package = implementation contract and behavior
#116 later   = independent observation and assurance
```

## Current consumer

The repository check `structured-diagnostic` executes the public API, stdio adapter, CLI, destructive cases, false-positive exclusion, false-negative exclusion, and clean deterministic replay.
