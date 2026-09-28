import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicJson, loadJson, normalizedHttps, requireCondition as need, sha256File } from "./modules/core.mjs";
import { validateArtifact } from "./modules/input-contracts.mjs";

const API = "https://api.cloudflare.com/client/v4";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function targetOf(request) {
  need(request?.kind === "ops.voiceUiEffectRequest.v1", "effect request kind differs");
  const e = request.expected, t = e?.target;
  need(t?.provider === "cloudflare-pages" && t.project === "voice-ui" && t.branch === "proposals", "effect target differs");
  need(/^[a-zA-Z0-9_-]{1,64}$/.test(t.accountId ?? ""), "effect account invalid");
  return { e, t };
}
export function stageArtifact(request, directory) {
  const { e } = targetOf(request);
  const artifact = validateArtifact(request.artifactRoot, e.appsSha, e.artifactManifestSha256);
  const rows = artifact.manifest.files.filter(row => row.path.startsWith("site/"));
  const worker = artifact.manifest.files.find(row => row.path === "worker/worker.mjs");
  need(worker && rows.length > 0, "completed app Worker and site are required");
  need(!rows.some(row => /^site\/(?:_worker\.js|functions)(?:\/|$)/.test(row.path)), "reserved deploy entry in public site");
  mkdirSync(directory, { recursive: true });
  for (const row of [...rows, worker]) {
    const relative = row === worker ? "_worker.js" : row.path.slice(5);
    const destination = path.join(directory, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(artifact.root, row.path), destination);
    need(sha256File(destination) === row.sha256.replace(/^sha256:/, ""), "staged bytes differ");
  }
  return artifact;
}

export async function deploy(request, { wrangler, env = process.env, fetcher = fetch, execute = spawnSync, api = API } = {}) {
  const { e, t } = targetOf(request);
  need(path.isAbsolute(wrangler ?? ""), "fixed Wrangler executable required");
  need(env.CLOUDFLARE_ACCOUNT_ID === t.accountId && env.CLOUDFLARE_API_TOKEN, "effect authority/target mismatch");
  const base = `${api}/accounts/${encodeURIComponent(t.accountId)}/pages/projects/${t.project}`;
  async function readApi(url) {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(30000) });
    need(response.ok, `provider readback HTTP ${response.status}`);
    const data = await response.json();
    need(data.success === true && data.result, "provider readback unsuccessful");
    return data.result;
  }
  // envs has already projected to this existing project; never invent a new target.
  const project = await readApi(base);
  need(project.name === t.project && project.production_branch === t.branch, "provider project/production branch differs");
  const workspace = mkdtempSync(path.join(tmpdir(), "voice-ui-deploy-"));
  try {
    const site = path.join(workspace, "site"), output = path.join(workspace, "wrangler.jsonl");
    stageArtifact(request, site);
    const result = execute(wrangler, ["pages", "deploy", site, "--project-name", t.project, "--branch", t.branch,
      "--commit-hash", e.appsSha, "--commit-dirty=false", "--commit-message", "exact voice-ui artifact", "--no-bundle"], {
      cwd: workspace, encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: env.PATH ?? "", HOME: workspace, TMPDIR: workspace, CI: "true", WRANGLER_SEND_METRICS: "false",
        WRANGLER_OUTPUT_FILE_PATH: output, CLOUDFLARE_ACCOUNT_ID: t.accountId, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
        // Never inherited from the caller; production uses the compiled constant.
        CLOUDFLARE_API_BASE_URL: api },
    });
    need(result.status === 0, `fixed deploy command failed (${result.status ?? "signal"}); no receipt`);
    const rows = readFileSync(output, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse)
      .filter(row => row.type === "pages-deploy" && row.version === 1);
    need(rows.length === 1 && rows[0].pages_project === t.project, "unambiguous structured deployment output required");
    const record = rows[0];
    need(/^[a-zA-Z0-9-]{1,80}$/.test(record.deployment_id ?? ""), "deployment id invalid");
    const url = normalizedHttps(record.url, "deployment URL");
    need(new URL(url).hostname.endsWith(`.${t.project}.pages.dev`), "deployment URL not owned by target project");
    const observed = await readApi(`${base}/deployments/${record.deployment_id}`);
    need(observed.id === record.deployment_id && new URL(observed.url).href === url, "deployment readback identity differs");
    need(observed.latest_stage?.name === "deploy" && observed.latest_stage.status === "success", "deployment is not complete success");
    need(observed.environment === "production" && observed.deployment_trigger?.metadata?.commit_hash === e.appsSha,
      "deployment source or environment differs");
    return { kind: "ops.voiceUiDeployReceipt.v1", status: "PASS", opsSha: e.opsSha, appsSha: e.appsSha,
      artifactManifestSha256: e.artifactManifestSha256, target: t,
      deployment: { id: record.deployment_id, url, stableUrl: `https://${t.project}.pages.dev/`, commitSha: e.appsSha },
      effect: { status: "PASS" } };
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

export async function readback(request, { fetcher = fetch, wait = delay } = {}) {
  const { e, t } = targetOf(request), deployment = request.deployment;
  const artifact = validateArtifact(request.artifactRoot, e.appsSha, e.artifactManifestSha256);
  need(deployment?.commitSha === e.appsSha, "readback deployment source differs");
  const stable = normalizedHttps(deployment.stableUrl, "stable URL"), immutable = normalizedHttps(deployment.url, "deployment URL");
  need(stable === `https://${t.project}.pages.dev/` && new URL(immutable).hostname.endsWith(`.${t.project}.pages.dev`), "readback target differs");
  const required = artifact.manifest.files.filter(row => row.path.startsWith("site/"));
  const observedHosts = [];
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
  for (const base of [immutable, stable]) {
    const observed = [];
    // Bounded concurrency without a queue/framework; fail on any missing/changed byte.
    for (let offset = 0; offset < required.length; offset += 6) {
      const part = await Promise.all(required.slice(offset, offset + 6).map(async row => {
        const relative = row.path.slice(5), url = new URL(relative === "index.html" ? "" : relative, base);
        const response = await checked(url);
        need(response.ok, `public readback HTTP ${response.status}: ${row.path}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        need(bytes.length === row.bytes && sha256 === row.sha256.replace(/^sha256:/, ""), `public bytes differ: ${row.path}`);
        return { path: row.path, bytes: bytes.length, sha256 };
      }));
      observed.push(...part);
    }
    const response = await checked(new URL("/api/jev", base), { method: "POST", headers: {"content-type":"application/json"}, body: "not json" });
    need(response.status === 400 && (await response.json()).error === "invalid_json", "deployed Function rejection contract differs");
    observedHosts.push({ url: base, files: observed });
  }
  return { kind: "ops.voiceUiReadbackReceipt.v1", status: "PASS", opsSha: e.opsSha, appsSha: e.appsSha,
    artifactManifestSha256: e.artifactManifestSha256, deploymentId: deployment.id,
    publicBytes: { status: "PASS", fileCount: required.length, files: observedHosts[1].files },
    hosts: observedHosts.map(host => ({url:host.url,status:"PASS",fileCount:host.files.length})),
    function: { status: "PASS", path: "/api/jev" } };
}

export async function adapterMain(mode, wrangler) {
  const args = process.argv.slice(2);
  need(args.length === 4 && args[0] === "--request" && args[2] === "--receipt", "adapter expects --request and --receipt");
  const request = loadJson(args[1]);
  const result = mode === "deploy" ? await deploy(request, {wrangler}) : await readback(request);
  atomicJson(args[3], result);
}
