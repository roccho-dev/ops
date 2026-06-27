# Ops downstream claim port adapter proposal

## Why

Ops already declares package and check claims through `spec/implements.json`.
A separate claim model would duplicate the same data and make claim adoption expensive.

## Decision

Add a thin adapter from `spec/implements.json` into `claim.downstream.port.v1`.

Mapping:

| source | target |
|---|---|
| `implements[].package` | `subjectId` or subject suffix |
| `implements[].contractId` | `contractId` |
| normalized package/check refs | `claimDigest` input |
| implementation source closure | `sourceClosureDigest` |

## Output

The adapter emits JSONL rows with:

- `kind`
- `subjectId`
- `contractId`
- `claimDigest`
- `sourceClosureDigest`

## Boundary

- Ops does not decide admission.
- Ops does not mint upstream grant.
- Ops does not treat README or rendered artifacts as authority.
- Governance consumes the normalized claim port.
