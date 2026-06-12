builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-handoff-pack",
  "repoId": "ops",
  "mission": "Derive multi-repo source manifests, merge targets, and source packs from git, drive ops-handoff-core, and enforce the semantic guarantees (digest recomputation, manifest cross-check, stub rejection) that the transport shell does not provide.",
  "primaryTarget": "packages/ops-handoff-pack",
  "requiredOutputs": "packages.<system>.ops-handoff-pack",
  "requiredChecks": "checks.<system>.ops-handoff-pack",
  "responsibility": "Resolve base branches and candidate refs to commit hashes per repo, build tracked-files-only source packs, emit source.manifest.v2 and merge.target.v2, generate the handoff via ops-handoff-core with a src-pack payload manifest, embed packs, and validate the result including digest recomputation and live base-head re-verification.",
  "forbiddenResponsibility": "Does not perform CDP transport, Project Source upload, artifact fetch, semantic approval, localizer approval, merge, push, or canonical repo mutation. Does not edit repo content; it archives candidate refs as-is."
}
''
