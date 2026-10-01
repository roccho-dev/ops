// The Workers deploy check and the fresh-consumer gate program: one loopback provider fixture that records every
// request, an account and token that were never issued, and the installed runtime's own cf, adapters and entries.
// C3/C4 characterise the pinned `cf deploy --prebuilt` with an explicitly NON_PRODUCT Worker config. The installed
// stage then runs the installed runtime (INSTALLED_ADAPTER_LOOPBACK_HARNESS): its lib through the private spawn seam
// and its workers.mjs with the loopback api/fetcher options, which no request or environment field can set.
// Usage: node workers.test.mjs --runtime <installed runtime> --product <release zip/proof/provenance directory>
//          [--acceptance-node <ACCEPTANCE runtime entry>] [--require-isolation]
// With --require-isolation (the Nix check and the gate) it fails before any request unless the kernel shows a
// loopback-only network namespace. Run directly without it, the result is graded UNISOLATED.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
// The two harness children: `--run` calls the installed lib, `--adapter` runs the installed workers.mjs.
if (process.argv[2] === "--run" || process.argv[2] === "--adapter") {
  await harnessChild(process.argv[2], process.argv.slice(3));
  process.exit();
}
const option = (name) => { const i = process.argv.indexOf(name); return i > 1 ? process.argv[i + 1] : undefined; };
const runtimeRoot = option("--runtime"), product = option("--product"), acceptanceNode = option("--acceptance-node");
const requireIsolation = process.argv.includes("--require-isolation");
assert.ok(runtimeRoot && product && path.isAbsolute(runtimeRoot) && path.isAbsolute(product),
  "usage: workers.test.mjs --runtime <root> --product <dir> [--acceptance-node <bin>] [--require-isolation]");
const share = path.join(runtimeRoot, "share/voice-ui-target-runtime");
const installed = JSON.parse(fs.readFileSync(path.join(share, "configuration.json"), "utf8"));
const cfBin = installed.cf, nodeModules = installed.buildOutputUtils;

// Kernel evidence of isolation: the only interface is lo, and a connect to a TEST-NET-1 literal (RFC 5737, never
// routed publicly; no service or credential involved) fails with ENETUNREACH instead of being routed.
const interfaces = fs.readFileSync("/proc/net/dev", "utf8").split("\n").slice(2).map((l) => l.split(":")[0].trim()).filter(Boolean).sort();
const connectError = await new Promise((ok) => {
  const s = net.connect({ host: "192.0.2.1", port: 9, timeout: 3000 });
  s.on("connect", () => { s.destroy(); ok("CONNECTED"); });
  s.on("timeout", () => { s.destroy(); ok("TIMEOUT"); });
  s.on("error", (e) => ok(e.code));
});
const isolation = { interfaces, connect_192_0_2_1: connectError,
  grade: interfaces.join(",") === "lo" && connectError === "ENETUNREACH" ? "ISOLATED" : "UNISOLATED" };
if (requireIsolation) assert.equal(isolation.grade, "ISOLATED", `network is not loopback-only: ${JSON.stringify(isolation)}`);
// The canonical PRODUCT operand, admitted by the installed runtime's own admission against its installed pin.
const { admitProduct } = await import(path.join(share, "modules/input-contracts.mjs"));
const admitted = admitProduct({ directory: product, pin: installed.product, unzip: installed.unzip,
  workdir: fs.mkdtempSync(path.join(os.tmpdir(), "cf-product-")) });
const artifact = admitted.root;
const { writeAssets, writeRootConfig, writeWorkerConfig, getWorkerBundleDir, readBuildOutput } =
  await import(path.join(nodeModules, "@cloudflare/build-output-utils/dist/index.mjs"));
const { InputWorkerSchema } = await import(path.join(nodeModules, "@cloudflare/config/dist/index.mjs"));

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const FIXTURE = "NON_PRODUCT";
const ACCOUNT = "0".repeat(31) + "1";
const TOKEN = `never-issued-${crypto.randomBytes(12).toString("hex")}`;
const SENTINEL = `planted-dotenv-${crypto.randomBytes(12).toString("hex")}`;
const workerBytes = fs.readFileSync(path.join(artifact, "worker/worker.mjs"));
const site = path.join(artifact, "site");

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
  }).sort();
}

// The Build Output, written by the pinned native library from the unchanged admitted bytes.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-checkpoint-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cf-home-"));
const config = InputWorkerSchema.parse({
  name: "voice-ui-nonproduct-fixture", compatibilityDate: "2026-09-01", compatibilityFlags: [], assets: {},
  env: { ASSETS: { type: "assets" }, JEV_API_KEY: { type: "secret" } },
});
await writeRootConfig(root, undefined, { isPreview: false, mode: "production" });
await writeWorkerConfig({ root, config, manifest: { type: "partial", mainModule: "worker.mjs", modules: {} } });
fs.mkdirSync(getWorkerBundleDir(root), { recursive: true });
fs.writeFileSync(path.join(getWorkerBundleDir(root), "worker.mjs"), workerBytes);
await writeAssets({ root, sourceDirectory: site });
const parsed = await readBuildOutput(root);
assert.equal(parsed.rootConfig.buildContext.mode, "production");
assert.equal(sha256(fs.readFileSync(path.join(parsed.workers.default.bundleDir, "worker.mjs"))), sha256(workerBytes));
assert.deepEqual(listFiles(parsed.workers.default.assetsDir), listFiles(site));
// Ambient credentials a consumer might leave around; cf must never use them.
fs.writeFileSync(path.join(root, ".env"), `CLOUDFLARE_API_TOKEN=${SENTINEL}\nCLOUDFLARE_ACCOUNT_ID=${SENTINEL}\nJEV_API_KEY=${SENTINEL}\n`);

