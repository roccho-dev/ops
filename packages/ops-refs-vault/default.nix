builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v2",
  "package": "ops-refs-vault",
  "repoId": "ops",
  "mission": "Back up selected refs from repo-specific bare SSOT repositories to any Git remote forge without making the forge or generated manifest authoritative.",
  "primaryTarget": "packages/ops-refs-vault",
  "requiredOutputs": "packages.<system>.ops-refs-vault",
  "requiredChecks": "ops-refs-vault.unit+e2e+smoke-local",
  "responsibility": "Own recursive bare discovery, filesystem-schema repo identity, selected-ref projection, managed-root reconciliation, atomic backup, remote candidate planning, exact-lease candidate resolution, staged restore integrity, promotion, inventory, receipts, and runbooks.",
  "forbiddenResponsibility": "Does not treat working clones, manifests, receipts, or remote forges as SSOT; does not use GitHub APIs in core; does not mirror-push, auto-delete legacy refs, auto-adopt remote candidates, or directly promote a diverged candidate."
}
''
