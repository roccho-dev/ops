# ops-refs-vault package contract

| Field | Value |
|---|---|
| Owner package | `ops-refs-vault` |
| Owner root | `packages/ops-refs-vault` |
| Package kind | `cli` |
| Document ID | `package-contract` |

## Responsibility

Audit and project selected refs from bare Git SSOT repositories to a replaceable remote forge using explicit compare-and-swap rules.

## External contracts

### `ops-refs-vault`

| Field | Contract |
|---|---|
| Entry point | `bin/ops-refs-vault.mjs` |
| Input | Manifest, exact source and remote ref identities, and explicit operator decisions |
| Output | Audit, backup, candidate, restore, and promotion receipts |
| Error | Non-zero exit without mutating an unclassified or raced ref |
| Effect | Checked Git ref updates only in effect commands |
| Compatibility | Manifest and receipt schemas remain versioned |

## Internal contracts

### `audit-before-effect`

Read-only audit and candidate classification precede every write-capable command.

Invariants:

- Unknown or changed refs stop before write
- Remote-only state is never silently deleted

Forbidden effects:

- No mirror-force update
- No direct restore into SSOT

## Current consumers

- SSOT host operator
- governance checked publish workflow
