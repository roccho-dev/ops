# ops-refs-vault knowledge map

`ops-refs-vault` owns refs layout, bare SSOT backup, restore-to-staging,
promotion, audit, and inventory.

Resolved knowledge:

| id | status | canonical place |
|---|---|---|
| K09 | implemented | `backup-one`, `backup-all` |
| K11 | implemented | `restore-bare-one` |
| K12 | implemented | manifest `sourceBarePath` controls SSOT source |
| K13 | implemented | `smoke-local` proves bare SSOT -> forge -> staging -> target |
| K16 | implemented | missing branch restore fails |
| K27 | implemented | `inventory` emits `bare-inventory.tsv` |
| K28 | implemented | `verify-one` compares source bare hash and forge hash |

Out of scope:

| topic | owner |
|---|---|
| GitHub App Connector route gating | `ops-tailnet-github-egress`, only when explicitly required |
| local working clone dirty/untracked protection | filesystem shelter or separate bundle backup |
| package selection and repo binding | `repos/specs` package contracts |

The old local-working-repo refs-vault route is no longer the canonical route.
The canonical source for backup is a repo-specific bare SSOT repository.
