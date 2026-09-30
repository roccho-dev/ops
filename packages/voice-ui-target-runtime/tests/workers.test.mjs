// Native cf checkpoint (C3/C4) for the future Workers adapter. Offline only: a genuine, pinned `cf deploy --prebuilt`
// against a loopback provider fixture that records every request, with an account and token that were never issued.
// It proves only what the pinned CLI does with a Build Output made from the admitted artifact's unchanged bytes; the
// Worker metadata below is an explicitly NON_PRODUCT fixture, not the product's declared requirements.
// Usage: node workers.test.mjs <cf executable> <cf node_modules directory> <admitted artifact root> [--require-isolation]
// With --require-isolation (the Nix check) it fails before running cf unless the kernel shows a loopback-only network
// namespace. Run directly without it, the result is graded UNISOLATED: only requests that reached the fixture are proven.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const [cfBin, nodeModules, artifact, mode] = process.argv.slice(2);
assert.ok(cfBin && nodeModules && artifact && (mode === undefined || mode === "--require-isolation"),
  "usage: workers.test.mjs <cf> <node_modules> <artifact> [--require-isolation]");

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
if (mode === "--require-isolation") assert.equal(isolation.grade, "ISOLATED", `network is not loopback-only: ${JSON.stringify(isolation)}`);
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
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, bytes: body.length,
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
    if (existing && req.method === "POST" && p === `${script}/deployments`)
      return reply(200, { id: "fixture-deployment-2", source: "wrangler", strategy: "percentage",
        versions: [{ version_id: versionId, percentage: 100 }] });
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
      return reply(200, { deployments: [{ id: "fixture-deployment", source: "wrangler", strategy: "percentage",
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
server.close();
console.log(JSON.stringify(receipt, null, 1));
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
