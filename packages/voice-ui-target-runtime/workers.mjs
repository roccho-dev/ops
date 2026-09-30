import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicJson, loadJson, requireCondition as need } from "./modules/core.mjs";
import { validateArtifact, validateWorkersTarget } from "./modules/input-contracts.mjs";

// Production provider base. Never read from the caller; only the offline harness passes another value.
const API = "https://api.cloudflare.com/client/v4";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function targetOf(request) {
  need(request?.kind === "ops.voiceUiEffectRequest.v2", "effect request kind differs");
  const e = request.expected;
  return { e, t: validateWorkersTarget(e?.target) };
}

// The Build Output for `cf deploy --prebuilt`, written by the pinned native library from the admitted bytes and the
// product's declared runtime. Nothing is compiled or bundled here.
async function writeBuildOutput(root, artifact, t, buildOutputUtils) {
  const lib = await import(path.join(buildOutputUtils, "@cloudflare/build-output-utils/dist/index.mjs"));
  const { InputWorkerSchema } = await import(path.join(buildOutputUtils, "@cloudflare/config/dist/index.mjs"));
  const runtime = artifact.manifest.runtime;
  const env = { [runtime.assets.binding]: { type: "assets" } };
  for (const secret of runtime.secrets) env[secret.name] = { type: "secret" };
  const config = InputWorkerSchema.parse({ name: t.workerName, compatibilityDate: runtime.compatibility_date,
    compatibilityFlags: runtime.compatibility_flags, assets: {}, env });
  const main = path.basename(runtime.main_module);
  await lib.writeRootConfig(root, undefined, { isPreview: false, mode: "production" });
  await lib.writeWorkerConfig({ root, config, manifest: { type: "partial", mainModule: main, modules: {} } });
  mkdirSync(lib.getWorkerBundleDir(root), { recursive: true });
  writeFileSync(path.join(lib.getWorkerBundleDir(root), main), readFileSync(path.join(artifact.root, runtime.main_module)));
  await lib.writeAssets({ root, sourceDirectory: path.join(artifact.root, runtime.assets.directory) });
}

