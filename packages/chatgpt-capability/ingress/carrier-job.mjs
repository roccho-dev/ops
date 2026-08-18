#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

async function materialize(reqFile, out) {
  if (fs.existsSync(out)) fail(`out exists: ${out}`);
  const r = request(reqFile);
  fs.mkdirSync(path.join(out, "files"), { recursive: true });
  const req = Buffer.from(json(r));
  fs.writeFileSync(path.join(out, "request.json"), req);
  const bytes = new Map();
  const rows = [];
  for (const s of r.sources) {
    const b = await source(new URL(s.url));
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

function options(a, keys) {
  const x = {};
  while (a.length) { const k = a.shift(), v = a.shift(); if (!keys.includes(k) || !v || x[k]) fail("invalid options"); x[k] = v; }
  if (keys.some((k) => !x[k])) fail("missing options");
  return x;
}

function rejects(fn, re) { try { fn(); } catch (e) { if (re.test(e.message)) return; throw e; } fail(`expected ${re}`); }

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
    fs.appendFileSync(path.join(moved, "files", "c.b64.txt"), "A"); rejects(() => verify(moved), /checksum mismatch/);
    rejects(() => decode(Buffer.from(`${carrier}\n`)), /Base64/);
    rejects(() => request((() => { const f = path.join(root, "bad.json"); fs.writeFileSync(f, json({ ...r, sources: [{ ...r.sources[0], name: "../x" }] })); return f; })()), /safe basename/);
    console.log(JSON.stringify({ schema: "carrier-job-selftest/1", status: "PASS", positive: 2, negative: 3 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (!cmd || cmd === "selftest") return selftest();
  if (cmd === "materialize") { const o = options(a, ["--request", "--out"]); console.log(JSON.stringify(await materialize(o["--request"], o["--out"]))); return; }
  if (cmd === "verify") { const o = options(a, ["--input", "--receipt"]); const x = verify(o["--input"]); fs.writeFileSync(o["--receipt"], json(x)); console.log(JSON.stringify(x)); return; }
  fail("usage: carrier-job.mjs [selftest] | materialize --request FILE --out DIR | verify --input DIR --receipt FILE");
}

main().catch((e) => { console.error(`carrier-job: ${e.message}`); process.exit(1); });
