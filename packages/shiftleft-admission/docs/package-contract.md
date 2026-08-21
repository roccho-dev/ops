# shiftleft-admission package contract

| Field | Value |
|---|---|
| Owner package | `shiftleft-admission` |
| Owner root | `packages/shiftleft-admission` |
| Package kind | `cli` |
| Document ID | `package-contract` |

## Responsibility

Observe declared evidence, apply the existing admission Gate, and emit receipts without owning Git effects.

## External contracts

### `policyctl`

| Field | Contract |
|---|---|
| Entry point | `cmd/policyctl` |
| Input | Versioned policy, exact refs, and normalized observations |
| Output | Deterministic observations and admission receipts |
| Error | Non-zero exit with a stable finding or terminal state |
| Effect | No authoritative Git write |
| Compatibility | CLI commands and receipt schemas are versioned |

## Internal contracts

### `provider-gate-effect`

Providers observe; the existing Gate decides; c.e owns accepted Git effects.

Invariants:

- Required unobserved evidence never becomes PASS
- Receipts bind policy, observations, base tree, and candidate tree

Forbidden effects:

- Policy providers must not move authoritative Git refs
- The Gate must not repair candidates

## Current consumers

- Chat.Pro c.p.merge
- GitHub Actions admission workflow
