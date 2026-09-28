import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SECRET_ENV_NAMES,
  atomicJson,
  effectEnv,
  exactObjectKeys,
  exactSha,
  loadJson,
  normalizeSha256,
  requireCondition,
  sanitizedEnv,
  sha256File,
} from "./modules/core.mjs";
import {
  validateArtifact,
  validateIsolationVerdict,
  validateProjectionReceipt,
} from "./modules/input-contracts.mjs";
import {
  validateAcceptanceReceipt,
  validateDeployReceipt,
  validateReadbackReceipt,
} from "./modules/result-contracts.mjs";

export { SECRET_ENV_NAMES, sha256File } from "./modules/core.mjs";
export { validateProjectionReceipt } from "./modules/input-contracts.mjs";

function assertExecutableIdentity(file, expectedDigest, label) {
  requireCondition(statSync(file).isFile(), `${label} is missing`);
  requireCondition(sha256File(file) === normalizeSha256(expectedDigest, `${label} digest`), `${label} digest mismatch`);
}

function executeAdapter({ adapter, expectedDigest, request, receiptPath, env, spawn = spawnSync, label }) {
  assertExecutableIdentity(adapter, expectedDigest, label);
  const directory = mkdtempSync(path.join(tmpdir(), `voice-ui-${label}-`));
  const requestPath = path.join(directory, "request.json");
  try {
    atomicJson(requestPath, request);
    const result = spawn(process.execPath, [adapter, "--request", requestPath, "--receipt", receiptPath], {
      cwd: directory,
      env: { ...env, HOME: directory, TMPDIR: directory },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    requireCondition(result.status === 0, `${label} adapter failed with exit ${result.status ?? "signal"}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function executeAcceptance({ artifact, expected, targetUrl, handoffId, receiptPath, env, spawn = spawnSync }) {
  const workspace = mkdtempSync(path.join(tmpdir(), "voice-ui-acceptance-run-"));
  try {
    const result = spawn(process.execPath, [
      artifact.runtimeEntrypoint,
      "--artifact-root", artifact.root,
      "--url", targetUrl,
      "--expected-apps-sha", expected.appsSha,
      "--expected-manifest-sha256", expected.artifactManifestSha256,
      "--handoff-id", handoffId,
      "--receipt", receiptPath,
    ], {
      cwd: workspace,
      env: { ...sanitizedEnv(env), HOME: workspace, TMPDIR: workspace },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    requireCondition(result.status === 0, `application acceptance failed with exit ${result.status ?? "signal"}`);
    return { workspaceId: path.basename(workspace) };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function runTargetRuntime(request, options = {}) {
  requireCondition(request?.kind === "ops.voiceUiTargetRuntimeRequest.v1", "request kind differs");
  exactObjectKeys(request, ["kind", "expected", "inputs", "adapters", "output"], "runtime request");
  const expected = {
    opsSha: exactSha(request.expected?.opsSha, "expected ops SHA"),
    envsSha: exactSha(request.expected?.envsSha, "expected envs SHA"),
    appsSha: exactSha(request.expected?.appsSha, "expected apps SHA"),
    artifactManifestSha256: normalizeSha256(request.expected?.artifactManifestSha256, "expected artifact manifest digest"),
    projectionReceiptSha256: normalizeSha256(request.expected?.projectionReceiptSha256, "expected projection receipt digest"),
    isolationVerdictSha256: normalizeSha256(request.expected?.isolationVerdictSha256, "expected isolation verdict digest"),
    target: request.expected?.target,
  };
  exactObjectKeys(expected.target, ["provider", "accountId", "project", "branch"], "expected target");
  requireCondition(expected.target.provider === "cloudflare-pages", "expected target provider differs");
  requireCondition(typeof expected.target.accountId === "string" && expected.target.accountId.length > 0, "expected target account id missing");
  requireCondition(expected.target.project === "voice-ui", "expected target project differs");
  requireCondition(expected.target.branch === "proposals", "expected target branch differs");

  const artifact = validateArtifact(request.inputs.artifactRoot, expected.appsSha, expected.artifactManifestSha256);
  requireCondition(sha256File(request.inputs.projectionReceipt) === expected.projectionReceiptSha256, "projection receipt digest mismatch");
  requireCondition(sha256File(request.inputs.isolationVerdict) === expected.isolationVerdictSha256, "isolation verdict digest mismatch");
  const projection = validateProjectionReceipt(loadJson(request.inputs.projectionReceipt, "projection receipt"), expected.envsSha);
  requireCondition(projection.target.account_id === expected.target.accountId, "projection/target account mismatch");
  const isolation = validateIsolationVerdict(loadJson(request.inputs.isolationVerdict, "isolation verdict"), expected.opsSha);

  // Admit every executable and effect target before the first external mutation.
  const env = options.env ?? process.env;
  const credential = effectEnv(env);
  requireCondition(credential.CLOUDFLARE_API_TOKEN, "effect capability is missing");
  requireCondition(credential.CLOUDFLARE_ACCOUNT_ID === expected.target.accountId, "effect account differs from approved target");
  for (const label of ["deploy", "readback"]) {
    assertExecutableIdentity(request.adapters[label].path, request.adapters[label].sha256, label);
    requireCondition(path.isAbsolute(request.adapters[label].path), `${label} adapter path must be absolute`);
  }

  const output = path.resolve(request.output);
  mkdirSync(output, { recursive: true });
  requireCondition(readdirSync(output).length === 0, "output must be empty; prior receipts are not evidence for a new run");
  const deployReceiptPath = path.join(output, "deploy.json");
  const readbackReceiptPath = path.join(output, "readback.json");
  const acceptancePaths = [path.join(output, "acceptance-1.json"), path.join(output, "acceptance-2.json")];
  const spawn = options.spawn ?? spawnSync;

  const adapterRequest = {
    kind: "ops.voiceUiEffectRequest.v1",
    expected,
    artifactRoot: artifact.root,
    projection: {
      receiptSha256: sha256File(request.inputs.projectionReceipt),
      ciphertextSha256: projection.source.sha256,
    },
  };
  executeAdapter({
    adapter: request.adapters.deploy.path,
    expectedDigest: request.adapters.deploy.sha256,
    request: adapterRequest,
    receiptPath: deployReceiptPath,
    env: credential,
    spawn,
    label: "deploy",
  });
  const deployReceipt = validateDeployReceipt(loadJson(deployReceiptPath, "deploy receipt"), expected);

  executeAdapter({
    adapter: request.adapters.readback.path,
    expectedDigest: request.adapters.readback.sha256,
    request: { ...adapterRequest, deployment: deployReceipt.deployment },
    receiptPath: readbackReceiptPath,
    env: sanitizedEnv(env),
    spawn,
    label: "readback",
  });
  const readbackReceipt = validateReadbackReceipt(loadJson(readbackReceiptPath, "readback receipt"), expected, deployReceipt.deployment, artifact);

  const acceptance = [];
  const runToken = randomUUID();
  for (let index = 0; index < 2; index += 1) {
    const handoffId = `dev/jev-api/${runToken}/run-${index + 1}`;
    const processProof = executeAcceptance({
      artifact,
      expected,
      targetUrl: deployReceipt.deployment.stableUrl,
      handoffId,
      receiptPath: acceptancePaths[index],
      env,
      spawn,
    });
    const receipt = validateAcceptanceReceipt(loadJson(acceptancePaths[index], `acceptance ${index + 1}`), expected, deployReceipt.deployment.stableUrl, handoffId);
    acceptance.push({
      run: index + 1,
      handoffId,
      workspaceId: processProof.workspaceId,
      receiptSha256: `sha256:${sha256File(acceptancePaths[index])}`,
      status: receipt.status,
    });
  }
  requireCondition(acceptance[0].workspaceId !== acceptance[1].workspaceId, "acceptance workspaces are not independent");
  requireCondition(acceptance[0].receiptSha256 !== acceptance[1].receiptSha256, "acceptance receipts are not independent");

  const result = {
    kind: "ops.voiceUiTargetRuntimeReceipt.v1",
    status: "PASS",
    claim: "NEW_PROJECTION_REAL_USE_PROVEN",
    sources: {
      opsSha: expected.opsSha,
      envsSha: expected.envsSha,
      appsSha: expected.appsSha,
      artifactManifestSha256: `sha256:${expected.artifactManifestSha256}`,
      projectionReceiptSha256: `sha256:${sha256File(request.inputs.projectionReceipt)}`,
      isolationVerdictSha256: `sha256:${sha256File(request.inputs.isolationVerdict)}`,
      deployAdapterSha256: `sha256:${normalizeSha256(request.adapters.deploy.sha256)}`,
      readbackAdapterSha256: `sha256:${normalizeSha256(request.adapters.readback.sha256)}`,
    },
    target: expected.target,
    stages: {
      isolation: isolation.status,
      projection: projection.status,
      deploy: deployReceipt.status,
      readback: readbackReceipt.status,
      acceptance,
    },
    dependencies: {
      envsRuntime: [],
      envctl: false,
      authExec: false,
      authBundle: false,
      sops: false,
      ageIdentity: false,
    },
    completedAt: options.completedAt ?? new Date().toISOString(),
  };
  atomicJson(path.join(output, "receipt.json"), result);
  return result;
}
