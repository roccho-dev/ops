builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-git-write-closure",
  "repoId": "ops",
  "mission": "Convert a tested exact-base local candidate into a machine-readable Git object effect plan and verify authoritative remote readback.",
  "primaryTarget": "packages/ops-git-write-closure",
  "requiredOutputs": "packages.<system>.ops-git-write-closure",
  "requiredChecks": "checks.<system>.ops-git-write-closure",
  "responsibility": "Verify exact base, inspect additions updates deletions and modes, run checks, calculate blob OIDs and candidate tree, enforce adapter budgets, emit an ordered effect plan, and verify remote ref commit tree blob and draft PR readback.",
  "forbiddenResponsibility": "Does not authenticate to GitHub, invoke ChatGPT Connector from the local process, write protected branches, force update, merge, rebase, create tags or Releases, or treat Connector self-report as authoritative without readback."
}
''
