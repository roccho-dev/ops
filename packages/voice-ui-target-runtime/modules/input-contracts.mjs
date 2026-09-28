import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  assertNoPrivateMaterial,
  exactObjectKeys,
  exactSha,
  loadJson,
  normalizeSha256,
  requireCondition,
  sha256File,
} from "./core.mjs";

export function validateProjectionReceipt(receipt, expectedEnvsSha) {
  exactObjectKeys(receipt, [
    "kind", "status", "envs_sha", "environment", "capability", "source", "target",
    "projector", "effect", "readback", "workflow", "created_at",
  ], "projection receipt");
  requireCondition(receipt.kind === "envs.projectionReceipt.v1", "projection receipt kind differs");
  requireCondition(receipt.status === "PASS", "projection receipt is not PASS");
  exactSha(receipt.envs_sha, "projection envs SHA");
  requireCondition(receipt.envs_sha === exactSha(expectedEnvsSha, "expected envs SHA"), "projection envs SHA mismatch");
  requireCondition(receipt.environment === "dev", "projection environment must be dev");
  requireCondition(receipt.capability === "jev-api", "projection capability must be jev-api");

  exactObjectKeys(receipt.source, ["kind", "ref", "sha256"], "projection source");
  requireCondition(receipt.source.kind === "public_sops", "projection source kind differs");
  requireCondition(receipt.source.ref === "secrets/jev-api-key.sops.yaml", "projection source ref differs");
  normalizeSha256(receipt.source.sha256, "projection ciphertext digest");

  exactObjectKeys(receipt.target, ["provider", "account_id", "project", "secret_name"], "projection target");
  requireCondition(receipt.target.provider === "cloudflare-pages", "projection target provider differs");
  requireCondition(typeof receipt.target.account_id === "string" && receipt.target.account_id.length > 0, "projection account id missing");
  requireCondition(receipt.target.project === "voice-ui", "projection target project differs");
  requireCondition(receipt.target.secret_name === "JEV_API_KEY", "projection target secret differs");

  exactObjectKeys(receipt.projector, ["workflow", "script"], "projection projector");
  requireCondition(receipt.projector.workflow === ".github/workflows/runtime-secret-projection.yml", "projection workflow identity differs");
  requireCondition(receipt.projector.script === "scripts/runtime-secret-projection.sh", "projection script identity differs");
  exactObjectKeys(receipt.effect, ["operation", "status"], "projection effect");
  requireCondition(receipt.effect.operation === "cloudflare_pages_secret_put" && receipt.effect.status === "PASS", "projection effect is not PASS");
  exactObjectKeys(receipt.readback, ["kind", "status", "present"], "projection readback");
  requireCondition(receipt.readback.kind === "secret_name_presence" && receipt.readback.status === "PASS" && receipt.readback.present === true, "projection readback is not PASS");

  exactObjectKeys(receipt.workflow, ["repository", "ref", "run_id", "run_attempt"], "projection workflow");
  requireCondition(receipt.workflow.repository === "roccho-dev/envs", "projection workflow repository differs");
  requireCondition(receipt.workflow.ref === "proposals", "projection workflow ref differs");
  requireCondition(Number.isSafeInteger(receipt.workflow.run_id) && receipt.workflow.run_id > 0, "projection run id invalid");
  requireCondition(Number.isSafeInteger(receipt.workflow.run_attempt) && receipt.workflow.run_attempt > 0, "projection run attempt invalid");
  requireCondition(typeof receipt.created_at === "string" && !Number.isNaN(Date.parse(receipt.created_at)), "projection timestamp invalid");
  assertNoPrivateMaterial(receipt);
  return receipt;
}

function resolveInside(root, relative, label) {
  requireCondition(typeof relative === "string" && relative.length > 0, `${label} is required`);
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relative);
  requireCondition(resolved === absoluteRoot || resolved.startsWith(`${absoluteRoot}${path.sep}`), `${label} escapes artifact root`);
  return resolved;
}

