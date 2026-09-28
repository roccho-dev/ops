import {
  assertNoPrivateMaterial,
  exactObjectKeys,
  normalizeSha256,
  normalizedHttps,
  requireCondition,
} from "./core.mjs";

export function validateDeployReceipt(receipt, expected) {
  requireCondition(receipt?.kind === "ops.voiceUiDeployReceipt.v1", "deploy receipt kind differs");
  requireCondition(receipt.status === "PASS", "deploy receipt is not PASS");
  requireCondition(receipt.opsSha === expected.opsSha, "deploy ops SHA mismatch");
  requireCondition(receipt.appsSha === expected.appsSha, "deploy apps SHA mismatch");
  requireCondition(normalizeSha256(receipt.artifactManifestSha256) === expected.artifactManifestSha256, "deploy artifact digest mismatch");
  exactObjectKeys(receipt.target, ["provider", "accountId", "project", "branch"], "deploy target");
  for (const field of ["provider", "accountId", "project", "branch"]) {
    requireCondition(receipt.target[field] === expected.target[field], `deploy target ${field} differs`);
  }
  exactObjectKeys(receipt.deployment, ["id", "url", "stableUrl", "commitSha"], "deployment");
  requireCondition(typeof receipt.deployment.id === "string" && receipt.deployment.id.length > 0, "deployment id missing");
  normalizedHttps(receipt.deployment.url, "deployment URL");
  normalizedHttps(receipt.deployment.stableUrl, "stable URL");
  requireCondition(receipt.deployment.commitSha === expected.appsSha, "deployment commit SHA mismatch");
  requireCondition(receipt.effect?.status === "PASS", "deploy effect is not PASS");
  assertNoPrivateMaterial(receipt);
  return receipt;
}

export function validateReadbackReceipt(receipt, expected, deployment, artifact) {
  requireCondition(receipt?.kind === "ops.voiceUiReadbackReceipt.v1", "readback receipt kind differs");
  requireCondition(receipt.status === "PASS", "readback receipt is not PASS");
  requireCondition(receipt.opsSha === expected.opsSha, "readback ops SHA mismatch");
  requireCondition(receipt.appsSha === expected.appsSha, "readback apps SHA mismatch");
  requireCondition(normalizeSha256(receipt.artifactManifestSha256) === expected.artifactManifestSha256, "readback artifact digest mismatch");
  requireCondition(receipt.deploymentId === deployment.id, "readback deployment id mismatch");
  requireCondition(receipt.publicBytes?.status === "PASS" && Number.isSafeInteger(receipt.publicBytes.fileCount) && receipt.publicBytes.fileCount > 0, "public byte readback is not PASS");
  const required = artifact.manifest.files.filter(row => row.path.startsWith("site/"));
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
  requireCondition(receipt.function?.status === "PASS" && receipt.function.path === "/api/jev", "Function readback is not PASS");
  assertNoPrivateMaterial(receipt);
  return receipt;
}

export function validateAcceptanceReceipt(receipt, expected, targetUrl, handoffId) {
  requireCondition(receipt?.kind === "voice-ui.runtimeAcceptanceReceipt.v1", "acceptance receipt kind differs");
  requireCondition(receipt.status === "PASS" && receipt.stage === "complete", "acceptance receipt is not complete PASS");
  requireCondition(receipt.handoffId === handoffId, "acceptance handoff id mismatch");
  requireCondition(receipt.sources?.apps === expected.appsSha, "acceptance apps SHA mismatch");
  requireCondition(normalizeSha256(receipt.sources?.artifactManifestSha256) === expected.artifactManifestSha256, "acceptance artifact digest mismatch");
  requireCondition(new URL(receipt.target?.url).href === new URL(targetUrl).href, "acceptance target differs");
  requireCondition(receipt.process?.independentProcess === true && receipt.process.exitCode === 0, "acceptance process proof differs");
  const checks = ["artifact-admission", "secret-free-runtime", "public-application-e2e"];
  requireCondition(Array.isArray(receipt.checks) && receipt.checks.length === checks.length
    && checks.every(id => receipt.checks.filter(row => row.id === id && row.status === "PASS").length === 1),
    "acceptance required checks are missing, duplicated or not PASS");
  requireCondition(Array.isArray(receipt.dependencies?.envsRuntime) && receipt.dependencies.envsRuntime.length === 0, "acceptance depends on envs runtime");
  requireCondition(Array.isArray(receipt.dependencies?.secretInputs) && receipt.dependencies.secretInputs.length === 0, "acceptance received secret inputs");
  assertNoPrivateMaterial(receipt);
  return receipt;
}
