import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertNoPrivateMaterial,
  exactObjectKeys,
  exactSha,
  loadJson,
  normalizeSha256,
  requireCondition,
  sha256File,
  sha256Bytes,
} from "./core.mjs";

function providerPath(value, label) {
  requireCondition(typeof value === "string" && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)
    && value.split("/").every(part => part !== "." && part !== ".."), `${label} must be a repository-relative evidence path`);
  // Evidence only. The approved receipt digest binds it; consumers never open it.
}

// The non-versioned settings the pinned `cf deploy` writes on the existing Worker with this adapter's Build Output:
// workers.dev on, preview URLs off, observability off, tags emptied. A target must acknowledge exactly these.
export const NATIVE_DEPLOY_SETTINGS = Object.freeze({ workersDev: true, previewUrls: false, observability: { enabled: false }, tags: [] });
const DNS_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";

// One owner for enforced handoff values and their public requirement projection.
// This is a runtime contract, not an envs provision claim or an ADRS identity issuer.
export const PROJECTION_REQUIREMENTS = Object.freeze({
  kind: "envs.projectionReceipt.v1", stage: "dev", capability: "jev-api",
  provider: "cloudflare-workers", slot: "JEV_API_KEY", sourceKind: "public_sops",
  operation: "cloudflare_workers_secret_put", readbackKind: "secret_name_presence",
});


// The approved Workers target: owner-approved data bound by the approved request's digests. It is not authority, not
// a provider-verified route and not an approval of any real Worker. This adapter serves only the Worker's own
// workers.dev origin; a custom domain or any path is refused here, before any provider call.
export function validateWorkersTarget(target) {
  exactObjectKeys(target, ["provider", "accountId", "workerName", "url", "nativeDeploySettings"], "expected target");
  requireCondition(target.provider === PROJECTION_REQUIREMENTS.provider, "expected target provider differs");
  requireCondition(typeof target.accountId === "string" && /^[0-9a-f]{32}$/.test(target.accountId), "expected target account id invalid");
  requireCondition(typeof target.workerName === "string" && new RegExp(`^${DNS_LABEL}$`).test(target.workerName), "expected target Worker name invalid");
  requireCondition(typeof target.url === "string" && new RegExp(`^https://${target.workerName}\\.${DNS_LABEL}\\.workers\\.dev/$`).test(target.url)
    && new URL(target.url).href === target.url, "expected target URL must be exactly https://<workerName>.<label>.workers.dev/");
  requireCondition(isDeepStrictEqual(target.nativeDeploySettings, NATIVE_DEPLOY_SETTINGS),
    "expected target must acknowledge exactly the native deploy settings");
  return target;
}

// Declaration only. The installed wrapper supplies opsSha; its caller supplies the
// independently admitted obligation identity and target. No key, receipt or effect.
export function projectRequirements(target, obligation, opsSha) {
  exactSha(opsSha, "requirement source revision");
  validateWorkersTarget(target);
  exactObjectKeys(obligation, ["id", "obligation_digest", "binding"], "obligation selector");
  assertNoPrivateMaterial(obligation);
  for (const key of ["id", "binding"]) {
    requireCondition(typeof obligation[key] === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,255}$/.test(obligation[key]), "invalid obligation selector");
  }
  const meaning = `sha256:${normalizeSha256(obligation.obligation_digest, "obligation digest")}`;
  const r = PROJECTION_REQUIREMENTS;
  return {
    source: { repository: "roccho-dev/ops", revision: opsSha,
      path: "packages/voice-ui-target-runtime/modules/input-contracts.mjs",
      digest: `sha256:${sha256Bytes(readFileSync(new URL(import.meta.url)))}` },
    rows: [{ id: obligation.id, contract: {
      obligation_digest: meaning, capability: r.capability, consumer: "roccho-dev/ops",
      stage: r.stage, target: { provider: target.provider, resource: target.workerName, account: target.accountId },
      slot: r.slot, binding: obligation.binding,
      profile: [{ role: "projection", operation: r.operation, readback: true, grade: "real" }],
    } }],
  };
}

