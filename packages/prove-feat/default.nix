builtins.fromJSON ''
  {
    "kind": "ops.packageImplementationMetadata.v1",
    "package": "prove-feat",
    "repoId": "ops",
    "mission": "Prove that the ops repository is pinned to specs and exposes a specs-backed implementation manifest, package, and check gate.",
    "primaryTarget": "packages/prove-feat",
    "requiredOutputs": "packages.<system>.prove-feat",
    "requiredChecks": "checks.<system>.prove-feat",
    "responsibility": "Run small structure, format, deadnix, and contract-lint sub-gates for the ops feat implementation surface.",
    "forbiddenResponsibility": "Does not approve merge, push, release, or live Project transport; it only proves local static repo conformance."
  }
''
