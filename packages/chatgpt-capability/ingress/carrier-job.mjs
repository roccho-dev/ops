#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
const fail = (x) => { throw new Error(x); };
const hex = (x, n) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x) ? x : fail(`${n} must be lowercase sha256`);
const name = (x, n) => typeof x === "string" && /^[A-Za-z0-9._-]+$/.test(x) && x !== "." && x !== ".." ? x : fail(`${n} must be a safe basename`);

function request(file) {
  const x = JSON.parse(fs.readFileSync(file, "utf8"));
  if (x?.schema !== "carrier-job/1" || !/^[A-Za-z0-9._-]{1,128}$/.test(x.request_id ?? "") || !Array.isArray(x.sources) || !x.sources.length) fail("invalid carrier-job/1 request");
  const seen = new Set();
  const sources = x.sources.map((s, i) => {
    const n = name(s?.name, `sources[${i}].name`);
    if (seen.has(n)) fail(`duplicate source: ${n}`);
    seen.add(n);
    let u;
    try { u = new URL(s.url); } catch { fail(`invalid source URL: ${n}`); }
    if (!["https:", "file:"].includes(u.protocol)) fail(`unsupported source URL: ${n}`);
    return { name: n, url: u.href, sha256: hex(s.sha256, `${n}.sha256`) };
  });
  const carrier = name(x.carrier_name, "carrier_name");
  if (!seen.has(carrier)) fail("carrier_name must reference a source");
  return { schema: "carrier-job/1", request_id: x.request_id, sources, carrier_name: carrier, payload_sha256: hex(x.payload_sha256, "payload_sha256") };
}