// ops' expectation of an envs-owned handoff for a Workers target. envs does not produce this shape today, so a real
// run is NOT_CONFIGURED until the envs owner agrees it; secret-name presence read later is never this authority.
export function validateProjectionReceipt(receipt, expectedEnvsSha) {
  exactObjectKeys(receipt, [
    "kind", "status", "envs_sha", "environment", "capability", "source", "target",
    "projector", "effect", "readback", "workflow", "created_at",
  ], "projection receipt");
  requireCondition(receipt.kind === PROJECTION_REQUIREMENTS.kind, "projection receipt kind differs");
  requireCondition(receipt.status === "PASS", "projection receipt is not PASS");
  exactSha(receipt.envs_sha, "projection envs SHA");
  requireCondition(receipt.envs_sha === exactSha(expectedEnvsSha, "expected envs SHA"), "projection envs SHA mismatch");
  requireCondition(receipt.environment === PROJECTION_REQUIREMENTS.stage, "projection environment must be dev");
  requireCondition(receipt.capability === PROJECTION_REQUIREMENTS.capability, "projection capability must be jev-api");

  exactObjectKeys(receipt.source, ["kind", "ref", "sha256"], "projection source");
  requireCondition(receipt.source.kind === PROJECTION_REQUIREMENTS.sourceKind, "projection source kind differs");
  providerPath(receipt.source.ref, "projection source ref");
  normalizeSha256(receipt.source.sha256, "projection ciphertext digest");

  exactObjectKeys(receipt.target, ["provider", "account_id", "worker_name", "secret_name"], "projection target");
  requireCondition(receipt.target.provider === PROJECTION_REQUIREMENTS.provider, "projection target provider differs");
  requireCondition(typeof receipt.target.account_id === "string" && receipt.target.account_id.length > 0, "projection account id missing");
  requireCondition(typeof receipt.target.worker_name === "string" && receipt.target.worker_name.length > 0, "projection Worker name missing");
  requireCondition(receipt.target.secret_name === PROJECTION_REQUIREMENTS.slot, "projection target secret differs");

  exactObjectKeys(receipt.projector, ["workflow", "adapter"], "projection projector");
  providerPath(receipt.projector.workflow, "projection workflow");
  providerPath(receipt.projector.adapter, "projection adapter");
  exactObjectKeys(receipt.effect, ["operation", "status"], "projection effect");
  requireCondition(receipt.effect.operation === PROJECTION_REQUIREMENTS.operation && receipt.effect.status === "PASS", "projection effect is not PASS");
  exactObjectKeys(receipt.readback, ["kind", "status", "present"], "projection readback");
  requireCondition(receipt.readback.kind === PROJECTION_REQUIREMENTS.readbackKind && receipt.readback.status === "PASS" && receipt.readback.present === true, "projection readback is not PASS");

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
  providerPath(relative, label);
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
  requireCondition(manifest.schema === "voice-ui-dist/2", "artifact manifest schema differs");
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

  const actual = [];
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(path.join(directory, name));
      requireCondition(!info.isSymbolicLink(), `artifact symlink forbidden: ${relative}`);
      if (info.isDirectory()) walk(path.join(directory, name), relative);
      else {
        requireCondition(info.isFile(), `artifact entry is not a regular file: ${relative}`);
        if (relative !== "manifest.json") actual.push(relative);
      }
    }
  }
  walk(artifactRoot);
  requireCondition(JSON.stringify(actual.sort()) === JSON.stringify([...rows.keys()].sort()), "artifact has unlisted files");

  for (const field of ["wav", "golden"]) {
    requireCondition(typeof manifest.e2e?.[field] === "string" && rows.has(manifest.e2e[field]), `acceptance ${field} fixture is not bound to artifact closure`);
  }
  const runtimeEntrypoint = manifest.e2e?.runtime_entrypoint;
  requireCondition(typeof runtimeEntrypoint === "string" && rows.has(runtimeEntrypoint), "runtime acceptance entrypoint is not bound to artifact closure");
  const publicEntrypoint = manifest.e2e?.public_entrypoint;
  requireCondition(typeof publicEntrypoint === "string" && rows.has(publicEntrypoint), "public acceptance entrypoint is not bound to artifact closure");
  // The product's declared Worker runtime (apps voice-ui-dist/2): exactly this block, bound to listed files.
  requireCondition(JSON.stringify(manifest.runtime) === JSON.stringify({
    assets: { binding: "ASSETS", directory: "site" }, compatibility_date: "2026-09-01", compatibility_flags: [],
    main_module: "worker/worker.mjs", secrets: [{ capability: PROJECTION_REQUIREMENTS.capability, name: PROJECTION_REQUIREMENTS.slot }],
  }), "declared Worker runtime differs");
  requireCondition(rows.has(manifest.runtime.main_module), "compiled Worker is missing from artifact closure");
  requireCondition([...rows.keys()].some(p => p.startsWith(`${manifest.runtime.assets.directory}/`)), "static assets are missing from artifact closure");

  const authPath = resolveInside(artifactRoot, ".envs/artifact.jsonl", "auth contract path");
  requireCondition(rows.has(".envs/artifact.jsonl"), "auth contract is not bound to artifact closure");
  const authLines = readFileSync(authPath, "utf8").split(/\r?\n/).filter(line => line.trim());
  requireCondition(authLines.length === 1, "auth contract must contain exactly one record");
  const auth = JSON.parse(authLines[0]);
  exactObjectKeys(auth, ["artifact", "kind", "requiredCapabilities"], "artifact auth contract");
  requireCondition(auth.artifact === "voice-ui" && auth.kind === "artifact.auth.v1"
    && JSON.stringify(auth.requiredCapabilities) === JSON.stringify([PROJECTION_REQUIREMENTS.capability]), "artifact auth contract differs");

  return {
    root: artifactRoot,
    manifest,
    manifestPath,
    manifestDigest,
    runtimeEntrypoint: resolveInside(artifactRoot, runtimeEntrypoint, "runtime entrypoint"),
  };
}

