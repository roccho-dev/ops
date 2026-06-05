#!/usr/bin/env node
// Static behavior tests for ops-src-runtime-pack (Node port of the Python test).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

function assert(cond, message) {
  if (!cond) throw new Error("AssertionError: " + (message || ""));
}

function run(cmd, cwd = undefined) {
  const proc = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf-8" });
  if (proc.status !== 0) {
    throw new Error(
      `command failed ${proc.status}: ${cmd.join(" ")}\n` + `stdout:\n${proc.stdout}\nstderr:\n${proc.stderr}`,
    );
  }
  return proc;
}

// Parse member names from a gzipped USTAR tar (stdlib only).
function tarNames(tarGzPath) {
  const tar = zlib.gunzipSync(fs.readFileSync(tarGzPath));
  const names = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const block = tar.subarray(off, off + 512);
    // end of archive = zero block
    if (block.every((b) => b === 0)) break;
    let end = 0;
    while (end < 100 && block[end] !== 0) end++;
    const name = block.subarray(0, end).toString("binary");
    // size field octal at 124, 12 bytes
    let sizeStr = block.subarray(124, 136).toString("binary").replace(/\0/g, "").trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    names.push(name);
    const dataBlocks = Math.ceil(size / 512);
    off += 512 + dataBlocks * 512;
  }
  return names;
}

function main(argv) {
  const packageDir = path.resolve(argv[0]);
  const outRoot = path.resolve(argv[1]);
  const binPath = path.join(packageDir, "bin", "ops-src-runtime-pack.mjs");
  const repo = path.join(outRoot, "fixture");
  const pack = path.join(outRoot, "pack");
  fs.mkdirSync(repo, { recursive: true });

  const node = process.execPath;

  run(["git", "init"], repo);
  run(["git", "config", "user.email", "ops-src-runtime-pack@example.invalid"], repo);
  run(["git", "config", "user.name", "ops-src-runtime-pack"], repo);
  fs.writeFileSync(
    path.join(repo, "flake.lock"),
    '{\n  "nodes": {\n    "root": {\n      "inputs": {}\n    }\n  },\n  "root": "root",\n  "version": 7\n}\n',
    "utf-8",
  );
  fs.writeFileSync(path.join(repo, "README.md"), "fixture source\n", "utf-8");
  fs.writeFileSync(path.join(repo, "UNTRACKED.txt"), "do not include by default\n", "utf-8");
  run(["git", "add", "flake.lock", "README.md"], repo);
  run(["git", "commit", "-m", "fixture"], repo);

  const create = run([
    node,
    binPath,
    "create",
    "--repo-root",
    repo,
    "--package-name",
    "fixture",
    "--installable",
    ".#fixture",
    "--policy-file",
    path.join(repo, "README.md"),
    "--metadata-only",
    "--out-dir",
    pack,
    "--json",
  ]);
  const created = JSON.parse(create.stdout);
  assert(created.status === "src-runtime-pack-created", "create status");

  const validate = run([node, binPath, "validate", "--pack-dir", pack, "--json"]);
  const valid = JSON.parse(validate.stdout);
  assert(valid.status === "src-runtime-pack-valid", "validate status");

  const manifest = JSON.parse(fs.readFileSync(path.join(pack, "MANIFEST.json"), "utf-8"));
  assert(manifest.kind === "ops.srcRuntimePack.v1", "kind");
  assert(manifest.metadataOnly === true, "metadataOnly");
  assert(manifest.approvalBoundary.semanticApproval === false, "semanticApproval");
  assert(manifest.approvalBoundary.completionApproval === false, "completionApproval");
  assert(manifest.approvalBoundary.routeDecision === false, "routeDecision");
  assert(manifest.source.archive.sha256, "archive sha256");
  assert(manifest.source.archive.includeUntracked === false, "includeUntracked");

  const archiveNames = new Set(tarNames(path.join(pack, "SRC", "source.tar.gz")));
  assert(archiveNames.has("src/README.md"), "has src/README.md");
  assert(!archiveNames.has("src/UNTRACKED.txt"), "no src/UNTRACKED.txt");
  assert(fs.statSync(path.join(pack, "SRC", "source.tar.gz")).isFile(), "tar exists");
  assert(fs.statSync(path.join(pack, "NIX", "flake.lock")).isFile(), "flake.lock copied");
  assert(fs.statSync(path.join(pack, "POLICY", "policy-manifest.json")).isFile(), "policy manifest");

  const startHere = fs.readFileSync(path.join(pack, "START_HERE.txt"), "utf-8");
  assert(startHere.includes(manifest.packNonce), "packNonce in START_HERE");
  assert(startHere.includes("includeUntracked: False"), "includeUntracked False");
  assert(startHere.includes("firstPolicySha256:"), "firstPolicySha256");
  assert(startHere.includes("requiredDependencyClasses count:"), "requiredDependencyClasses count");

  const noLockRepo = path.join(outRoot, "no-lock-fixture");
  const noLockPack = path.join(outRoot, "no-lock-pack");
  fs.mkdirSync(noLockRepo, { recursive: true });
  run(["git", "init"], noLockRepo);
  run(["git", "config", "user.email", "ops-src-runtime-pack@example.invalid"], noLockRepo);
  run(["git", "config", "user.name", "ops-src-runtime-pack"], noLockRepo);
  fs.writeFileSync(path.join(noLockRepo, "README.md"), "fixture without flake lock\n", "utf-8");
  run(["git", "add", "README.md"], noLockRepo);
  run(["git", "commit", "-m", "fixture-no-lock"], noLockRepo);
  run([
    node,
    binPath,
    "create",
    "--repo-root",
    noLockRepo,
    "--package-name",
    "fixture-no-lock",
    "--installable",
    ".#fixture",
    "--metadata-only",
    "--out-dir",
    noLockPack,
    "--json",
  ]);
  run([node, binPath, "validate", "--pack-dir", noLockPack, "--json"]);
  const noLockManifest = JSON.parse(fs.readFileSync(path.join(noLockPack, "MANIFEST.json"), "utf-8"));
  assert(noLockManifest.nix.flakeLock.present === false, "no-lock present false");
  assert(!fs.existsSync(path.join(noLockPack, "NIX", "flake.lock")), "no-lock flake.lock absent");
  return 0;
}

process.exit(main(process.argv.slice(2)));