// Loopback provider fixture: records every request; answers only the endpoints a Workers deploy with assets needs.
// `existing` switches it to a Worker that already exists (for the preset-secret case). Captures reset per deploy.
// The never-issued Jev fixture value C4b supplies; every request records whether it carries it.
const fixtureSecret = `never-issued-secret-${crypto.randomBytes(12).toString("hex")}`;
const requests = [];
let versionId = null;
let existing = false;
let presetSecret = true;
let uploadedModules = {};
let assetManifest = null;
let uploadedAssets = new Map();
const resetCaptures = () => { versionId = null; uploadedModules = {}; assetManifest = null; uploadedAssets = new Map(); };
// Installed stage: the deployment the fixture reports as active, the fixture phase, and what reached the site.
let activeDeployment = null;
let phase = null;
// What the fixture's `GET worker` reports. It starts unlike the acknowledged settings, so the post-deploy readback
// passes only when the CLI's own settings writes arrived. `metaFault` and `secretType` drive the negatives.
const ORIGIN = "https://voice-ui-nonproduct-fixture.never-issued-fixture.workers.dev";
let workerMeta = null, metaFault = null, secretType = "secret_text", subdomainWritten = false;
const resetWorkerMeta = () => { metaFault = null; secretType = "secret_text"; subdomainWritten = false;
  workerMeta = { id: "fixture-worker-id", name: "voice-ui-nonproduct-fixture", tags: ["fixture-preexisting"], observability: { enabled: true },
    subdomain: { enabled: false, previews_enabled: true, url: ORIGIN } }; };
