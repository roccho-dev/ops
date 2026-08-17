#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const sha256 = (x) => crypto.createHash("sha256").update(x).digest("hex");
const fail = (m) => { throw new Error(m); };
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  if (!(options.allowed ?? [0]).includes(r.status)) fail(`${cmd} ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim()}`);
  return r;
};
const command = (envName, fallback) => {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const x = JSON.parse(raw);
  if (!Array.isArray(x) || !x.length || x.some((v) => typeof v !== "string" || !v)) fail(`${envName} must be a JSON string array`);
  return x;
};
const call = (spec, args, options) => run(spec[0], [...spec.slice(1), ...args], options);
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const hex = (x, n, label) => {
  if (typeof x !== "string" || !new RegExp(`^[a-f0-9]{${n}}$`).test(x)) fail(`${label} is invalid`);
  return x;
};
const canonicalB64 = (text, label) => {
  if (!text || /\s/u.test(text) || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail(`${label} is not canonical Base64`);
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) fail(`${label} is not canonical Base64`);
  return bytes;
};
const findOne = (dir, pred, label) => {
  const xs = fs.readdirSync(dir).filter(pred);
  if (xs.length !== 1) fail(`${label}: expected exactly one, got ${xs.length}`);
  return xs[0];
};
const parseTsv = (text) => {
  const [h, ...lines] = text.trimEnd().split(/\r?\n/);
  if (!h) return [];
  const keys = h.split("\t");
  return lines.filter(Boolean).map((line) => Object.fromEntries(keys.map((k, i) => [k, line.split("\t")[i] ?? ""])));
};

function restoreBase(releaseDir, outDir) {
  const receiptName = findOne(releaseDir, (n) => n.endsWith(".receipt.json") && json(path.join(releaseDir, n)).schema === "repo-head-release/1", "repo-head receipt");
  const receipt = json(path.join(releaseDir, receiptName));
  if (receipt.status !== "PASS" || receipt.shallow !== true || receipt.commit_count !== 1) fail("repo-head receipt is not PASS/shallow/one-commit");
  const head = hex(receipt.head, 40, "head");
  const tree = hex(receipt.tree, 40, "tree");
  const archive = receipt.archive;
  const carrier = receipt.carrier;
  if (!archive || !carrier || carrier.codec !== "standard-base64" || carrier.decoded_sha256 !== archive.sha256) fail("repo-head receipt carrier contract mismatch");
  hex(archive.sha256, 64, "archive sha256");
  hex(carrier.sha256, 64, "carrier sha256");

  const carrierPath = path.join(releaseDir, carrier.name);
  const text = fs.readFileSync(carrierPath, "utf8");
  if (Buffer.byteLength(text) !== carrier.bytes || sha256(Buffer.from(text)) !== carrier.sha256) fail("carrier bytes/hash mismatch");
  const decoded = canonicalB64(text, "base carrier");
  if (decoded.length !== archive.bytes || sha256(decoded) !== archive.sha256) fail("decoded archive bytes/hash mismatch");
  const rawPath = path.join(releaseDir, archive.name);
  if (fs.existsSync(rawPath) && !fs.readFileSync(rawPath).equals(decoded)) fail("raw archive and Carrier payload differ");

  const archivePath = path.join(outDir, archive.name);
  fs.writeFileSync(archivePath, decoded);
  const entries = run("tar", ["-tzf", archivePath]).stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.some((x) => x !== ".git" && !x.startsWith(".git/"))) fail("archive contains paths outside .git");
  const worktree = path.join(outDir, "worktree");
  fs.mkdirSync(worktree);
  run("tar", ["-xzf", archivePath, "-C", worktree]);
  run("git", ["-C", worktree, "reset", "--hard", "HEAD"]);
  if (run("git", ["-C", worktree, "rev-parse", "HEAD"]).stdout.trim() !== head) fail("restored HEAD mismatch");
  if (run("git", ["-C", worktree, "rev-parse", "HEAD^{tree}"]).stdout.trim() !== tree) fail("restored tree mismatch");
  if (run("git", ["-C", worktree, "rev-parse", "--is-shallow-repository"]).stdout.trim() !== "true") fail("restored repo is not shallow");
  if (run("git", ["-C", worktree, "rev-list", "--count", "HEAD"]).stdout.trim() !== "1") fail("restored repo is not one-commit");
  run("git", ["-C", worktree, "fsck", "--no-dangling"]);
  return { head, tree, worktree, archiveSha256: archive.sha256, carrierSha256: carrier.sha256 };
}

function readIntake(releaseDir) {
  const name = findOne(releaseDir, (n) => /^carrier\.intake\.[a-f0-9]{64}\.b64\.txt$/.test(n), "intake Carrier");
  const expected = name.split(".")[2];
  const payload = canonicalB64(fs.readFileSync(path.join(releaseDir, name), "utf8"), "intake Carrier");
  if (sha256(payload) !== expected) fail("intake Carrier payload SHA-256 mismatch");
  const intake = JSON.parse(payload.toString("utf8"));
  if (intake.schema !== "ops.capabilityLoop.intake.v1" || !intake.id || !intake.purpose || !intake.requestedPackage || !Array.isArray(intake.searchTerms)) fail("intake contract is invalid");
  return { intake, name, payloadSha256: expected };
}

