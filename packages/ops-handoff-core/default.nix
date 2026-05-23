builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-handoff-core",
  "repoId": "ops",
  "mission": "Generate role-aware, Project Source-ready handoff packs from policy refs, topology refs, request files, source/runtime manifests, merge targets, and thread rosters.",
  "primaryTarget": "packages/ops-handoff-core",
  "requiredOutputs": "packages.<system>.ops-handoff-core",
  "requiredChecks": "checks.<system>.ops-handoff-core",
  "responsibility": "Generate HANDOFF_MANIFEST.json, request copy, common refs, per-thread bootstraps, expected-output contracts, readback checklists, a payload provider interface, and import returned handoff result evidence into claim JSONL.",
  "forbiddenResponsibility": "Does not perform CDP transport, Project Source upload, artifact fetch, source pack creation, semantic approval, localizer approval, merge, push, or canonical repo mutation."
}
''
