import { spawnSync } from "node:child_process";
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
  admitProduct,
  validateIsolationVerdict,
  validateProjectionReceipt,
  validateWorkersTarget,
} from "./modules/input-contracts.mjs";
import {
  validateDeployReceipt,
  validateReadbackReceipt,
} from "./modules/result-contracts.mjs";

export { SECRET_ENV_NAMES, sha256File } from "./modules/core.mjs";
export { validateProjectionReceipt } from "./modules/input-contracts.mjs";

function assertExecutableIdentity(file, expectedDigest, label) {
  requireCondition(typeof file === "string" && path.isAbsolute(file), `${label} executable path must be absolute`);
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

export function runTargetRuntime(request, options = {}) {
  requireCondition(request?.kind === "ops.voiceUiTargetRuntimeRequest.v2", "request kind differs");
  exactObjectKeys(request, ["kind", "expected", "inputs", "installed", "adapters", "output"], "runtime request");
  exactObjectKeys(request.inputs, ["product", "projectionReceipt", "isolationVerdict"], "runtime inputs");
  exactObjectKeys(request.installed, ["product", "unzip"], "installed runtime data");
  const expected = {
    opsSha: exactSha(request.expected?.opsSha, "expected ops SHA"),
    envsSha: exactSha(request.expected?.envsSha, "expected envs SHA"),
    appsSha: exactSha(request.expected?.appsSha, "expected apps SHA"),
    artifactManifestSha256: normalizeSha256(request.expected?.artifactManifestSha256, "expected artifact manifest digest"),
    projectionReceiptSha256: normalizeSha256(request.expected?.projectionReceiptSha256, "expected projection receipt digest"),
    isolationVerdictSha256: normalizeSha256(request.expected?.isolationVerdictSha256, "expected isolation verdict digest"),
    target: validateWorkersTarget(request.expected?.target),
  };
  const pin = request.installed.product;
  requireCondition(expected.appsSha === pin.proof.merge_sha && expected.artifactManifestSha256 === pin.manifestSha256,
    "approved apps identity differs from the installed product pin");

  requireCondition(sha256File(request.inputs.projectionReceipt) === expected.projectionReceiptSha256, "projection receipt digest mismatch");
  requireCondition(sha256File(request.inputs.isolationVerdict) === expected.isolationVerdictSha256, "isolation verdict digest mismatch");
  const projection = validateProjectionReceipt(loadJson(request.inputs.projectionReceipt, "projection receipt"), expected.envsSha);
  requireCondition(projection.target.account_id === expected.target.accountId, "projection/target account mismatch");
  requireCondition(projection.target.worker_name === expected.target.workerName, "projection/target Worker mismatch");
  const isolation = validateIsolationVerdict(loadJson(request.inputs.isolationVerdict, "isolation verdict"), expected.opsSha);
  // The product operand is admitted once against the installed pin, before any effect capability is read.
  const workdir = mkdtempSync(path.join(tmpdir(), "voice-ui-product-"));
  try {
    const artifact = admitProduct({ directory: request.inputs.product, pin, unzip: request.installed.unzip, workdir });
    return runAdmitted(request, expected, artifact, projection, isolation, options);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function runAdmitted(request, expected, artifact, projection, isolation, options) {

  // Admit every executable and effect target before the first external mutation.
  const env = options.env ?? process.env;
  const credential = effectEnv(env);
  requireCondition(credential.CLOUDFLARE_API_TOKEN, "effect capability is missing");
  requireCondition(credential.CLOUDFLARE_ACCOUNT_ID === expected.target.accountId, "effect account differs from approved target");
  // Only deploy and readback may run. Application acceptance belongs to apps
  // (apps#27) and is never an input, executable or result of this runtime.
  exactObjectKeys(request.adapters, ["deploy", "readback"], "runtime adapters");
  for (const label of ["deploy", "readback"]) {
    const executable = request.adapters?.[label];
    requireCondition(executable, `${label} executable is missing`);
    exactObjectKeys(executable, ["path", "sha256"], `${label} executable`);
    assertExecutableIdentity(executable.path, executable.sha256, label);
  }

  const output = path.resolve(request.output);
  mkdirSync(output, { recursive: true });
  requireCondition(readdirSync(output).length === 0, "output must be empty; prior receipts are not evidence for a new run");
  const deployReceiptPath = path.join(output, "deploy.json");
  const readbackReceiptPath = path.join(output, "readback.json");
  const spawn = options.spawn ?? spawnSync;

  const adapterRequest = {
    kind: "ops.voiceUiEffectRequest.v2",
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

  const result = {
    kind: "ops.voiceUiTargetRuntimeReceipt.v1",
    status: "PASS",
    // Deploy and readback only; application acceptance is not claimed here.
    claim: "DEPLOY_READBACK_PASS",
    sources: {
      opsSha: expected.opsSha,
      envsSha: expected.envsSha,
      appsSha: expected.appsSha,
      artifactManifestSha256: `sha256:${expected.artifactManifestSha256}`,
      productZipSha256: `sha256:${request.installed.product.zip.sha256}`,
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
    },
    // What this receipt cannot prove with the native CLI.
    limits: {
      secretPresence: "NAME_PRESENT_NOT_AUTHORITY",
      inheritPreservation: "NOT_PROVEN",
      storedModuleBytes: "NO_CAPABILITY_NOT_RUN",
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
