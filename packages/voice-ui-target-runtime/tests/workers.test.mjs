// Native cf checkpoint (C3/C4) for the future Workers adapter. Offline only: a genuine, pinned `cf deploy --prebuilt`
// against a loopback provider fixture that records every request, with an account and token that were never issued.
// It proves only what the pinned CLI does with a Build Output made from the admitted artifact's unchanged bytes; the
// Worker metadata below is an explicitly NON_PRODUCT fixture, not the product's declared requirements.
// Usage: node workers.test.mjs <cf executable> <cf node_modules directory> <admitted artifact root>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const [cfBin, nodeModules, artifact] = process.argv.slice(2);
assert.ok(cfBin && nodeModules && artifact, "usage: workers.test.mjs <cf> <node_modules> <artifact>");
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
const requests = [];
let versionId = null;
const uploadedModules = {};
const uploadedAssets = new Set();
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, bytes: body.length,
      sentinel: body.includes(SENTINEL) || String(req.headers.authorization ?? "").includes(SENTINEL) });
    const reply = (status, result, code = 10000 + status) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status < 400 ? { success: true, errors: [], messages: [], result }
        : { success: false, errors: [{ code, message: `fixture: ${req.method} ${url.pathname}` }], messages: [], result: null }));
    };
    const p = url.pathname.replace(/^\/client\/v4/, "");
    const script = `/accounts/${ACCOUNT}/workers/scripts/voice-ui-nonproduct-fixture`;
    if (req.method === "POST" && p === `${script}/assets-upload-session`) {
      const manifest = JSON.parse(body.toString()).manifest;
      return reply(200, { jwt: "fixture-upload-jwt", buckets: [Object.values(manifest).map((m) => m.hash)] });
    }
    if (req.method === "POST" && p === `/accounts/${ACCOUNT}/workers/assets/upload`) {
      for (const m of body.toString().matchAll(/name="([0-9a-f]{32})"/g)) uploadedAssets.add(m[1]);
      return reply(201, { jwt: "fixture-completion-jwt" });
    }
    if (req.method === "PUT" && (p === script || p === `${script}/versions`)) {
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers["content-type"] ?? "");
      const delimiter = `--${boundary?.[1] ?? boundary?.[2]}`;
      for (const part of body.toString("latin1").split(delimiter).slice(1, -1)) {
        const split = part.indexOf("\r\n\r\n");
        const name = /name="([^"]+)"/.exec(part.slice(0, split))?.[1];
        if (name) uploadedModules[name] = Buffer.from(part.slice(split + 4, part.length - 2), "latin1");
      }
      versionId = crypto.randomUUID();
      return reply(200, { id: "voice-ui-nonproduct-fixture", etag: "fixture", deployment_id: versionId,
        startup_time_ms: 1, has_modules: true, has_assets: true, placement_mode: null });
    }
    if (req.method === "GET" && p === `/accounts/${ACCOUNT}/workers/subdomain`) return reply(200, { subdomain: "fixture" });
    if (p === `${script}/subdomain`) return reply(200, { enabled: false, previews_enabled: false });
    // The Worker's own record, read after upload for its workers.dev state (kept disabled).
    if (req.method === "GET" && p === `/accounts/${ACCOUNT}/workers/workers/voice-ui-nonproduct-fixture` && versionId)
      return reply(200, { name: "voice-ui-nonproduct-fixture", subdomain: { enabled: false, previews_enabled: false } });
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
const receipt = { fixture: FIXTURE, cf: cfBin, artifact, worker_sha256: sha256(workerBytes), site_files: listFiles(site).length };

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
const fixtureSecret = `never-issued-secret-${crypto.randomBytes(12).toString("hex")}`;
const secretsFile = path.join(home, "fixture-secrets.json");
fs.writeFileSync(secretsFile, JSON.stringify({ JEV_API_KEY: fixtureSecret }));
const before = requests.length;
const outputFile = path.join(home, "cf-output.jsonl");
const c4b = await cf(["--secrets-file", secretsFile], { ...creds, WRANGLER_OUTPUT_FILE_PATH: outputFile });
const events = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const deploy = events.find((e) => e.type === "deploy") ?? null;
const c4bRequests = requests.slice(before);
const metadata = uploadedModules.metadata ? JSON.parse(uploadedModules.metadata.toString()) : null;
receipt.c4b = {
  exit: c4b.code, signal: c4b.signal,
  requests: c4bRequests.map((r) => `${r.method} ${r.path}`),
  auth_only_fixture_token: authOk(c4bRequests),
  sentinel_seen_by_provider: requests.some((r) => r.sentinel), sentinel_in_output: c4b.out.includes(SENTINEL),
  issued_version_id: versionId, event: deploy && { type: deploy.type, version: deploy.version, worker_name: deploy.worker_name, version_id: deploy.version_id },
  uploaded_modules: Object.fromEntries(Object.entries(uploadedModules).filter(([k]) => k !== "metadata").map(([k, v]) => [k, sha256(v)])),
  uploaded_bindings: metadata && (metadata.bindings ?? []).map((b) => ({ name: b.name, type: b.type, fixture_value: b.text === fixtureSecret })),
  compatibility_date: metadata && metadata.compatibility_date,
  uploaded_assets: uploadedAssets.size,
};
server.close();
console.log(JSON.stringify(receipt, null, 1));
assert.notEqual(c4a.code, 0, "C4a deployed a Worker that declares a secret without its value");
assert.ok(receipt.c4a.refused_missing_secret && !receipt.c4a.script_uploaded, "C4a did not refuse natively before uploading the script");
assert.equal(c4b.code, 0, `C4b deploy failed:\n${c4b.out}`);
assert.ok(receipt.c4a.auth_only_fixture_token && receipt.c4b.auth_only_fixture_token, "C4 authenticated with something other than the never-issued fixture token");
assert.ok(!receipt.c4b.sentinel_seen_by_provider && !receipt.c4a.sentinel_in_output && !receipt.c4b.sentinel_in_output, "C4 used or printed the planted .env value");
assert.ok(versionId && deploy, "C4b produced no native deploy event");
assert.equal(deploy.version_id, versionId, "C4b native version id differs from the one the provider issued");
assert.equal(receipt.c4b.uploaded_modules["worker.mjs"], sha256(workerBytes), "C4b uploaded Worker bytes differ from the admitted bytes");
console.error("PASS cf checkpoint: C3 prebuilt dry run with 0 requests; C4a new Worker with a declared secret refused natively without its value, .env unused; C4b prebuilt deploy to the loopback fixture only, exact Worker bytes, native version id equals the issued one");
