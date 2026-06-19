builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-refs-vault",
  "repoId": "ops",
  "mission": "Keep repo-specific bare SSOT repositories on nixos-vm restorable from one remote forge backup repo by namespaced refs, with generated manifest snapshots and backup receipts for full-run evidence.",
  "primaryTarget": "packages/ops-refs-vault",
  "requiredOutputs": "packages.<system>.ops-refs-vault",
  "requiredChecks": "ops-refs-vault.smoke-local",
  "responsibility": "Own bare SSOT to single forge backup commands, generated manifest snapshots, backup receipts, full-ref verification, orphan audit, restore-to-staging, promotion, inventory, docs, and smoke evidence.",
  "forbiddenResponsibility": "Does not treat local working clones as the canonical backup source, does not make generated manifests the SSOT authority, does not make GitHub the SSOT, does not auto-promote restored refs into SSOT without approval, and does not store raw proof directories as package source."
}
''