const PRODUCT_FILES = ["merged-pr-proof.json", "provenance.json", "voice-ui-dist.zip"];

// Admits the canonical apps PRODUCT operand once, against the installed pin (reviewed data): the exact release zip,
// its merged-PR proof and provenance, all naming one reviewed merge; then unpacks it with the fixed native unzip into
// a fresh directory and validates the manifest, declared runtime and compiled Worker. There is no other admission.
export function admitProduct({ directory, pin, unzip, workdir }) {
  const dir = path.resolve(directory);
  requireCondition(JSON.stringify(readdirSync(dir).sort()) === JSON.stringify(PRODUCT_FILES),
    "product operand must hold exactly the release zip, merged-PR proof and provenance");
  for (const name of PRODUCT_FILES) requireCondition(lstatSync(path.join(dir, name)).isFile(), `product operand entry is not a regular file: ${name}`);
  const zip = path.join(dir, "voice-ui-dist.zip");
  requireCondition(statSync(zip).size === pin.zip.bytes && sha256File(zip) === pin.zip.sha256, "product zip differs from the pinned release");
  requireCondition(sha256File(path.join(dir, "merged-pr-proof.json")) === pin.proofSha256, "merged-PR proof differs from the pinned release");
  requireCondition(sha256File(path.join(dir, "provenance.json")) === pin.provenanceSha256, "provenance differs from the pinned release");
  const proof = loadJson(path.join(dir, "merged-pr-proof.json"), "merged-PR proof");
  const provenance = loadJson(path.join(dir, "provenance.json"), "provenance");
  exactObjectKeys(proof, [...Object.keys(pin.proof), "merged_at"], "merged-PR proof");
  requireCondition(Object.entries(pin.proof).every(([key, value]) => proof[key] === value)
    && proof.reviewed_tree === proof.merge_tree && typeof proof.merged_at === "string" && proof.merged_at, "merged-PR proof differs from the reviewed merge");
  const locator = name => `${pin.base}/${name}`;
  requireCondition(provenance.schema === "roccho.voice-ui-dist.release-provenance/2", "provenance schema differs");
  requireCondition(provenance.source?.repository === "roccho-dev/apps" && provenance.source.commit === proof.merge_sha
    && provenance.source.tree === proof.merge_tree, "provenance source differs from the merged-PR proof");
  requireCondition(provenance.producer?.repository === "roccho-dev/apps"
    && provenance.producer.workflow_ref === "roccho-dev/apps/.github/workflows/voice-ui-release.yml@refs/heads/proposals", "provenance producer differs");
  requireCondition(provenance.artifact?.name === "voice-ui-dist.zip" && provenance.artifact.sha256 === pin.zip.sha256
    && provenance.artifact.bytes === pin.zip.bytes && provenance.locator === locator("voice-ui-dist.zip")
    && provenance.cross_host_bytes_reproducible === false, "provenance artifact differs from the pinned zip");
  const acceptance = provenance.acceptance ?? {};
  requireCondition(acceptance.sha256 === pin.acceptance.sha256 && acceptance.bytes === pin.acceptance.bytes
    && acceptance.root === pin.acceptance.root && acceptance.entry === `${pin.acceptance.root}/${pin.acceptance.entry}`
    && acceptance.closure?.length === pin.acceptance.paths && acceptance.locator === locator("voice-ui-acceptance-runtime.nix-export"),
    "provenance acceptance record differs from the pin");
  requireCondition(path.isAbsolute(unzip ?? ""), "fixed unzip executable required");
  const out = path.join(path.resolve(workdir), "product");
  const unpacked = spawnSync(unzip, ["-q", zip, "-d", out], { encoding: "utf8", env: {}, stdio: ["ignore", "pipe", "pipe"] });
  requireCondition(unpacked.status === 0, "product zip does not unpack");
  requireCondition(JSON.stringify(readdirSync(out)) === '["voice-ui-dist"]', "product zip must hold exactly voice-ui-dist/");
  const artifact = validateArtifact(path.join(out, "voice-ui-dist"), proof.merge_sha, pin.manifestSha256);
  requireCondition(artifact.manifest.files.find(row => row.path === artifact.manifest.runtime.main_module)?.sha256 === pin.workerSha256,
    "compiled Worker differs from the pinned release");
  return artifact;
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
  requireCondition(new Set(verdict.workflows.map(row => row.path)).size === verdict.active, "isolation workflow paths are not unique");
  requireCondition(verdict.workflows.filter(row => row.classification === "secret_bearing_effect").length === verdict.secretBearingEffects, "isolation effect count differs from inventory");
  exactObjectKeys(verdict.inputs, ["checkerSha256", "intentSha256", "boundarySha256", "workflowTreeSha"], "isolation source inputs");
  for (const name of ["checkerSha256", "intentSha256", "boundarySha256"]) normalizeSha256(verdict.inputs[name], "isolation input digest");
  exactSha(verdict.inputs.workflowTreeSha, "isolation workflow tree SHA");
  assertNoPrivateMaterial(verdict);
  return verdict;
}