async function source(u) {
  if (u.protocol === "file:") return fs.readFileSync(fileURLToPath(u));
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30_000);
  try {
    const r = await fetch(u, { redirect: "follow", signal: c.signal });
    if (!r.ok) fail(`GET ${r.status}: ${u.href}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 128 * 1024 * 1024) fail(`source too large: ${u.href}`);
    return b;
  } finally { clearTimeout(t); }
}

function rawRequest(file) {
  const x = JSON.parse(fs.readFileSync(file, "utf8"));
  if (x?.schema !== "carrier-job/2" || !/^[A-Za-z0-9._-]{1,128}$/.test(x.request_id ?? "") || !Array.isArray(x.sources) || !x.sources.length) fail("invalid carrier-job/2 request");
  const seen = new Set();
  const sources = x.sources.map((s, i) => {
    const n = name(s?.name, `sources[${i}].name`);
    if (seen.has(n)) fail(`duplicate source: ${n}`);
    seen.add(n);
    let u;
    try { u = new URL(s.url); } catch { fail(`invalid source URL: ${n}`); }
    if (!["https:", "file:"].includes(u.protocol)) fail(`unsupported source URL: ${n}`);
    if (!Number.isSafeInteger(s.bytes) || s.bytes < 0) fail(`${n}.bytes must be a non-negative safe integer`);
    return { name: n, url: u.href, bytes: s.bytes, sha256: hex(s.sha256, `${n}.sha256`) };
  });
  const payloadSource = name(x?.payload?.source, "payload.source");
  if (x?.payload?.codec !== "raw" || !seen.has(payloadSource)) fail("payload must select a raw source");
  return { schema: "carrier-job/2", request_id: x.request_id, sources, payload: { source: payloadSource, codec: "raw" } };
}

async function fileInfo(file) {
  const h = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    bytes += chunk.length;
    h.update(chunk);
  }
  return { bytes, sha256: h.digest("hex") };
}

async function streamSource(u, target, expected) {
  const h = crypto.createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expected.bytes) return callback(new Error(`source bytes exceed expected: ${expected.name}`));
      h.update(chunk);
      callback(null, chunk);
    },
  });
  const copy = async (input) => {
    await pipeline(input, meter, fs.createWriteStream(target, { flags: "wx" }));
    const digest = h.digest("hex");
    if (bytes !== expected.bytes) fail(`source bytes mismatch: ${expected.name}`);
    if (digest !== expected.sha256) fail(`source sha256 mismatch: ${expected.name}`);
    return { bytes, sha256: digest };
  };

  try {
    if (u.protocol === "file:") return await copy(fs.createReadStream(fileURLToPath(u)));
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10 * 60_000);
    try {
      const r = await fetch(u, { redirect: "follow", signal: c.signal });
      if (!r.ok) fail(`GET ${r.status}: ${u.href}`);
      if (!r.body) fail(`empty response body: ${u.href}`);
      return await copy(Readable.fromWeb(r.body));
    } finally { clearTimeout(t); }
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }
}

function rawReceipt(r, req, rows) {
  const payload = rows.find((row) => row.name === r.payload.source);
  if (!payload) fail("payload source missing");
  return {
    schema: "carrier-job-receipt/2", status: "PASS", requestId: r.request_id, requestSha256: sha(req), sources: rows,
    payload: { source: payload.name, path: `files/${payload.name}`, codec: "raw", bytes: payload.bytes, sha256: payload.sha256 },
  };
}

async function materializeRaw(reqFile, out, sourceDirInput = null) {
  if (fs.existsSync(out)) fail(`out exists: ${out}`);
  const r = rawRequest(reqFile);
  const sourceDir = validateSourceDir(sourceDirInput, r.sources);
  fs.mkdirSync(path.join(out, "files"), { recursive: true });
  const req = Buffer.from(json(r));
  fs.writeFileSync(path.join(out, "request.json"), req);
  const rows = [];
  for (const s of r.sources) {
    const bound = sourceDir ? path.join(sourceDir, s.name) : null;
    const u = bound && fs.existsSync(bound) ? pathToFileURL(bound) : new URL(s.url);
    const info = await streamSource(u, path.join(out, "files", s.name), s);
    rows.push({ ...s, ...info });
  }
  fs.writeFileSync(path.join(out, "receipt.json"), json(rawReceipt(r, req, rows)));
  const sumRows = [
    `${sha(req)}  request.json`,
    ...rows.map((row) => `${row.sha256}  files/${row.name}`),
  ];
  fs.writeFileSync(path.join(out, "SHA256SUMS"), `${sumRows.join("\n")}\n`);
  return verifyRaw(out);
}

async function verifyRaw(root) {
  const r = rawRequest(path.join(root, "request.json"));
  const allowed = ["SHA256SUMS", "files", "receipt.json", "request.json"].sort();
  if (JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(allowed)) fail("unexpected artifact entries");
  for (const f of allowed.filter((x) => x !== "files")) if (!fs.lstatSync(path.join(root, f)).isFile()) fail(`not a regular file: ${f}`);
  if (!fs.lstatSync(path.join(root, "files")).isDirectory()) fail("files must be a directory");
  const actual = fs.readdirSync(path.join(root, "files")).sort();
  const expected = r.sources.map((s) => s.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("source inventory mismatch");
  for (const f of actual) if (!fs.lstatSync(path.join(root, "files", f)).isFile()) fail(`not a regular file: ${f}`);

  const lines = fs.readFileSync(path.join(root, "SHA256SUMS"), "utf8").trimEnd().split("\n");
  const wanted = ["request.json", ...r.sources.map((s) => `files/${s.name}`)].sort();
  const got = [];
  const observed = new Map();
  for (const line of lines) {
    const m = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/);
    if (!m || m[2].split("/").some((x) => !x || x === "." || x === "..")) fail("invalid SHA256SUMS");
    if (got.includes(m[2])) fail(`duplicate checksum path: ${m[2]}`);
    const file = path.join(root, ...m[2].split("/"));
    const info = m[2] === "request.json"
      ? { bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) }
      : await fileInfo(file);
    if (info.sha256 !== m[1]) fail(`checksum mismatch: ${m[2]}`);
    got.push(m[2]);
    observed.set(m[2], info);
  }
  if (JSON.stringify(got.sort()) !== JSON.stringify(wanted)) fail("checksum inventory mismatch");

  const req = fs.readFileSync(path.join(root, "request.json"));
  const rows = r.sources.map((s) => {
    const info = observed.get(`files/${s.name}`);
    if (!info || info.bytes !== s.bytes) fail(`source bytes mismatch: ${s.name}`);
    if (info.sha256 !== s.sha256) fail(`source sha256 mismatch: ${s.name}`);
    return { ...s, ...info };
  });
  const observedReceipt = rawReceipt(r, req, rows);
  if (json(JSON.parse(fs.readFileSync(path.join(root, "receipt.json"), "utf8"))) !== json(observedReceipt)) fail("receipt mismatch");
  return observedReceipt;
}

function decode(b) {
  if (!b.length || b.some((x) => x > 127)) fail("Carrier must be ASCII");
  const s = b.toString("ascii");
  if (/\s/u.test(s) || s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) fail("Carrier must be canonical standard Base64 without whitespace");
  const p = Buffer.from(s, "base64");
  if (p.toString("base64") !== s) fail("Carrier must be canonical standard Base64 without whitespace");
  return p;
}

function receipt(r, req, rows, carrier, payload) {
  return {
    schema: "carrier-job-receipt/1", status: "PASS", requestId: r.request_id, requestSha256: sha(req), sources: rows,
    carrier: { name: r.carrier_name, bytes: carrier.length, sha256: sha(carrier), codec: "standard-base64", payloadSha256: sha(payload) },
    payload: { name: "payload.bin", bytes: payload.length, sha256: sha(payload) },
  };
}

function sums(root, paths) {
  fs.writeFileSync(path.join(root, "SHA256SUMS"), `${paths.map((p) => `${sha(fs.readFileSync(path.join(root, p)))}  ${p.replaceAll(path.sep, "/")}`).join("\n")}\n`);
}

function validateSourceDir(sourceDir, sources) {
  if (!sourceDir) return null;
  if (!fs.lstatSync(sourceDir).isDirectory()) fail("source-dir must be a directory");
  const allowed = new Set(sources.map((source) => source.name));
  for (const entry of fs.readdirSync(sourceDir)) {
    if (!allowed.has(entry)) fail(`unexpected source-dir entry: ${entry}`);
    if (!fs.lstatSync(path.join(sourceDir, entry)).isFile()) fail(`source-dir entry must be a regular file: ${entry}`);
  }
  return sourceDir;
}

async function materialize(reqFile, out, sourceDirInput = null) {
  if (fs.existsSync(out)) fail(`out exists: ${out}`);
  const r = request(reqFile);
  const sourceDir = validateSourceDir(sourceDirInput, r.sources);
  fs.mkdirSync(path.join(out, "files"), { recursive: true });
  const req = Buffer.from(json(r));
  fs.writeFileSync(path.join(out, "request.json"), req);
  const bytes = new Map();
  const rows = [];
  for (const s of r.sources) {
    const bound = sourceDir ? path.join(sourceDir, s.name) : null;
    const b = bound && fs.existsSync(bound) ? fs.readFileSync(bound) : await source(new URL(s.url));
    if (sha(b) !== s.sha256) fail(`source sha256 mismatch: ${s.name}`);
    fs.writeFileSync(path.join(out, "files", s.name), b);
    bytes.set(s.name, b);
    rows.push({ ...s, bytes: b.length });
  }
  const carrier = bytes.get(r.carrier_name);
  const payload = decode(carrier);
  if (sha(payload) !== r.payload_sha256) fail("payload sha256 mismatch");
  fs.writeFileSync(path.join(out, "payload.bin"), payload);
  fs.writeFileSync(path.join(out, "receipt.json"), json(receipt(r, req, rows, carrier, payload)));
  sums(out, ["request.json", ...r.sources.map((s) => `files/${s.name}`), "payload.bin"]);
  return verify(out);
}

function verify(root) {
  const r = request(path.join(root, "request.json"));
  const allowed = ["SHA256SUMS", "files", "payload.bin", "receipt.json", "request.json"].sort();
  if (JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(allowed)) fail("unexpected artifact entries");
  for (const f of allowed.filter((x) => x !== "files")) if (!fs.lstatSync(path.join(root, f)).isFile()) fail(`not a regular file: ${f}`);
  if (!fs.lstatSync(path.join(root, "files")).isDirectory()) fail("files must be a directory");
  const actual = fs.readdirSync(path.join(root, "files")).sort();
  const expected = r.sources.map((s) => s.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("source inventory mismatch");
  for (const f of actual) if (!fs.lstatSync(path.join(root, "files", f)).isFile()) fail(`not a regular file: ${f}`);

  const lines = fs.readFileSync(path.join(root, "SHA256SUMS"), "utf8").trimEnd().split("\n");
  const wanted = ["request.json", ...r.sources.map((s) => `files/${s.name}`), "payload.bin"].sort();
  const got = [];
  for (const line of lines) {
    const m = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/);
    if (!m || m[2].split("/").some((x) => !x || x === "." || x === "..")) fail("invalid SHA256SUMS");
    if (got.includes(m[2]) || sha(fs.readFileSync(path.join(root, ...m[2].split("/")))) !== m[1]) fail(`checksum mismatch: ${m[2]}`);
    got.push(m[2]);
  }
  if (JSON.stringify(got.sort()) !== JSON.stringify(wanted)) fail("checksum inventory mismatch");

  const req = fs.readFileSync(path.join(root, "request.json"));
  const rows = r.sources.map((s) => {
    const b = fs.readFileSync(path.join(root, "files", s.name));
    if (sha(b) !== s.sha256) fail(`source sha256 mismatch: ${s.name}`);
    return { ...s, bytes: b.length };
  });
  const carrier = fs.readFileSync(path.join(root, "files", r.carrier_name));
  const payload = decode(carrier);
  if (sha(payload) !== r.payload_sha256 || !fs.readFileSync(path.join(root, "payload.bin")).equals(payload)) fail("payload mismatch");
  const observed = receipt(r, req, rows, carrier, payload);
  if (json(JSON.parse(fs.readFileSync(path.join(root, "receipt.json"), "utf8"))) !== json(observed)) fail("receipt mismatch");
  return observed;
}

function options(a, required, optional = []) {
  const x = {};
  const allowed = [...required, ...optional];
  while (a.length) { const k = a.shift(), v = a.shift(); if (!allowed.includes(k) || !v || x[k]) fail("invalid options"); x[k] = v; }
  if (required.some((k) => !x[k])) fail("missing options");
  return x;
}

function rejects(fn, re) { try { fn(); } catch (e) { if (re.test(e.message)) return; throw e; } fail(`expected ${re}`); }
async function rejectsAsync(fn, re) { try { await fn(); } catch (e) { if (re.test(e.message)) return; throw e; } fail(`expected ${re}`); }

async function selftest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carrier-job-"));
  try {
    const src = path.join(root, "src"); fs.mkdirSync(src);
    const payload = Buffer.from("PASS\n"), carrier = Buffer.from(payload.toString("base64")), meta = Buffer.from("{}\n");
    fs.writeFileSync(path.join(src, "c.b64.txt"), carrier); fs.writeFileSync(path.join(src, "m.json"), meta);
    const r = { schema: "carrier-job/1", request_id: "selftest", sources: [
      { name: "c.b64.txt", url: pathToFileURL(path.join(src, "c.b64.txt")).href, sha256: sha(carrier) },
      { name: "m.json", url: pathToFileURL(path.join(src, "m.json")).href, sha256: sha(meta) },
    ], carrier_name: "c.b64.txt", payload_sha256: sha(payload) };
    const rf = path.join(root, "request.json"); fs.writeFileSync(rf, json(r));
    const out = path.join(root, "out"); await materialize(rf, out); verify(out);
    const moved = path.join(root, "moved"); fs.cpSync(out, moved, { recursive: true }); verify(moved);

    const boundDir = path.join(root, "bound"); fs.mkdirSync(boundDir);
    fs.writeFileSync(path.join(boundDir, "c.b64.txt"), carrier);
    fs.writeFileSync(path.join(boundDir, "m.json"), meta);
    const privateRequest = { ...r, request_id: "private-release", sources: r.sources.map((item) => ({ ...item, url: `https://github.example.invalid/private/${item.name}` })) };
    const privateFile = path.join(root, "private.json"); fs.writeFileSync(privateFile, json(privateRequest));
    const privateOut = path.join(root, "private-out"); await materialize(privateFile, privateOut, boundDir); verify(privateOut);

    fs.appendFileSync(path.join(moved, "files", "c.b64.txt"), "A"); rejects(() => verify(moved), /checksum mismatch/);
    rejects(() => decode(Buffer.concat([carrier, Buffer.from("\n")])), /Base64/);
    rejects(() => request((() => { const f = path.join(root, "bad.json"); fs.writeFileSync(f, json({ ...r, sources: [{ ...r.sources[0], name: "../x" }] })); return f; })()), /safe basename/);
    fs.writeFileSync(path.join(boundDir, "unexpected"), "x");
    rejects(() => validateSourceDir(boundDir, privateRequest.sources), /unexpected source-dir entry/);
    fs.rmSync(path.join(boundDir, "unexpected"));
    fs.writeFileSync(path.join(boundDir, "c.b64.txt"), Buffer.from("tampered"));
    await (async () => { try { await materialize(privateFile, path.join(root, "private-tampered"), boundDir); } catch (error) { if (/source sha256 mismatch/.test(error.message)) return; throw error; } fail("expected source sha256 mismatch"); })();
    console.log(JSON.stringify({ schema: "carrier-job-selftest/1", status: "PASS", positive: 3, negative: 5 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function rawSelftest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carrier-job-raw-"));
  try {
    const src = path.join(root, "src"); fs.mkdirSync(src);
    const payloadPath = path.join(src, "model.gguf");
    const chunk = Buffer.alloc(1024 * 1024, 0x5a);
    const count = 129;
    const h = crypto.createHash("sha256");
    const fd = fs.openSync(payloadPath, "wx");
    try {
      for (let i = 0; i < count; i += 1) { fs.writeSync(fd, chunk); h.update(chunk); }
    } finally { fs.closeSync(fd); }
    const bytes = count * chunk.length;
    const digest = h.digest("hex");
    const r = {
      schema: "carrier-job/2",
      request_id: "raw-large-selftest",
      sources: [{ name: "model.gguf", url: pathToFileURL(payloadPath).href, bytes, sha256: digest }],
      payload: { source: "model.gguf", codec: "raw" },
    };
    const rf = path.join(root, "request.json"); fs.writeFileSync(rf, json(r));
    const out = path.join(root, "out"); await materializeRaw(rf, out);
    fs.rmSync(src, { recursive: true, force: true });
    await verifyRaw(out);
    fs.appendFileSync(path.join(out, "files", "model.gguf"), "x");
    await rejectsAsync(() => verifyRaw(out), /checksum mismatch|source bytes mismatch|source sha256 mismatch/);
    console.log(JSON.stringify({ schema: "carrier-job-raw-selftest/1", status: "PASS", bytes, positive: 2, negative: 1 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (!cmd || cmd === "selftest") return selftest();
  if (cmd === "selftest-raw-large") return rawSelftest();
  if (cmd === "materialize") {
    const o = options(a, ["--request", "--out"], ["--source-dir"]);
    const schema = JSON.parse(fs.readFileSync(o["--request"], "utf8"))?.schema;
    const x = schema === "carrier-job/2"
      ? await materializeRaw(o["--request"], o["--out"], o["--source-dir"] ?? null)
      : await materialize(o["--request"], o["--out"], o["--source-dir"] ?? null);
    console.log(JSON.stringify(x)); return;
  }
  if (cmd === "verify") {
    const o = options(a, ["--input", "--receipt"]);
    const schema = JSON.parse(fs.readFileSync(path.join(o["--input"], "request.json"), "utf8"))?.schema;
    const x = schema === "carrier-job/2" ? await verifyRaw(o["--input"]) : verify(o["--input"]);
    fs.writeFileSync(o["--receipt"], json(x)); console.log(JSON.stringify(x)); return;
  }
  fail("usage: carrier-job.mjs [selftest|selftest-raw-large] | materialize --request FILE --out DIR [--source-dir DIR] | verify --input DIR --receipt FILE");
}

main().catch((e) => { console.error(`carrier-job: ${e.message}`); process.exit(1); });
