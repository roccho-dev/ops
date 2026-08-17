builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-capability-loop",
  "repoId": "ops",
  "mission": "Close the Release-to-local-to-dedup-to-next-intake loop against the repo-head-release/1 contract from PR #108.",
  "primaryTarget": "packages/ops-capability-loop",
  "requiredOutputs": "packages.<system>.ops-capability-loop",
  "requiredChecks": "checks.<system>.ops-capability-loop",
  "responsibility": "Verify and decode the exact repo-head Carrier, restore the shallow .git capsule, fsck the base, discover existing packages with find-packages, render the whole package map, decide reuse/compose/extend/new, and emit the next content-addressed intake Carrier.",
  "forbiddenResponsibility": "Does not fetch network URLs, publish Releases, mutate the restored repo, approve semantic intent, push, merge, or replace find-packages/package-architecture-map."
}
''