export async function deploy(request, { cf, buildOutputUtils, env = process.env, execute = spawnSync, api = API } = {}) {
  const { e, t } = targetOf(request);
  need(path.isAbsolute(cf ?? "") && path.isAbsolute(buildOutputUtils ?? ""), "fixed cf executable and build-output library required");
  need(env.CLOUDFLARE_ACCOUNT_ID === t.accountId && env.CLOUDFLARE_API_TOKEN, "effect authority/target mismatch");
  const artifact = validateArtifact(request.artifactRoot, e.appsSha, e.artifactManifestSha256);
  const workspace = mkdtempSync(path.join(tmpdir(), "voice-ui-deploy-"));
  try {
    const run = (args, cwd, extra = {}) => execute(cf, args, { cwd, encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024,
      env: { PATH: "", HOME: workspace, TMPDIR: workspace, CI: "true", DO_NOT_TRACK: "1", WRANGLER_SEND_METRICS: "false",
        CLOUDFLARE_ACCOUNT_ID: t.accountId, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_API_BASE_URL: api, ...extra } });
    const read = (args, label) => {
      const result = run(args, workspace);
      need(result.status === 0, `${label} failed (${result.status ?? "signal"})`);
      try { return JSON.parse(result.stdout); } catch { throw new Error(`${label} output is not JSON`); }
    };
    // Before any mutating call: the existing Worker lists the required secret NAME. A missing Worker or name fails
    // closed. Presence is not authority, not the value and not projection proof.
    const secrets = read(["workers", "secrets", "list", "--worker", t.workerName], "secret presence preflight");
    for (const { name } of artifact.manifest.runtime.secrets) {
      need(Array.isArray(secrets) && secrets.some(row => row?.name === name), `required secret ${name} is not present on the target Worker; nothing deployed`);
    }
    const root = path.join(workspace, "build"), output = path.join(workspace, "cf-output.jsonl");
    await writeBuildOutput(root, artifact, t, buildOutputUtils);
    const result = run(["deploy", "--prebuilt", "--mode", "production"], root, { WRANGLER_OUTPUT_FILE_PATH: output });
    need(result.status === 0, `fixed deploy command failed (${result.status ?? "signal"}); no receipt`);
    const events = readFileSync(output, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(row => row.type === "deploy");
    need(events.length === 1 && events[0].worker_name === t.workerName, "unambiguous native deploy event required");
    const versionId = events[0].version_id;
    need(/^[A-Za-z0-9-]{1,80}$/.test(versionId ?? ""), "deployed version id invalid");
    // The first listed deployment is the one actively serving; it must be exactly this version at 100%.
    const latest = read(["workers", "deployments", "list", "--worker", t.workerName], "deployment readback")?.deployments?.[0];
    need(latest && /^[A-Za-z0-9-]{1,80}$/.test(latest.id ?? "") && latest.versions?.length === 1
      && latest.versions[0].version_id === versionId && latest.versions[0].percentage === 100,
      "active deployment is not exactly the deployed version at 100%");
    return { kind: "ops.voiceUiDeployReceipt.v2", status: "PASS", opsSha: e.opsSha, appsSha: e.appsSha,
      artifactManifestSha256: e.artifactManifestSha256, target: t,
      preflight: { secrets: artifact.manifest.runtime.secrets.map(s => s.name), presence: "NAME_PRESENT" },
      deployment: { versionId, deploymentId: latest.id, workerName: t.workerName, url: t.url },
      effect: { status: "PASS" } };
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

// Credential-free: every public site byte at the approved URL, and the Worker's invalid-JSON rejection, which the
// Worker only reaches when its secret is present. Provider-stored module bytes cannot be read back with the CLI.
export async function readback(request, { fetcher = fetch, wait = delay } = {}) {
  const { e, t } = targetOf(request), deployment = request.deployment;
  const artifact = validateArtifact(request.artifactRoot, e.appsSha, e.artifactManifestSha256);
  need(deployment?.url === t.url && deployment.workerName === t.workerName, "readback target differs");
  const required = artifact.manifest.files.filter(row => row.path.startsWith(`${artifact.manifest.runtime.assets.directory}/`));
  async function checked(url, options = {}) {
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      let current = new URL(url);
      for (let redirects = 0; redirects <= 4; redirects++) {
        response = await fetcher(current, { ...options, redirect: "manual", signal: AbortSignal.timeout(30000),
          headers: { "Cache-Control": "no-cache", ...options.headers } });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        need(location && redirects < 4, "invalid public redirect");
        const next = new URL(location, current);
        need(next.origin === new URL(url).origin, "cross-origin public redirect forbidden");
        current = next;
      }
      if (response.status < 500) return response;
      if (attempt < 3) await wait(1000 * (attempt + 1));
    }
    return response;
  }
  const observed = [];
  // Bounded concurrency without a queue/framework; fail on any missing/changed byte.
  for (let offset = 0; offset < required.length; offset += 6) {
    observed.push(...await Promise.all(required.slice(offset, offset + 6).map(async row => {
      const relative = row.path.slice(row.path.indexOf("/") + 1), url = new URL(relative === "index.html" ? "" : relative, t.url);
      const response = await checked(url);
      need(response.ok, `public readback HTTP ${response.status}: ${row.path}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      need(bytes.length === row.bytes && sha256 === row.sha256.replace(/^sha256:/, ""), `public bytes differ: ${row.path}`);
      return { path: row.path, bytes: bytes.length, sha256 };
    })));
  }
  const response = await checked(new URL("/api/jev", t.url), { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
  const body = await response.json().catch(() => null);
  need(response.status === 400 && body?.error === "invalid_json", `deployed Worker rejection contract differs (HTTP ${response.status})`);
  return { kind: "ops.voiceUiReadbackReceipt.v2", status: "PASS", opsSha: e.opsSha, appsSha: e.appsSha,
    artifactManifestSha256: e.artifactManifestSha256, versionId: deployment.versionId,
    publicBytes: { status: "PASS", fileCount: required.length, files: observed },
    function: { status: "PASS", path: "/api/jev", response: 400, error: "invalid_json" },
    storedModuleBytes: "NO_CAPABILITY_NOT_RUN" };
}

export async function adapterMain(mode, installed) {
  const args = process.argv.slice(2);
  need(args.length === 4 && args[0] === "--request" && args[2] === "--receipt", "adapter expects --request and --receipt");
  const request = loadJson(args[1]);
  const result = mode === "deploy" ? await deploy(request, installed) : await readback(request);
  atomicJson(args[3], result);
}
