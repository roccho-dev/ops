#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootRepo = path.resolve(here, "../../..");
const cli = path.join(rootRepo, "packages/ops-capability-loop/bin/ops-capability-loop.mjs");
const find = path.join(rootRepo, "packages/find-packages/bin/find-packages.mjs");
const map = path.join(rootRepo, "packages/package-architecture-map/bin/package-architecture-map.mjs");
const viewer = path.join(rootRepo, "packages/package-architecture-map/viewer/index.html");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const run = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o }); if (r.error) throw r.error; if (!(o.allowed ?? [0]).includes(r.status)) throw new Error(`${cmd} ${args.join(" ")} => ${r.status}\n${r.stderr}`); return r; };
const git = (repo, ...args) => run("git", ["-C", repo, ...args]).stdout.trim();

function addPackage(repo, name, role) {
  const dir = path.join(repo, "packages", name); fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bin", `${name}.mjs`), "#!/usr/bin/env node\n");
  fs.writeFileSync(path.join(dir, "README.md"), `${role}\n`);
  fs.writeFileSync(path.join(dir, "default.nix"), `builtins.fromJSON ''{"mission":${JSON.stringify(role)},"responsibility":${JSON.stringify(role)}}''\n`);
  return { bin: name, deps: ["node"], entry: `packages/${name}/bin/${name}.mjs`, env: [], kind: "package", name, runtime: "node" };
}
function sourceRepo(dir, includeLoop = false) {
  const repo = path.join(dir, includeLoop ? "src2" : "src1"); fs.mkdirSync(path.join(repo, "build"), { recursive: true }); run("git", ["init", "--quiet", "--initial-branch=proposals", repo]);
  git(repo, "config", "user.name", "test"); git(repo, "config", "user.email", "test@example.invalid");
  const rows = [
    addPackage(repo, "find-packages", "Find existing packages before implementation."),
    addPackage(repo, "package-architecture-map", "Render a non-authoritative package map."),
    addPackage(repo, "ops-artifact-materialize", "Restore exact artifact bytes."),
  ];
  if (includeLoop) rows.push(addPackage(repo, "ops-capability-loop", "Close the capability reuse loop."));
  fs.writeFileSync(path.join(repo, "build/packages.jsonl"), `${rows.map(JSON.stringify).join("\n")}\n`); git(repo, "add", "."); git(repo, "commit", "--quiet", "-m", "base"); return repo;
}
function makeRelease(src, dir, intake) {
  const shallow = path.join(dir, "shallow"); run("git", ["clone", "--quiet", "--depth=1", `file://${src}`, shallow]);
  const head = git(shallow, "rev-parse", "HEAD"), tree = git(shallow, "rev-parse", "HEAD^{tree}");
  const release = path.join(dir, "release"); fs.mkdirSync(release); const archiveName = `${head}.git.tar.gz`; const archivePath = path.join(release, archiveName);
  run("tar", ["-C", shallow, "-czf", archivePath, ".git"]); const bytes = fs.readFileSync(archivePath); const archiveSha = sha(bytes);
  const carrierName = `${archiveName}.b64.txt`; const carrierText = bytes.toString("base64"); fs.writeFileSync(path.join(release, carrierName), carrierText);
  const receipt = { schema: "repo-head-release/1", status: "PASS", id: head, source_repo: "fixture/ops", default_branch: "proposals", head, tree, shallow: true, commit_count: 1, archive: { name: archiveName, bytes: bytes.length, sha256: archiveSha }, carrier: { name: carrierName, bytes: Buffer.byteLength(carrierText), sha256: sha(Buffer.from(carrierText)), codec: "standard-base64", decoded_sha256: archiveSha }, release: { tag: `repo-head-${head}`, prerelease: false } };
  fs.writeFileSync(path.join(release, `${head}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  const intakeBytes = Buffer.from(`${JSON.stringify(intake)}\n`); const intakeSha = sha(intakeBytes); fs.writeFileSync(path.join(release, `carrier.intake.${intakeSha}.b64.txt`), intakeBytes.toString("base64"));
  return { release, head, carrierName };
}
function execute(release, out, allowed = [0]) {
  return run(process.execPath, [cli, "run", "--release-dir", release, "--out-dir", out], { allowed, env: { ...process.env, OPS_FIND_PACKAGES_COMMAND: JSON.stringify([process.execPath, find]), OPS_PACKAGE_MAP_COMMAND: JSON.stringify([process.execPath, map]), PACKAGE_ARCHITECTURE_MAP_VIEWER: viewer } });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-loop-"));
try {
  const intake = { schema: "ops.capabilityLoop.intake.v1", id: "want-loop", purpose: "Reuse existing package discovery and map rendering before creating a loop package.", requestedPackage: "ops-capability-loop", searchTerms: ["package", "map"], composeWith: ["find-packages", "package-architecture-map"] };
  const first = makeRelease(sourceRepo(path.join(tmp, "a"), false), path.join(tmp, "a"), intake); const out1 = path.join(tmp, "out1");
  const r1 = JSON.parse(execute(first.release, out1).stdout); assert.equal(r1.status, "PASS"); assert.equal(r1.action, "compose"); assert.ok(fs.existsSync(path.join(out1, "repo-map/latest.mmd"))); assert.ok(fs.existsSync(path.join(out1, "repo-map/index.html"))); assert.equal(git(path.join(out1, "worktree"), "rev-parse", "--is-shallow-repository"), "true");
  const second = makeRelease(sourceRepo(path.join(tmp, "b"), true), path.join(tmp, "b"), intake); const out2 = path.join(tmp, "out2");
  const r2 = JSON.parse(execute(second.release, out2).stdout); assert.equal(r2.action, "reuse");
  fs.appendFileSync(path.join(second.release, second.carrierName), "\n"); const bad = execute(second.release, path.join(tmp, "bad"), [1]); assert.match(bad.stderr, /carrier bytes\/hash mismatch|canonical Base64/);
  process.stdout.write(`${JSON.stringify({ status: "PASS", positive: 2, negative: 1, first: r1.action, second: r2.action })}\n`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
