builtins.fromJSON ''
{
  "kind": "ops.packageImplementationMetadata.v1",
  "package": "ops-artifact-materialize",
  "repoId": "ops",
  "mission": "Restore ChatGPT machine artifacts encoded as BEGIN_B64_FILE blocks and verify bytes plus sha256 before local gate.",
  "primaryTarget": "packages/ops-artifact-materialize",
  "requiredOutputs": "packages.<system>.ops-artifact-materialize",
  "requiredChecks": "ops-artifact-materialize.sample-materialize",
  "responsibility": "Decode BEGIN_B64_FILE blocks, reject unsafe paths, verify byte length and sha256, and write MATERIALIZE_MANIFEST.json.",
  "forbiddenResponsibility": "Does not decide semantic merge, does not trust plain BEGIN_FILE as machine artifact, and does not store raw thread history as canonical knowledge."
}
''