function packageProjection(worktree) {
  const rows = fs.readFileSync(path.join(worktree, "build/packages.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const seen = new Set();
  return rows.map((decl) => {
    if (decl.kind !== "package" || !decl.name || seen.has(decl.name)) fail(`invalid/duplicate package row: ${decl.name ?? "?"}`);
    seen.add(decl.name);
    const root = decl.entry.split("/").slice(0, 2).join("/");
    const abs = path.join(worktree, root);
    if (!fs.statSync(abs).isDirectory()) fail(`package directory missing: ${root}`);
    const read = (n) => fs.existsSync(path.join(abs, n)) ? fs.readFileSync(path.join(abs, n), "utf8") : "";
    const role = `${read("default.nix")} ${read("README.md")}`.replace(/\s+/gu, " ").slice(0, 12000);
    return { authority: "build/packages.jsonl", eligible: "true", examples: role.slice(0, 2000), kind: "package", missingGoalNonGoal: "", pkg: decl.name, repo: "ops", role, source: root };
  });
}

function decide(rows, intake, projectionPath) {
  const names = new Set(rows.map((r) => r.pkg));
  if (names.has(intake.requestedPackage)) return { action: "reuse", exactPackage: intake.requestedPackage, reusePackages: [intake.requestedPackage], candidates: [] };
  const find = command("OPS_FIND_PACKAGES_COMMAND", ["find-packages"]);
  const hits = new Map();
  for (const term of [...new Set(intake.searchTerms.map((x) => String(x).trim()).filter(Boolean))]) {
    const r = call(find, ["--projection", projectionPath, "--query", term, "--require-eligible"], { allowed: [0, 3] });
    if (r.status === 3) continue;
    for (const row of parseTsv(r.stdout)) {
      const x = hits.get(row.pkg) ?? { pkg: row.pkg, matchedTerms: [], source: row.source };
      x.matchedTerms.push(term); hits.set(row.pkg, x);
    }
  }
  const candidates = [...hits.values()].sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.pkg.localeCompare(b.pkg));
  const compose = Array.isArray(intake.composeWith) ? [...new Set(intake.composeWith)] : [];
  if (compose.length && compose.every((x) => names.has(x))) return { action: "compose", exactPackage: null, reusePackages: compose, candidates };
  if (candidates.length) return { action: "extend", exactPackage: null, reusePackages: [candidates[0].pkg], candidates };
  return { action: "new", exactPackage: null, reusePackages: [], candidates };
}

function renderMap(rows, intake, decision, outDir) {
  const inventory = {
    direction: "LR", title: "Capability reuse loop",
    groups: [{ id: "ops_packages", kind: "group", label: `ops packages (${rows.length})`, children: rows.map((r) => ({ id: `pkg_${r.pkg}`, kind: "node", label: r.pkg, path: r.source })) }],
    nodes: [{ id: "intake", kind: "node", label: intake.requestedPackage }, { id: "decision", kind: "node", label: decision.action }],
    edges: [{ from: "intake", to: "decision", label: "dedup" }, ...decision.reusePackages.map((p) => ({ from: "decision", to: `pkg_${p}`, label: decision.action }))],
  };
  const inventoryPath = path.join(outDir, "repo-map.inventory.json");
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  const mapDir = path.join(outDir, "repo-map");
  const map = command("OPS_PACKAGE_MAP_COMMAND", ["package-architecture-map"]);
  const args = ["--inventory", inventoryPath, "--out-dir", mapDir, "--name", "capability-loop"];
  if (process.env.PACKAGE_ARCHITECTURE_MAP_VIEWER) args.push("--viewer", process.env.PACKAGE_ARCHITECTURE_MAP_VIEWER);
  call(map, args);
  return { inventoryPath, mapDir };
}

function main() {
  const args = process.argv.slice(2); const opts = {};
  if (args.shift() !== "run") fail("usage: ops-capability-loop run --release-dir DIR --out-dir DIR");
  while (args.length) { const k = args.shift(); const v = args.shift(); if (!['--release-dir','--out-dir'].includes(k) || !v) fail("invalid arguments"); opts[k.slice(2)] = v; }
  const releaseDir = fs.realpathSync(opts["release-dir"]); const outDir = path.resolve(opts["out-dir"]);
  if (fs.existsSync(outDir)) fail("out-dir already exists"); fs.mkdirSync(outDir, { recursive: true });
  const base = restoreBase(releaseDir, outDir); const { intake, name: intakeCarrier, payloadSha256: intakeSha } = readIntake(releaseDir);
  const rows = packageProjection(base.worktree); const projection = path.join(outDir, "package-projection.jsonl");
  fs.writeFileSync(projection, `${rows.map((x) => JSON.stringify(x)).join("\n")}\n`);
  const decision = decide(rows, intake, projection); renderMap(rows, intake, decision, outDir);
  const next = { schema: "ops.capabilityLoop.intake.v1", id: `${intake.id}.next`, purpose: intake.purpose, requestedPackage: intake.requestedPackage, searchTerms: intake.searchTerms, composeWith: decision.reusePackages, previous: { baseHead: base.head, action: decision.action } };
  const nextBytes = Buffer.from(`${JSON.stringify(next)}\n`); const nextSha = sha256(nextBytes); const nextCarrier = `carrier.intake.${nextSha}.b64.txt`;
  fs.writeFileSync(path.join(outDir, nextCarrier), nextBytes.toString("base64"));
  const receipt = { schema: "ops.capabilityLoop.receipt.v1", status: "PASS", base, intake: { carrier: intakeCarrier, payloadSha256: intakeSha }, packageCount: rows.length, decision, outputs: { projection: "package-projection.jsonl", repoMap: "repo-map/latest.mmd", nextCarrier } };
  fs.writeFileSync(path.join(outDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: "PASS", action: decision.action, baseHead: base.head, packageCount: rows.length, nextCarrier })}\n`);
}

try { main(); } catch (e) { process.stderr.write(`ops-capability-loop: ${e.message}\n`); process.exit(1); }
