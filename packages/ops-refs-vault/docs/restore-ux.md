# restore UX

Restore is intentionally separated from SSOT promotion.

1. Fetch one selected remote ref into an empty staging bare.
2. Verify OID, `HEAD`, `git fsck --full`, and normal clone usability.
3. Review the staging result.
4. Promote only with explicit confirmation.

```bash
ops-refs-vault restore-bare-one \
  --manifest manifest.json \
  --repo-id team/api \
  --branch main \
  --staging-bare /tmp/staging/team-api.git

ops-refs-vault promote-staging-bare \
  --repo-id team/api \
  --staging-bare /tmp/staging/team-api.git \
  --target-bare /home/nixos/repos/.bare/team/api.git \
  --confirm
```

`--repo-id` accepts the human `repoPath` or encoded `repoKey` from the generated manifest.
