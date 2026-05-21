# ops-refs-vault troubleshooting

## `sourceBarePath` is missing

The manifest is using the old working-clone layout. Add
`sourceBarePath` for each repo:

```json
{ "repoId": "specs", "sourceBarePath": "/home/nixos/repos/specs.git" }
```

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