export function validateArtifact(root, expectedAppsSha, expectedManifestSha256) {
  const artifactRoot = path.resolve(root);
  const manifestPath = path.join(artifactRoot, "manifest.json");
  const manifestDigest = sha256File(manifestPath);
  requireCondition(manifestDigest === normalizeSha256(expectedManifestSha256, "expected artifact manifest digest"), "artifact manifest digest mismatch");
  const manifest = loadJson(manifestPath, "artifact manifest");
  requireCondition(manifest.schema === "voice-ui-dist/1", "artifact manifest schema differs");
  requireCondition(manifest.sources?.apps === exactSha(expectedAppsSha, "expected apps SHA"), "artifact apps SHA mismatch");
  requireCondition(Array.isArray(manifest.files) && manifest.files.length > 0, "artifact file closure missing");

  const rows = new Map();
  for (const row of manifest.files) {
    exactObjectKeys(row, ["path", "bytes", "sha256"], "artifact file row");
    requireCondition(!rows.has(row.path), `duplicate artifact path: ${row.path}`);
    requireCondition(Number.isSafeInteger(row.bytes) && row.bytes >= 0, `invalid artifact bytes: ${row.path}`);
    const expected = normalizeSha256(row.sha256, `artifact digest ${row.path}`);
    const file = resolveInside(artifactRoot, row.path, "artifact path");
    requireCondition(statSync(file).isFile(), `artifact file missing: ${row.path}`);
    requireCondition(statSync(file).size === row.bytes, `artifact byte mismatch: ${row.path}`);
    requireCondition(sha256File(file) === expected, `artifact digest mismatch: ${row.path}`);
    rows.set(row.path, row);
  }

  const runtimeEntrypoint = manifest.e2e?.runtime_entrypoint;
  requireCondition(typeof runtimeEntrypoint === "string" && rows.has(runtimeEntrypoint), "runtime acceptance entrypoint is not bound to artifact closure");
  const publicEntrypoint = manifest.e2e?.public_entrypoint;
  requireCondition(typeof publicEntrypoint === "string" && rows.has(publicEntrypoint), "public acceptance entrypoint is not bound to artifact closure");
  requireCondition(rows.has("functions/api/jev.mjs"), "Jev Function is missing from artifact closure");

  const authPath = resolveInside(artifactRoot, ".envs/artifact.jsonl", "auth contract path");
  requireCondition(rows.has(".envs/artifact.jsonl"), "auth contract is not bound to artifact closure");
  const authLines = readFileSync(authPath, "utf8").split(/\r?\n/).filter(line => line.trim());
  requireCondition(authLines.length === 1, "auth contract must contain exactly one record");
  const auth = JSON.parse(authLines[0]);
  requireCondition(JSON.stringify(auth) === JSON.stringify({
    artifact: "voice-ui",
    kind: "artifact.auth.v1",
    requiredCapabilities: ["jev-api"],
  }), "artifact auth contract differs");

  return {
    root: artifactRoot,
    manifest,
    manifestPath,
    manifestDigest,
    runtimeEntrypoint: resolveInside(artifactRoot, runtimeEntrypoint, "runtime entrypoint"),
  };
}

export function validateIsolationVerdict(verdict, expectedOpsSha) {
  requireCondition(verdict?.kind === "ops.secretEffectBoundary.check.v1", "isolation verdict kind differs");
  requireCondition(verdict.status === "PASS", "isolation verdict is not PASS");
  requireCondition(verdict.opsSha === exactSha(expectedOpsSha, "expected ops SHA"), "isolation ops SHA mismatch");
  requireCondition(verdict.unclassified === 0, "isolation verdict has unclassified workflows");
  requireCondition(Number.isSafeInteger(verdict.active) && verdict.active > 0, "isolation active workflow count invalid");
  requireCondition(Number.isSafeInteger(verdict.secretBearingEffects) && verdict.secretBearingEffects >= 0, "isolation effect count invalid");
  requireCondition(Array.isArray(verdict.workflows) && verdict.workflows.length === verdict.active, "isolation workflow inventory differs");
  for (const row of verdict.workflows) {
    requireCondition(row && typeof row.path === "string", "isolation workflow path missing");
    requireCondition(["secret_free_verify", "secret_bearing_effect"].includes(row.classification), "isolation classification invalid");
  }
  assertNoPrivateMaterial(verdict);
  return verdict;
}
