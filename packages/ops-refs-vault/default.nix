builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-refs-vault",
  "repoId": "ops",
  "mission": "Keep many local Git repos restorable from one remote forge repo by namespaced refs.",
  "primaryTarget": "packages/ops-refs-vault",
  "requiredOutputs": "packages.<system>.ops-refs-vault",
  "requiredChecks": "ops-refs-vault.smoke-local",
  "responsibility": "Own refs-vault docs, reusable scripts, restore UX, shelter push evidence shape, and final-design task prompts.",
  "forbiddenResponsibility": "Does not bypass ops-tailnet-github-egress for GitHub network routing, does not install direct remote.<name>.push refspecs for GitHub remotes, and does not store raw proof directories as package source."
}
''
