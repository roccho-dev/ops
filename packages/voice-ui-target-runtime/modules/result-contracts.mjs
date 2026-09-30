import {
  assertNoPrivateMaterial,
  exactObjectKeys,
  normalizeSha256,
  normalizedHttps,
  requireCondition,
} from "./core.mjs";

// A deploy receipt names the operation (native deploy event version, active deployment at 100%) and the secret-name
// preflight. It never claims provider-stored module bytes or that `inherit` kept a secret value.
export function validateDeployReceipt(receipt, expected) {
  requireCondition(receipt?.kind === "ops.voiceUiDeployReceipt.v2", "deploy receipt kind differs");
  requireCondition(receipt.status === "PASS", "deploy receipt is not PASS");
  requireCondition(receipt.opsSha === expected.opsSha, "deploy ops SHA mismatch");
  requireCondition(receipt.appsSha === expected.appsSha, "deploy apps SHA mismatch");
  requireCondition(normalizeSha256(receipt.artifactManifestSha256) === expected.artifactManifestSha256, "deploy artifact digest mismatch");
  exactObjectKeys(receipt.target, ["provider", "accountId", "workerName", "url"], "deploy target");
  for (const field of ["provider", "accountId", "workerName", "url"]) {
    requireCondition(receipt.target[field] === expected.target[field], `deploy target ${field} differs`);
  }
  requireCondition(JSON.stringify(receipt.preflight) === JSON.stringify({ secrets: ["JEV_API_KEY"], presence: "NAME_PRESENT" }), "secret presence preflight differs");
  exactObjectKeys(receipt.deployment, ["versionId", "deploymentId", "workerName", "url"], "deployment");
  for (const field of ["versionId", "deploymentId"]) {
    requireCondition(typeof receipt.deployment[field] === "string" && receipt.deployment[field].length > 0, `deployment ${field} missing`);
  }
  requireCondition(receipt.deployment.workerName === expected.target.workerName
    && normalizedHttps(receipt.deployment.url, "deployment URL") === expected.target.url, "deployment target differs");
  requireCondition(receipt.effect?.status === "PASS", "deploy effect is not PASS");
  assertNoPrivateMaterial(receipt);
  return receipt;
}

export function validateReadbackReceipt(receipt, expected, deployment, artifact) {
  requireCondition(receipt?.kind === "ops.voiceUiReadbackReceipt.v2", "readback receipt kind differs");
  requireCondition(receipt.status === "PASS", "readback receipt is not PASS");
  requireCondition(receipt.opsSha === expected.opsSha, "readback ops SHA mismatch");
  requireCondition(receipt.appsSha === expected.appsSha, "readback apps SHA mismatch");
  requireCondition(normalizeSha256(receipt.artifactManifestSha256) === expected.artifactManifestSha256, "readback artifact digest mismatch");
  requireCondition(receipt.versionId === deployment.versionId, "readback version id mismatch");
  requireCondition(receipt.storedModuleBytes === "NO_CAPABILITY_NOT_RUN", "stored module bytes cannot be claimed");
  requireCondition(receipt.publicBytes?.status === "PASS" && Number.isSafeInteger(receipt.publicBytes.fileCount) && receipt.publicBytes.fileCount > 0, "public byte readback is not PASS");
  const required = artifact.manifest.files.filter(row => row.path.startsWith(`${artifact.manifest.runtime.assets.directory}/`));
  const observed = receipt.publicBytes.files;
  requireCondition(required.length > 0 && Array.isArray(observed) && observed.length === required.length
    && receipt.publicBytes.fileCount === required.length, "public readback file set is incomplete");
  const byPath = new Map(observed.map(row => [row.path, row]));
  requireCondition(byPath.size === required.length, "public readback paths are duplicated");
  for (const row of required) {
    const actual = byPath.get(row.path);
    requireCondition(actual && actual.bytes === row.bytes
      && normalizeSha256(actual.sha256) === normalizeSha256(row.sha256), `public readback differs: ${row.path}`);
  }
  requireCondition(JSON.stringify(receipt.function) === JSON.stringify({ status: "PASS", path: "/api/jev", response: 400, error: "invalid_json" }),
    "Worker rejection readback is not PASS");
  assertNoPrivateMaterial(receipt);
  return receipt;
}
