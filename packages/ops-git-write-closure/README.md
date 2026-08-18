# ops-git-write-closure

Closes the machine-contract portion of Issue #114.

```text
exact-base worktree
→ prepare
→ checks + candidate object graph + effect plan
→ external authenticated EffectPort
→ authoritative readback
→ verify
→ final receipt
```

## Boundary

- `prepare` owns base verification, change inspection, checks, Git OIDs, candidate tree, adapter budget, ordering, and plan identity.
- The external adapter owns only authenticated blob/tree/commit/ref/PR effects and readback.
- `verify` trusts neither a write response nor a PR URL; it verifies the supplied authoritative readback against the plan.
- Protected/default branch write, force, merge, automatic rebase, tags, Releases, and arbitrary large new blobs are outside v1.

## Commands

```text
ops-git-write-closure prepare --request request.json --out-dir out [--state-dir state]
ops-git-write-closure verify --plan out/effect-plan.json --effect-result effect-result.json --out receipt.json
```

## Mandatory authoritative blob readback

`verify` requires canonical Base64 readback bytes for every changed blob and recomputes byte count, payload SHA-256, and the Git blob OID. Echoed object IDs without authoritative bytes never produce `PASS`. Candidate-tree SHA, commit parent/tree/message, ref, and draft PR are still independently read back and compared.
