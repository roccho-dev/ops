# restore UX

Restore is intentionally two-step.

1. Restore from the single forge backup into a staging bare repo.
2. Verify the staging bare repo.
3. Promote the staging bare repo into the repo-specific bare SSOT only after
   explicit approval.

```bash
ops-refs-vault restore-bare-one \
  --manifest refs-vault.manifest.json \
  --repo-id specs \
  --branch main \
  --staging-bare /tmp/staging/specs.git

ops-refs-vault promote-staging-bare \
  --repo-id specs \
  --staging-bare /tmp/staging/specs.git \
  --target-bare "$HOME/repos/specs.git" \
  --confirm
```

Use a normal working clone only after the SSOT bare repo is restored.