const siteRequests = [];
const violations = [];
// Never-issued fixture value, only ever the Worker's JEV_API_KEY in PRESET_SECRET_FIXTURE; valid JSON is refused there.
const fixtureJevValue = `never-issued-jev-${crypto.randomBytes(12).toString("hex")}`;
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".md": "text/plain; charset=utf-8" };
let worker = null;
// FIXTURE_SERVED: the site is answered by executing the uploaded Worker module, with ASSETS serving the uploaded asset
// bytes by manifest path. Every provider-bound fetch from the Worker is counted and refused.
async function serveSite(req, res, body) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const moduleBytes = uploadedModules["worker.mjs"];
  if (!moduleBytes || !assetManifest) { res.writeHead(503); return res.end(); }
  const digest = sha256(moduleBytes);
  if (worker?.digest !== digest) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uploaded-worker-")), `worker-${digest}.mjs`);
    fs.writeFileSync(file, moduleBytes);
    worker = { digest, module: (await import(pathToFileURL(file))).default };
  }
  const row = { phase, method: req.method, path: url.pathname, origin: req.headers.origin ?? null, fetchSite: req.headers["sec-fetch-site"] ?? null };
  if (url.pathname === "/api/jev" && phase === "PRESET_SECRET_FIXTURE") {
    let json = true;
    try { JSON.parse(body.toString()); } catch { json = false; }
    if (json) { violations.push("valid JSON reached /api/jev while the fixture secret was set"); res.writeHead(409); return res.end(); }
  }
  const headers = new Headers();
  for (const name of ["content-type", "origin", "sec-fetch-site", "accept"]) if (typeof req.headers[name] === "string") headers.set(name, req.headers[name]);
  const assets = { fetch(request) {
    const pathname = new URL(request.url).pathname, key = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
    const bytes = assetManifest[key] && uploadedAssets.get(assetManifest[key].hash);
    return bytes ? new Response(bytes, { headers: { "content-type": TYPES[path.extname(key)] ?? "application/octet-stream" } })
      : new Response("not found", { status: 404 });
  } };
  const env = { ASSETS: assets, ...(phase === "PRESET_SECRET_FIXTURE" ? { JEV_API_KEY: fixtureJevValue } : {}) };
  const response = await worker.module.fetch(new Request(url, { method: req.method, headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
  if (url.pathname === "/api/jev") siteRequests.push({ ...row, status: response.status });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
function multipart(req, body) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers["content-type"] ?? "");
  const parts = {};
  for (const part of body.toString("latin1").split(`--${boundary?.[1] ?? boundary?.[2]}`).slice(1, -1)) {
    const split = part.indexOf("\r\n\r\n");
    const name = /name="([^"]+)"/.exec(part.slice(0, split))?.[1];
    if (name) parts[name] = Buffer.from(part.slice(split + 4, part.length - 2), "latin1");
  }
  return parts;
}
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://127.0.0.1");
    if (!url.pathname.startsWith("/client/v4/")) {
      return serveSite(req, res, body).catch((error) => { violations.push(`site: ${error.message}`); res.writeHead(500); res.end(); });
    }
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, bytes: body.length,
      json: req.method !== "GET" && String(req.headers["content-type"] ?? "").includes("application/json") ? JSON.parse(body.toString()) : undefined,
      sentinel: body.includes(SENTINEL) || String(req.headers.authorization ?? "").includes(SENTINEL),
      fixture_secret: body.includes(fixtureSecret) || req.url.includes(fixtureSecret) });
    const reply = (status, result, code = 10000 + status) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status < 400 ? { success: true, errors: [], messages: [], result }
        : { success: false, errors: [{ code, message: `fixture: ${req.method} ${url.pathname}` }], messages: [], result: null }));
    };
    const p = url.pathname.replace(/^\/client\/v4/, "");
    const script = `/accounts/${ACCOUNT}/workers/scripts/voice-ui-nonproduct-fixture`;
    if (req.method === "POST" && p === `${script}/assets-upload-session`) {
      assetManifest = JSON.parse(body.toString()).manifest;
      return reply(200, { jwt: "fixture-upload-jwt", buckets: [Object.values(assetManifest).map((m) => m.hash)] });
    }
    if (req.method === "POST" && p === `/accounts/${ACCOUNT}/workers/assets/upload`) {
      const base64 = url.searchParams.get("base64") === "true";
      for (const [hash, value] of Object.entries(multipart(req, body)))
        uploadedAssets.set(hash, base64 ? Buffer.from(value.toString("latin1"), "base64") : value);
      return reply(201, { jwt: "fixture-completion-jwt" });
    }
    // An existing Worker is updated as a new version, then deployed at 100%.
    if (existing && req.method === "POST" && p === `${script}/versions`) {
      uploadedModules = multipart(req, body);
      versionId = crypto.randomUUID();
      return reply(200, { id: versionId, number: 2, metadata: {}, resources: { bindings: [], script: { etag: "fixture" },
        script_runtime: { usage_model: "standard" } }, startup_time_ms: 1 });
    }
    if (existing && req.method === "POST" && p === `${script}/deployments`) {
      activeDeployment = { id: `fixture-deployment-${crypto.randomUUID()}`, source: "wrangler", strategy: "percentage",
        versions: [{ version_id: versionId, percentage: 100 }] };
      return reply(200, activeDeployment);
    }
    // Secret names only, never values: the preflight the installed adapter runs before any mutating call.
    if (existing && req.method === "GET" && p === `${script}/secrets`)
      return reply(200, presetSecret ? [{ name: "JEV_API_KEY", type: secretType }] : []);
    // Installed stage: the Worker's provider-reported metadata, changed only by the settings writes the CLI makes.
    if (phase && req.method === "GET" && p === `/accounts/${ACCOUNT}/workers/workers/voice-ui-nonproduct-fixture`)
      return reply(200, metaFault === "missing-after-deploy" && subdomainWritten ? { id: workerMeta.id, name: workerMeta.name } : workerMeta);
    if (phase && req.method === "PATCH" && p === `${script}/script-settings`) {
      if (metaFault === "settings-write-fails") return reply(403, null);
      const sent = JSON.parse(body.toString());
      workerMeta.observability = sent.observability;
      workerMeta.tags = sent.tags;
      return reply(200, {});
    }
    if (phase && req.method === "POST" && p === `${script}/subdomain`) {
      const sent = JSON.parse(body.toString());
      Object.assign(workerMeta.subdomain, { enabled: sent.enabled, previews_enabled: sent.previews_enabled });
      subdomainWritten = true;
      return reply(200, { enabled: sent.enabled, previews_enabled: sent.previews_enabled });
    }
    if (req.method === "PUT" && (p === script || p === `${script}/versions`)) {
      uploadedModules = multipart(req, body);
      versionId = crypto.randomUUID();
      return reply(200, { id: "voice-ui-nonproduct-fixture", etag: "fixture", deployment_id: versionId,
        startup_time_ms: 1, has_modules: true, has_assets: true, placement_mode: null });
    }
    if (req.method === "GET" && p === `/accounts/${ACCOUNT}/workers/subdomain`) return reply(200, { subdomain: "fixture" });
    if (p === `${script}/subdomain`) return reply(200, { enabled: false, previews_enabled: false });
    // The Worker's own record, read after upload for its workers.dev state (kept disabled).
    if (req.method === "GET" && p === `/accounts/${ACCOUNT}/workers/workers/voice-ui-nonproduct-fixture` && versionId)
      return reply(200, { name: "voice-ui-nonproduct-fixture", subdomain: { enabled: false, previews_enabled: false } });
    // An existing Worker whose JEV_API_KEY secret was preset earlier; the fixture never holds or returns a value.
    if (existing && req.method === "GET" && p === `/accounts/${ACCOUNT}/workers/services/voice-ui-nonproduct-fixture`)
      return reply(200, { id: "voice-ui-nonproduct-fixture", default_environment: { environment: "production",
        script: { id: "voice-ui-nonproduct-fixture", tag: "fixture-tag", etag: "fixture", last_deployed_from: "wrangler" } } });
    if (existing && req.method === "GET" && p === `${script}/settings`)
      return reply(200, { bindings: [...(presetSecret ? [{ name: "JEV_API_KEY", type: "secret_text" }] : []), { name: "ASSETS", type: "assets" }],
        compatibility_date: "2026-09-01", compatibility_flags: [] });
    if (existing && req.method === "GET" && p === `${script}/deployments`)
      return reply(200, { deployments: [activeDeployment ?? { id: "fixture-deployment", source: "wrangler", strategy: "percentage",
        versions: [{ version_id: "fixture-preset-version", percentage: 100 }] }] });
    // A script that does not exist yet, as the provider reports it (workers.api.error.script_not_found).
    if (req.method === "GET" && p.startsWith(`${script}`)) return reply(404, null, 10007);
    // A Worker that does not exist yet, as the provider reports it (workers.api.error.service_not_found).
    if (req.method === "GET" && p.startsWith(`/accounts/${ACCOUNT}/workers/services/`)) return reply(404, null, 10090);
    return reply(404, null);
  });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/client/v4`;

function cf(args, extra) {
  return new Promise((ok) => {
    const child = spawn(cfBin, ["deploy", "--prebuilt", "--mode", "production", ...args], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/nonexistent", HOME: home, CI: "true", CLOUDFLARE_API_BASE_URL: base, ...extra },
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (code, signal) => ok({ code, signal, out }));
  });
}
const receipt = { fixture: FIXTURE, cf: cfBin, artifact, isolation, worker_sha256: sha256(workerBytes), site_files: listFiles(site).length };

// C3: genuine prebuilt dry run: exit 0, no request at all, no ambient credential echoed.
const c3 = await cf(["--dry-run"], {});
receipt.c3 = { exit: c3.code, signal: c3.signal, requests: requests.length, sentinel_in_output: c3.out.includes(SENTINEL) };
assert.equal(c3.code, 0, `C3 dry run failed:\n${c3.out}`);
assert.equal(requests.length, 0, `C3 dry run sent requests: ${JSON.stringify(requests)}`);
assert.ok(!c3.out.includes(SENTINEL), "C3 printed the planted .env value");

// C4: genuine prebuilt deploys against the loopback fixture only, with the never-issued account and token.
const creds = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
const authOk = (rs) => rs.every((r) => r.auth === null || r.auth === `Bearer ${TOKEN}` || r.auth.startsWith("Bearer fixture-"));
// C4a: a new Worker that declares the JEV_API_KEY secret is refused without an explicit secret value; the planted
// .env is not a source of it, and no script is uploaded.
const c4a = await cf([], creds);
receipt.c4a = { exit: c4a.code, refused_missing_secret: /required secrets have not been set: JEV_API_KEY/.test(c4a.out),
  script_uploaded: versionId !== null, sentinel_seen_by_provider: requests.some((r) => r.sentinel), sentinel_in_output: c4a.out.includes(SENTINEL),
  auth_only_fixture_token: authOk(requests) };
// C4b: the same deploy with an explicit secrets file holding a never-issued fixture value.
const secretsFile = path.join(home, "fixture-secrets.json");
fs.writeFileSync(secretsFile, JSON.stringify({ JEV_API_KEY: fixtureSecret }));
const before = requests.length;
resetCaptures();
const outputFile = path.join(home, "cf-output.jsonl");
const c4b = await cf(["--secrets-file", secretsFile], { ...creds, WRANGLER_OUTPUT_FILE_PATH: outputFile });
const events = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const deploy = events.find((e) => e.type === "deploy") ?? null;
const c4bRequests = requests.slice(before);
const c4bVersion = versionId;
const metadata = uploadedModules.metadata ? JSON.parse(uploadedModules.metadata.toString()) : null;
receipt.c4b = {
  exit: c4b.code, signal: c4b.signal,
  requests: c4bRequests.map((r) => `${r.method} ${r.path}`),
  auth_only_fixture_token: authOk(c4bRequests),
  sentinel_seen_by_provider: requests.some((r) => r.sentinel), sentinel_in_output: c4b.out.includes(SENTINEL),
  issued_version_id: versionId, event: deploy && { type: deploy.type, version: deploy.version, worker_name: deploy.worker_name, version_id: deploy.version_id },
  uploaded_modules: Object.fromEntries(Object.entries(uploadedModules).filter(([k]) => k !== "metadata").map(([k, v]) => [k, sha256(v)])),
  uploaded_bindings: metadata && (metadata.bindings ?? []).map((b) => ({ name: b.name, type: b.type, fixture_value: b.text === fixtureSecret })),
  main_module: metadata && metadata.main_module,
  compatibility_date: metadata && metadata.compatibility_date,
  keep_bindings: metadata && (metadata.keep_bindings ?? null),
  manifest_paths: assetManifest && Object.keys(assetManifest).length,
  uploaded_assets: uploadedAssets.size,
};
// Exact assets: the upload-session manifest names exactly the site files, every uploaded body is the site file for
// its manifest hash, and nothing outside the manifest was uploaded.
const sitePaths = listFiles(site).map((f) => `/${f.split(path.sep).join("/")}`).sort();
const manifestPaths = Object.keys(assetManifest ?? {}).sort();
const hashToPath = new Map(Object.entries(assetManifest ?? {}).map(([p, m]) => [m.hash, p]));
const assetMismatches = [...uploadedAssets].filter(([hash, bytes]) =>
  !hashToPath.has(hash) || !bytes.equals(fs.readFileSync(path.join(site, hashToPath.get(hash).slice(1))))).map(([h]) => h);
receipt.c4b.assets = { manifest_equals_site: JSON.stringify(manifestPaths) === JSON.stringify(sitePaths),
  every_manifest_hash_uploaded: [...hashToPath.keys()].every((h) => uploadedAssets.has(h)), mismatched_or_foreign: assetMismatches.length };
// The only Jev value this test ever wrote is C4b's fixture secrets file; remove it before the existing-Worker runs.
fs.rmSync(secretsFile);
receipt.c4b.secrets_file_removed = !fs.existsSync(secretsFile);

// C4c/C4d: an existing Worker whose JEV_API_KEY secret was preset earlier, deployed with no Jev value in the deploy
// context: no --secrets-file, no Jev environment variable, the test's fixture secrets file removed, and no request
// carrying the fixture value. Records what the pinned CLI sends; the fixture never assumes a provider default.
existing = true;
const preset = {};
for (const [label, extra, secretPreset] of [["c4c", [], true], ["c4d_keep_vars", ["--keep-vars"], true], ["c4e_secret_missing", [], false]]) {
  resetCaptures();
  presetSecret = secretPreset;
  const from = requests.length;
  const run = await cf(extra, creds);
  const md = uploadedModules.metadata ? JSON.parse(uploadedModules.metadata.toString()) : null;
  preset[label] = { exit: run.code, script_uploaded: versionId !== null,
    requests: requests.slice(from).map((r) => `${r.method} ${r.path}`),
    bindings: md && (md.bindings ?? []).map((b) => `${b.name}:${b.type}${b.text ? ":value" : ""}`),
    keep_bindings: md ? (md.keep_bindings ?? null) : undefined, sentinel_in_output: run.out.includes(SENTINEL),
    fixture_secret_sent: requests.slice(from).some((r) => r.fixture_secret),
    out_tail: run.out.split("\n").filter((l) => /rror|nknown|secret|keep/i.test(l)).slice(-4) };
}
receipt.preset_secret = preset;
// Over every request of every run (C3 to C4e): only the never-issued fixture token, and the planted .env never used.
receipt.all_requests = { count: requests.length, auth_only_fixture_token: authOk(requests),
  sentinel_seen_by_provider: requests.some((r) => r.sentinel),
  sentinel_in_any_output: [c3, c4a, c4b].some((r) => r.out.includes(SENTINEL)) || Object.values(preset).some((r) => r.sentinel_in_output) };
assert.notEqual(c4a.code, 0, "C4a deployed a Worker that declares a secret without its value");
assert.ok(receipt.c4a.refused_missing_secret && !receipt.c4a.script_uploaded, "C4a did not refuse natively before uploading the script");
assert.equal(c4b.code, 0, `C4b deploy failed:\n${c4b.out}`);
assert.ok(receipt.c4a.auth_only_fixture_token && receipt.c4b.auth_only_fixture_token, "C4 authenticated with something other than the never-issued fixture token");
assert.ok(!receipt.c4b.sentinel_seen_by_provider && !receipt.c4a.sentinel_in_output && !receipt.c4b.sentinel_in_output, "C4 used or printed the planted .env value");
assert.ok(c4bVersion && deploy, "C4b produced no native deploy event");
assert.equal(deploy.version_id, c4bVersion, "C4b native version id differs from the one the provider issued");
// Exact Worker: main module and the only module, admitted bytes, exactly the two bindings, the fixture date.
assert.deepEqual(receipt.c4b.uploaded_modules, { "worker.mjs": sha256(workerBytes) }, "C4b uploaded modules differ from exactly the admitted worker.mjs");
assert.equal(receipt.c4b.main_module, "worker.mjs", "C4b main module differs");
assert.deepEqual(receipt.c4b.uploaded_bindings, [{ name: "JEV_API_KEY", type: "secret_text", fixture_value: true },
  { name: "ASSETS", type: "assets", fixture_value: false }], "C4b bindings differ from exactly JEV_API_KEY (fixture value) and ASSETS");
assert.equal(receipt.c4b.compatibility_date, "2026-09-01", "C4b compatibility date differs");
assert.deepEqual(receipt.c4b.assets, { manifest_equals_site: true, every_manifest_hash_uploaded: true, mismatched_or_foreign: 0 },
  "C4b assets differ from exactly the site files and bytes");
// Existing Worker, no Jev value in the deploy context: the CLI sends JEV_API_KEY as an explicit `inherit` binding (no
// value, no keep_bindings); whether the provider keeps the preset secret is not proven here. --keep-vars does not exist
// on this path; and when the Worker has no such secret the CLI still sends `inherit` (it does not check), so failing
// closed there is not the CLI's, and must come from a pre-deploy check.
const pc = receipt.preset_secret;
assert.ok(receipt.c4b.secrets_file_removed, "C4b fixture secrets file still exists before the existing-Worker runs");
assert.ok(receipt.c4b.requests.length > 0 && requests.some((r) => r.fixture_secret), "C4b never sent the fixture value; the detector is blind");
assert.ok(Object.values(pc).every((r) => r.fixture_secret_sent === false), "an existing-Worker run sent the C4b fixture value");
assert.equal(pc.c4c.exit, 0, "C4c existing-Worker deploy without a Jev value failed");
assert.deepEqual(pc.c4c.bindings, ["JEV_API_KEY:inherit", "ASSETS:assets"], "C4c did not inherit the preset secret explicitly");
assert.equal(pc.c4c.keep_bindings, null, "C4c unexpectedly sent keep_bindings");
assert.ok(pc.c4d_keep_vars.exit !== 0 && pc.c4d_keep_vars.requests.length === 0 &&
  pc.c4d_keep_vars.out_tail.some((l) => l.includes("Unknown arguments: keep-vars")), "C4d: --keep-vars is now accepted; re-evaluate");
assert.deepEqual(pc.c4e_secret_missing.bindings, ["JEV_API_KEY:inherit", "ASSETS:assets"],
  "C4e: the CLI now treats a missing existing secret differently; re-evaluate");
assert.deepEqual(receipt.all_requests, { count: requests.length, auth_only_fixture_token: true, sentinel_seen_by_provider: false,
  sentinel_in_any_output: false }, "some request used a token other than the never-issued fixture token, or the planted .env was used");
console.error(`PASS cf checkpoint (${isolation.grade}): C3 prebuilt dry run, 0 requests; C4a new Worker with a declared secret refused without its value, .env unused; C4b exact Worker module, bindings, date and asset paths and bytes, native version id equals the issued one; C4c for an existing Worker, with no Jev value in the deploy context, the CLI sends an inherit binding (provider preservation not proven); C4d no --keep-vars; C4e missing existing secret is not checked by the CLI`);

// ---- Installed runtime (INSTALLED_ADAPTER_LOOPBACK_HARNESS) against the same server ----
const execute = (command, args, env, options = {}) => new Promise((ok) => {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "", stderr = "";
  const timer = setTimeout(() => { try { process.kill(options.detached ? -child.pid : child.pid, "SIGKILL"); } catch {} }, 600000);
  child.stdout.on("data", (c) => { stdout += c; });
  child.stderr.on("data", (c) => { stderr += c; });
  child.on("close", (code) => { clearTimeout(timer); ok({ code, stdout, stderr }); });
});
const HERE = path.dirname(SELF);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "installed-"));
const writeJson = (name, value) => { const p = path.join(work, name); fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`); return p; };
// Never-issued, Workers-shaped EXTERNAL EXPECTATION of the envs handoff (see fixtures/envs-projection.json).
const projectionPath = writeJson("projection.json", JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/envs-projection.json"), "utf8")));
const projection = JSON.parse(fs.readFileSync(projectionPath, "utf8"));
const isolationPath = writeJson("isolation.json", { kind: "ops.secretEffectBoundary.check.v1", status: "PASS", opsSha: installed.opsSha,
  active: 1, secretBearingEffects: 0, obsolete: 0, unclassified: 0,
  workflows: [{ path: ".github/workflows/fixture.yml", classification: "secret_free_verify" }],
  inputs: { checkerSha256: `sha256:${"5".repeat(64)}`, intentSha256: `sha256:${"6".repeat(64)}`,
    boundarySha256: `sha256:${"7".repeat(64)}`, workflowTreeSha: "8".repeat(40) } });
// The gate runs only as the installed program; a source copy is not honoured.
assert.equal(SELF, installed.gate.program, "this is not the installed gate program");
assert.equal(installed.gate.program, path.join(share, "tests/workers.test.mjs"));
assert.equal(installed.gate.entry, path.join(runtimeRoot, "bin/voice-ui-target-runtime-gate"));
// A never-issued fixture target. The acknowledged settings are written out here, not imported from the adapter.
const SETTINGS = { workersDev: true, previewUrls: false, observability: { enabled: false }, tags: [] };
const target = { provider: "cloudflare-workers", accountId: ACCOUNT, workerName: "voice-ui-nonproduct-fixture",
  url: `${ORIGIN}/`, nativeDeploySettings: SETTINGS };
const approved = (output, approvedTarget = target) => ({ kind: "ops.voiceUiTargetRuntimeRequest.v2",
  expected: { opsSha: installed.opsSha, envsSha: projection.envs_sha, appsSha: installed.product.proof.merge_sha,
    artifactManifestSha256: installed.product.manifestSha256, projectionReceiptSha256: sha256(fs.readFileSync(projectionPath)),
    isolationVerdictSha256: sha256(fs.readFileSync(isolationPath)), target: approvedTarget },
  inputs: { product, projectionReceipt: projectionPath, isolationVerdict: isolationPath }, output });
const entry = path.join(runtimeRoot, "bin/voice-ui-target-runtime");
const providerCount = () => requests.length;
const installedReceipt = {};

// Ordinary entries: --describe names the gate without running it; --request without a credential refuses before any
// provider call.
const entryFrom = providerCount();
const described = await execute(entry, ["--describe"], { PATH: "" });
assert.equal(described.code, 0, described.stderr);
const describedConfig = JSON.parse(described.stdout);
assert.equal(describedConfig.product.tag, installed.product.tag);
assert.equal(describedConfig.gate.programSha256, sha256(fs.readFileSync(installed.gate.program)));
const refused = await execute(entry, ["--request", writeJson("approved.json", approved(path.join(work, "refused")))], { PATH: "" });
assert.ok(refused.code !== 0 && /effect capability is missing/.test(refused.stderr), `no-credential request: ${refused.stderr}`);
assert.equal(providerCount(), entryFrom, "an ordinary entry reached the provider");
installedReceipt.normal_entries = { describe: "PASS", no_credential_request: "REFUSED_BEFORE_PROVIDER", provider_requests: 0 };

// The installed lib and adapters, through the private spawn seam only.
const adapters = Object.fromEntries(["deploy", "readback"].map((name) => {
  const p = path.join(share, `${name}.mjs`);
  return [name, { path: p, sha256: sha256(fs.readFileSync(p)) }];
}));
let providerFetches = 0;
globalThis.fetch = () => { providerFetches++; throw new Error("fixture: provider fetch refused"); };
const short = (p) => p.replace(`/client/v4/accounts/${ACCOUNT}/workers`, "").replace("/scripts/voice-ui-nonproduct-fixture", "<script>");
async function installedRun(label, { setup = () => {}, approvedTarget = target } = {}) {
  resetCaptures();
  resetWorkerMeta();
  setup();
  const from = providerCount(), output = path.join(work, label);
  const request = { ...approved(output, approvedTarget), installed: { product: installed.product, unzip: installed.unzip }, adapters };
  const run = await execute(process.execPath, [SELF, "--run", runtimeRoot, writeJson(`${label}.json`, request), base],
    { PATH: process.env.PATH ?? "", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN });
  const rs = requests.slice(from);
  return { run, output, requests: rs.map((r) => `${r.method} ${short(r.path)}`),
    // Every mutating call in order, with its whole JSON body where it has one.
    mutations: rs.filter((r) => r.method !== "GET").map((r) => [`${r.method} ${short(r.path)}`, r.json]),
    auth_only_fixture_token: authOk(rs), sentinel: rs.some((r) => r.sentinel) };
}
const READS_BEFORE_MUTATION = ["GET <script>/secrets", "GET /workers/voice-ui-nonproduct-fixture"];
// The six writes of one pinned `cf deploy`, in order. Anything else is a failure, never tolerated.
const SIX = ["POST <script>/assets-upload-session", "POST /assets/upload", "POST <script>/versions", "POST <script>/deployments",
  "PATCH <script>/script-settings", "POST <script>/subdomain"];

// PRESET_SECRET_FIXTURE: the secret name is listed, and the executed Worker holds the never-issued fixture value. The
// production readback's invalid-JSON probe gets the Worker's own 400 before any provider call; valid JSON is refused.
phase = "PRESET_SECRET_FIXTURE"; presetSecret = true; activeDeployment = null;
let apiFrom = siteRequests.length;
const positive = await installedRun("preset");
assert.equal(positive.run.code, 0, `installed runtime run failed:\n${positive.run.stderr}`);
const result = JSON.parse(positive.run.stdout);
const deployed = JSON.parse(fs.readFileSync(path.join(positive.output, "deploy.json"), "utf8"));
const readBack = JSON.parse(fs.readFileSync(path.join(positive.output, "readback.json"), "utf8"));
const md = JSON.parse(uploadedModules.metadata.toString());
const sitePathsNow = listFiles(site).map((f) => `/${f.split(path.sep).join("/")}`).sort();
const sent = {
  modules: Object.fromEntries(Object.entries(uploadedModules).filter(([k]) => k !== "metadata").map(([k, v]) => [k, sha256(v)])),
  main_module: md.main_module, compatibility_date: md.compatibility_date, compatibility_flags: md.compatibility_flags ?? [],
  bindings: (md.bindings ?? []).map((b) => `${b.name}:${b.type}${b.text ? ":value" : ""}`),
  manifest_equals_site: JSON.stringify(Object.keys(assetManifest).sort()) === JSON.stringify(sitePathsNow),
  asset_bytes_exact: Object.entries(assetManifest).every(([p, m]) => uploadedAssets.get(m.hash)?.equals(fs.readFileSync(path.join(site, p.slice(1))))),
};
installedReceipt.preset = { result: { status: result.status, claim: result.claim, limits: result.limits },
  version_id: deployed.deployment.versionId, issued_version_id: versionId, requests: positive.requests,
  mutations: positive.mutations.map(([call, json]) => [call, call.endsWith("assets-upload-session") ? "(asset manifest)" : json]),
  settings: deployed.settings, cli_sent: sent,
  readback: { files: readBack.publicBytes.fileCount, function: readBack.function, stored_module_bytes: readBack.storedModuleBytes },
  api: siteRequests.slice(apiFrom) };
assert.deepEqual(installedReceipt.preset.result, { status: "PASS", claim: "DEPLOY_READBACK_PASS",
  limits: { targetSettings: "ACKNOWLEDGED_DATA_NOT_AUTHORITY", workerSettings: "CLI_READBACK_PROVIDER_REPORTED",
    secretPresence: "NAME_PRESENT_NOT_AUTHORITY", inheritPreservation: "NOT_PROVEN", storedModuleBytes: "NO_CAPABILITY_NOT_RUN" } });
assert.ok(positive.auth_only_fixture_token && !positive.sentinel, "authentication differs");
// The two native reads come first, then exactly the six writes, with exactly these JSON bodies.
assert.deepEqual(positive.requests.slice(0, 2), READS_BEFORE_MUTATION, "the preflight reads are not first");
assert.deepEqual(positive.mutations.map(([call]) => call), SIX, "the deploy made other writes than the six known ones");
assert.deepEqual(positive.mutations[0][1].manifest, assetManifest, "asset manifest body differs");
assert.deepEqual(positive.mutations.slice(3).map(([, json]) => json), [
  { strategy: "percentage", versions: [{ version_id: versionId, percentage: 100 }], annotations: {} },
  { observability: { enabled: false }, tags: [] },
  { enabled: true, previews_enabled: false }], "deployment, settings or subdomain body differs");
// CLI_READBACK: the provider-reported settings changed from the fixture's initial ones to exactly the acknowledged ones.
assert.deepEqual(deployed.settings, { grade: "CLI_READBACK", reported: SETTINGS });
assert.equal(deployed.deployment.versionId, versionId, "deploy receipt version differs from the one the fixture issued");
// CLI_SENT_EXACT: the one module is the admitted Worker; the bindings and date are the product's declared runtime.
assert.deepEqual(sent, { modules: { "worker.mjs": installed.product.workerSha256 }, main_module: "worker.mjs",
  compatibility_date: "2026-09-01", compatibility_flags: [], bindings: ["JEV_API_KEY:inherit", "ASSETS:assets"],
  manifest_equals_site: true, asset_bytes_exact: true }, "installed deploy did not send exactly the admitted product");
assert.equal(readBack.publicBytes.fileCount, sitePathsNow.length);
assert.deepEqual(siteRequests.slice(apiFrom).map((r) => [r.method, r.status]), [["POST", 400]], "readback probe differs");

// Refusals. Each asserts its exact provider requests, so "the adapter failed" alone can never satisfy it.
const refusedRun = async (label, options, pattern, expectedRequests) => {
  phase = label;
  const r = await installedRun(label, options);
  assert.ok(r.run.code !== 0 && pattern.test(r.run.stderr), `${label} was not refused as expected:\n${r.run.stderr}`);
  assert.deepEqual(r.requests, expectedRequests, `${label}: provider requests differ`);
  assert.deepEqual(r.mutations, [], `${label}: a mutating provider call happened`);
  installedReceipt[label] = { refused: true, requests: r.requests, mutations: 0 };
};
// Target data refused before any provider call: no acknowledgement, a different one, a custom domain.
const { nativeDeploySettings: _omitted, ...unacknowledged } = target;
await refusedRun("TARGET_SETTINGS_MISSING", { approvedTarget: unacknowledged }, /expected target fields differ/, []);
await refusedRun("TARGET_SETTINGS_DIFFERENT", { approvedTarget: { ...target, nativeDeploySettings: { ...SETTINGS, previewUrls: true } } },
  /acknowledge exactly the native deploy settings/, []);
await refusedRun("TARGET_CUSTOM_DOMAIN", { approvedTarget: { ...target, url: "https://voice-ui.example.invalid/" } }, /exactly https:\/\/<workerName>/, []);
// The secret name absent, or present with another type: exactly the one secrets read, nothing else.
await refusedRun("PREFLIGHT_SECRET_ABSENT", { setup: () => { presetSecret = false; } }, /deploy adapter failed/, READS_BEFORE_MUTATION.slice(0, 1));
presetSecret = true;
await refusedRun("PREFLIGHT_SECRET_WRONG_TYPE", { setup: () => { secretType = "plain_text"; } }, /deploy adapter failed/, READS_BEFORE_MUTATION.slice(0, 1));
// The provider reports another URL for this Worker: refused after the two reads, before any write.
await refusedRun("PREFLIGHT_WORKER_URL_DIFFERS", { setup: () => { workerMeta.subdomain.url = "https://voice-ui-nonproduct-fixture.other-fixture.workers.dev"; } },
  /deploy adapter failed/, READS_BEFORE_MUTATION);

// After a deploy the provider must report the acknowledged settings. The CLI ignores a failed settings write and
// still exits 0, so only this readback can make the run RED; missing metadata does the same.
for (const fault of ["settings-write-fails", "missing-after-deploy"]) {
  phase = `SETTINGS_READBACK_${fault}`;
  const faulty = await installedRun(`settings-${fault}`, { setup: () => { metaFault = fault; } });
  assert.ok(faulty.run.code !== 0 && /deploy adapter failed/.test(faulty.run.stderr), `${fault} did not make the run RED:\n${faulty.run.stderr}`);
  assert.deepEqual(faulty.mutations.map(([call]) => call), SIX, `${fault}: the deploy did not run its six writes`);
  assert.equal(fs.existsSync(path.join(faulty.output, "receipt.json")), false, `${fault}: a receipt was written`);
  installedReceipt[phase] = { run: "RED", writes: faulty.mutations.length, receipt: false };
}

// The installed wrappers themselves, each refused deterministically before any provider or network call.
phase = "INSTALLED_WRAPPERS";
const wrapperFrom = providerCount(), siteFrom = siteRequests.length;
const effect = { kind: "ops.voiceUiEffectRequest.v2", expected: approved(path.join(work, "wrapper")).expected, artifactRoot: artifact,
  projection: { receiptSha256: sha256(fs.readFileSync(projectionPath)), ciphertextSha256: projection.source.sha256 } };
const wrapper = (name, request) => execute(process.execPath, [path.join(share, `${name}.mjs`), "--request", writeJson(`wrapper-${name}.json`, request),
  "--receipt", path.join(work, `wrapper-${name}-receipt.json`)], { PATH: "" });
const noAuthority = await wrapper("deploy", effect);
assert.deepEqual([noAuthority.code, noAuthority.stderr], [1, "effect authority/target mismatch\n"], "installed deploy.mjs without a credential");
const otherTarget = await wrapper("readback", { ...effect, deployment: { versionId: "fixture", deploymentId: "fixture",
  workerName: target.workerName, url: "https://voice-ui-nonproduct-fixture.other-fixture.workers.dev/" } });
assert.deepEqual([otherTarget.code, otherTarget.stderr], [1, "readback target differs\n"], "installed readback.mjs with another deployment URL");
assert.deepEqual([providerCount() - wrapperFrom, siteRequests.length - siteFrom, fs.readdirSync(work).filter((f) => f.endsWith("-receipt.json"))],
  [0, 0, []], "an installed wrapper reached the provider, the site or wrote a receipt");
installedReceipt.installed_wrappers = { deploy_without_credential: "REFUSED_AUTHORITY", readback_other_url: "REFUSED_TARGET", requests: 0 };

// SECRET_ABSENT_FIXTURE: the name is listed but the executed Worker has no value (e.g. `inherit` did not keep it). The
// same uploaded bytes answer the probe 503, so the production readback is RED.
phase = "SECRET_ABSENT_FIXTURE"; presetSecret = true; apiFrom = siteRequests.length;
const red = await installedRun("secret-absent");
assert.ok(red.run.code !== 0 && /readback adapter failed/.test(red.run.stderr), `readback did not go RED:\n${red.run.stderr}`);
// The production readback retries a 5xx a bounded four times before it fails.
assert.deepEqual(siteRequests.slice(apiFrom).map((r) => [r.method, r.status]), Array(4).fill(["POST", 503]), "absent-secret probe differs");
installedReceipt.secret_absent = { readback: "RED", api: siteRequests.slice(apiFrom) };

// NO_SECRET_ACCEPTANCE: the imported ACCEPTANCE runtime, in its own credential-free process tree, runs the product's
// acceptance entry against the same uploaded bytes; the page's own /api/jev call gets 503 and ends RED_EXPECTED.
if (acceptanceNode) {
  phase = "NO_SECRET_ACCEPTANCE"; apiFrom = siteRequests.length;
  const origin = `http://127.0.0.1:${server.address().port}`, home = path.join(work, "acceptance");
  fs.mkdirSync(home);
  const accepted = await execute(acceptanceNode, [path.join(artifact, admitted.manifest.e2e.runtime_entrypoint),
    "--artifact-root", artifact, "--url", `${origin}/`, "--expected-apps-sha", installed.product.proof.merge_sha,
    "--expected-manifest-sha256", installed.product.manifestSha256, "--handoff-id", "gate/1", "--receipt", path.join(home, "receipt.json")],
    { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, LANG: "C.UTF-8" }, { cwd: home, detached: true });
  const r = fs.existsSync(path.join(home, "receipt.json")) ? JSON.parse(fs.readFileSync(path.join(home, "receipt.json"), "utf8")) : null;
  installedReceipt.acceptance = { exit: accepted.code, status: r?.status, stage: r?.stage, secret_inputs: r?.dependencies?.secretInputs,
    reason: /NOT_RUN: jev_unavailable/.test(accepted.stderr) ? "NOT_RUN: jev_unavailable" : null, api: siteRequests.slice(apiFrom) };
  assert.equal(accepted.code, 1, accepted.stderr);
  assert.deepEqual({ status: r?.status, stage: r?.stage, secret_inputs: r?.dependencies?.secretInputs, reason: installedReceipt.acceptance.reason },
    { status: "RED", stage: "application-e2e", secret_inputs: [], reason: "NOT_RUN: jev_unavailable" }, accepted.stderr);
  assert.deepEqual(siteRequests.slice(apiFrom).map((a) => [a.method, a.origin, a.fetchSite, a.status]),
    [["POST", origin, "same-origin", 503]], "acceptance must make exactly one same-origin page request to /api/jev");
}
installedReceipt.provider_fetches_from_worker = providerFetches;
installedReceipt.violations = violations;
assert.equal(providerFetches, 0, "the executed Worker tried to call a provider");
assert.deepEqual(violations, [], "fixture violations");
receipt.installed = installedReceipt;
receipt.grades = { isolation: isolation.grade, harness: "INSTALLED_ADAPTER_LOOPBACK_HARNESS", module_and_assets: "CLI_SENT_EXACT",
  site: "FIXTURE_SERVED", stored_module_bytes: "NO_CAPABILITY_NOT_RUN", acceptance: acceptanceNode ? "RED_EXPECTED" : "NOT_RUN_HERE",
  live_provider: "NOT_RUN" };
server.close();
console.log(JSON.stringify(receipt, null, 1));
console.error(`PASS installed runtime (${isolation.grade}): ordinary entries and both installed wrappers make no provider call; unacknowledged settings or a custom domain refused with no request; secret name and type, then provider-reported name and URL, before any write; exactly six writes with exact bodies; exact admitted module/assets/bindings sent; provider-reported settings read back (CLI_READBACK), RED when the write fails or metadata is missing; fixture 400 readback; absent value makes readback RED; acceptance ${receipt.grades.acceptance}; Worker provider calls 0`);

// Harness children. `--run <runtime> <request> <base>`: the installed lib, with the private spawn seam pointing each
// adapter start at `--adapter`. `--adapter <runtime> <base> <adapter> --request r --receipt p`: the installed
// workers.mjs with the loopback api (deploy) or fetcher (readback). Neither is reachable from an ordinary entry.
async function harnessChild(mode, args) {
  try {
    if (mode === "--run") {
      const [root, requestPath, loopback] = args;
      const { runTargetRuntime } = await import(path.join(root, "share/voice-ui-target-runtime/lib.mjs"));
      const result = runTargetRuntime(JSON.parse(fs.readFileSync(requestPath, "utf8")), {
        spawn: (command, adapterArgs, options) => spawnSync(command, [SELF, "--adapter", root, loopback, ...adapterArgs], options) });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    const [root, loopback, adapter, flag, requestPath, receiptFlag, receiptPath] = args;
    const dir = path.join(root, "share/voice-ui-target-runtime");
    assert.ok(flag === "--request" && receiptFlag === "--receipt" && [path.join(dir, "deploy.mjs"), path.join(dir, "readback.mjs")].includes(adapter));
    const workers = await import(path.join(dir, "workers.mjs"));
    const { atomicJson } = await import(path.join(dir, "modules/core.mjs"));
    const config = JSON.parse(fs.readFileSync(path.join(dir, "configuration.json"), "utf8"));
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const targetOrigin = new URL(request.expected.target.url).origin, loopOrigin = new URL(loopback).origin;
    const fetcher = (url, options) => {
      const u = new URL(url);
      assert.equal(u.origin, targetOrigin, "readback left the approved target");
      return fetch(new URL(u.pathname + u.search, loopOrigin), options);
    };
    const result = path.basename(adapter) === "deploy.mjs"
      ? await workers.deploy(request, { cf: config.cf, buildOutputUtils: config.buildOutputUtils, env: process.env, api: loopback })
      : await workers.readback(request, { fetcher });
    atomicJson(receiptPath, result);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
