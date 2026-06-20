# ops-refs-vault troubleshooting

## `sourceBarePath` is missing

The manifest is using the old working-clone layout. Add
`sourceBarePath` for each repo:

```json
{ "repoId": "specs", "sourceBarePath": "/home/nixos/repos/specs.git" }
```

For a full bare-root run, prefer generating the manifest instead of editing it:

```bash
ops-refs-vault generate-manifest \
  --bare-root /home/nixos/repos/.bare \
  --out /var/lib/ssot/refs-vault/runs/<runId>/manifest.json
```

That generated manifest is a backup receipt snapshot. It is not the authority
for which repositories should exist.

## restore writes nowhere useful

`restore-bare-one` writes to a staging bare repo. It does not update a working
clone and does not overwrite the SSOT location. Use `promote-staging-bare`
after verification and approval.

## missing branch

Missing branch restore fails. This is intentional. Do not fall back to `main`
unless a separate operator-approved recovery command says so.

## GitHub is not SSOT

`roccho-dev/refs` is a single forge backup. If it differs from the source bare
SSOT, `verify-one` fails and the operator must decide which side is correct.

## orphan audit fails

`orphan-audit` compares the generated manifest snapshot with
`refs/heads/repos/*` in the forge backup. A failure means either:

- a source ref from the manifest is missing in the forge backup;
- the forge has an extra namespace/ref that no longer exists in the generated
  snapshot; or
- the manifest was generated from the wrong bare root or with the wrong
  exclusion file.

Do not use `--force` to mask this. Generate a fresh manifest from the intended
bare root, re-run `backup-all` without force, and then re-run `verify-all` plus
`orphan-audit`.
