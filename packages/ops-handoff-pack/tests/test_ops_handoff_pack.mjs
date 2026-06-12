#!/usr/bin/env node
// End-to-end test for ops-handoff-pack.
//
// Builds two real git repos, runs create (which invokes ops-handoff-core
// generate + validate internally), then proves the semantic guarantees:
// pack digest tamper, merge-target drift, request tamper, and stub payload
// all fail validation.
//
// Self-contained: fixtures are synthesized in tmp, and the binaries are
// taken from sibling sources when present (local run) or from PATH (the
// generated flake check copies only this script into the store).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingPackBin = path.join(here, "..", "bin", "ops-handoff-pack.mjs");
const siblingCoreBin = path.join(here, "..", "..", "ops-handoff-core", "bin", "ops-handoff-core.mjs");
const packCmd = fs.existsSync(siblingPackBin) ? [process.execPath, siblingPackBin] : ["ops-handoff-pack"];
const coreCmd = fs.existsSync(siblingCoreBin) ? [process.execPath, siblingCoreBin] : ["ops-handoff-core"];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-handoff-pack-test-"));

// Synthesized fixtures (shape-compatible with ops-handoff-core's).
const fixtures = path.join(tmp, "fixtures");
fs.mkdirSync(fixtures, { recursive: true });
function fixture(name, content) {
  const p = path.join(fixtures, name);
  fs.writeFileSync(p, content);
  return p;
}
const roleCatalogPath = fixture(
  "role-catalog.md",
  "# Role catalog\n\n- `role.implWorker`\n- `role.implReviewer`\n- `role.mergeExecutor`\n- `role.mergeReviewer`\n- `actor.chatgpt.project`\n",
);
const topologyPath = fixture(
  "organization-topology.a2ui.jsonl",
  '{"kind":"a2ui.node","id":"gen0"}\n{"kind":"a2ui.node","id":"actor.chatgpt.project"}\n',
);
const commandBoardPath = fixture("command-board.a2ui.jsonl", '{"kind":"a2ui.request","id":"req-test"}\n');
const requestPath = fixture("REQUEST.md", "# test request\n\nImplement the candidate delta.\n");
const rosterPath = fixture(
  "thread-roster.json",
  JSON.stringify({
    threads: ["impl-work", "impl-review", "merge-work", "merge-review"].map((fn) => ({
      threadFunction: fn,
      actorId: `actor.chatgpt.project.${fn}`,
      parentActor: "gen0",
    })),
  }),
);
const gitEnv = {
  ...process.env,
  HOME: tmp,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, {
    encoding: "utf-8",
    env: gitEnv,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function git(root, argv) {
  return sh("git", ["-C", root, ...argv]).trim();
}

function makeRepo(name) {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  sh("git", ["init", "-q", "-b", "main", root]);
  fs.writeFileSync(path.join(root, "README.md"), `# ${name}\n`);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "init"]);
  git(root, ["checkout", "-q", "-b", "candidate"]);
  fs.writeFileSync(path.join(root, "feature.txt"), "candidate change\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "candidate work"]);
  return root;
}

// runPack returns {code, json} and never throws on non-zero exit.
function runPack(argv) {
  try {
    const out = sh(packCmd[0], [...packCmd.slice(1), ...argv]);
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    const out = e.stdout ? String(e.stdout) : "";
    let json = null;
    try {
      json = JSON.parse(out);
    } catch {
      json = { raw: out, stderr: e.stderr ? String(e.stderr) : "" };
    }
    return { code: e.status === undefined ? -1 : e.status, json };
  }
}

const repoA = makeRepo("repo-a");
const repoB = makeRepo("repo-b");
const headA = git(repoA, ["rev-parse", "main"]);
const candA = git(repoA, ["rev-parse", "candidate"]);

const outDir = path.join(tmp, "out");
const createArgs = [
  "create",
  "--repo", `repo-a=${repoA}@main..candidate`,
  "--repo", `repo-b=${repoB}@main..candidate`,
  "--role-catalog", roleCatalogPath,
  "--topology", topologyPath,
  "--command-board", commandBoardPath,
  "--request", requestPath,
  "--thread-roster", rosterPath,
  "--handoff-core", coreCmd.join(" "),
  "--out-dir", outDir,
  "--json",
];

// 1. create succeeds end to end (core generate + core validate + pack validate).
const created = runPack(createArgs);
assert.equal(created.code, 0, `create failed: ${JSON.stringify(created.json)}`);
assert.equal(created.json.status, "handoff-pack-created");
assert.equal(created.json.coreStatus, "handoff-valid");
assert.equal(created.json.packStatus, "handoff-pack-valid");

const handoffDir = created.json.handoffDir;
const repoEntryA = created.json.repos.find((r) => r.repoId === "repo-a");
assert.equal(repoEntryA.baseHead, headA, "baseHead derived from git, not hand-written");
assert.equal(repoEntryA.candidateHead, candA);

// Generated manifests are v2 and cross-consistent.
const srcManifest = JSON.parse(fs.readFileSync(path.join(handoffDir, "COMMON", "source-manifest.json"), "utf-8"));
const mergeTarget = JSON.parse(fs.readFileSync(path.join(handoffDir, "COMMON", "merge-target.json"), "utf-8"));
assert.equal(srcManifest.kind, "source.manifest.v2");
assert.equal(mergeTarget.kind, "merge.target.v2");
assert.equal(srcManifest.repos.length, 2);
assert.equal(mergeTarget.canonicalMergeAuthorized, false);
assert.equal(mergeTarget.pushAuthorized, false);

// HANDOFF_MANIFEST records the real payload kind, not unknown/stub.
const handoffManifest = JSON.parse(fs.readFileSync(path.join(handoffDir, "HANDOFF_MANIFEST.json"), "utf-8"));
assert.equal(handoffManifest.payload.payloadKind, "src-pack");
assert.equal(handoffManifest.payload.provider, "ops-handoff-pack");

// 2. validate passes, including live re-verification against the repos.
const validated = runPack([
  "validate",
  "--handoff-dir", handoffDir,
  "--repo", `repo-a=${repoA}`,
  "--repo", `repo-b=${repoB}`,
]);
assert.equal(validated.code, 0, `validate failed: ${JSON.stringify(validated.json)}`);
assert.equal(validated.json.status, "handoff-pack-valid");

// 3. tampering with a source pack is caught by digest recomputation.
const packPath = path.join(handoffDir, "SRC", "repo-a.tar.gz");
const original = fs.readFileSync(packPath);
const tampered = Buffer.from(original);
tampered[tampered.length - 1] ^= 0xff;
fs.writeFileSync(packPath, tampered);
const tamperResult = runPack(["validate", "--handoff-dir", handoffDir]);
assert.equal(tamperResult.code, 1);
assert.ok(
  tamperResult.json.errors.some((e) => e.includes("digest mismatch")),
  `expected digest mismatch, got: ${JSON.stringify(tamperResult.json.errors)}`,
);
fs.writeFileSync(packPath, original);

// 4. merge-target drift against source-manifest is caught.
const mtPath = path.join(handoffDir, "COMMON", "merge-target.json");
const mtOriginal = fs.readFileSync(mtPath, "utf-8");
const drifted = JSON.parse(mtOriginal);
drifted.repos[0].baseHead = "0".repeat(40);
fs.writeFileSync(mtPath, JSON.stringify(drifted, null, 2));
const driftResult = runPack(["validate", "--handoff-dir", handoffDir]);
assert.equal(driftResult.code, 1);
assert.ok(driftResult.json.errors.some((e) => e.includes("base head mismatch")));
fs.writeFileSync(mtPath, mtOriginal);

// 5. tampering with REQUEST.md is caught.
const requestCopyPath = path.join(handoffDir, "REQUEST.md");
const requestOriginal = fs.readFileSync(requestCopyPath, "utf-8");
fs.writeFileSync(requestCopyPath, requestOriginal + "\ninjected\n");
const requestResult = runPack(["validate", "--handoff-dir", handoffDir]);
assert.equal(requestResult.code, 1);
assert.ok(requestResult.json.errors.some((e) => e.includes("REQUEST.md")));
fs.writeFileSync(requestCopyPath, requestOriginal);

// 6. live re-verification catches base branch drift after pack creation.
git(repoA, ["checkout", "-q", "main"]);
fs.writeFileSync(path.join(repoA, "drift.txt"), "moved on\n");
git(repoA, ["add", "."]);
git(repoA, ["commit", "-q", "-m", "main moved"]);
const liveDrift = runPack(["validate", "--handoff-dir", handoffDir, "--repo", `repo-a=${repoA}`]);
assert.equal(liveDrift.code, 1);
assert.ok(liveDrift.json.errors.some((e) => e.includes("live base head drift")));

// 7. a bare ops-handoff-core handoff (stub payload, v1 manifests) does NOT
//    pass pack validation: the wrapper closes the stub hole.
const stubDir = path.join(tmp, "stub-handoff");
const v1SourceManifest = fixture(
  "source-manifest.json",
  JSON.stringify({ kind: "source.manifest.v1", repoId: "ops", baseHead: "base000", candidateHead: "cand000", path: "SRC/src.tar.zst" }),
);
const v1RuntimeManifest = fixture(
  "runtime-manifest.json",
  JSON.stringify({ kind: "runtime.manifest.v1", system: "x86_64-linux", checks: [] }),
);
const v1MergeTarget = fixture(
  "merge-target.json",
  JSON.stringify({ kind: "merge.target.v1", repoId: "ops", baseBranch: "main", candidateBranch: "candidate", canonicalMergeAuthorized: false, pushAuthorized: false }),
);
sh(coreCmd[0], [
  ...coreCmd.slice(1),
  "generate",
  "--role-catalog", roleCatalogPath,
  "--topology", topologyPath,
  "--command-board", commandBoardPath,
  "--request", requestPath,
  "--source-manifest", v1SourceManifest,
  "--runtime-manifest", v1RuntimeManifest,
  "--merge-target", v1MergeTarget,
  "--thread-roster", rosterPath,
  "--out-dir", stubDir,
]);
const stubResult = runPack(["validate", "--handoff-dir", stubDir]);
assert.equal(stubResult.code, 1);
assert.ok(stubResult.json.errors.some((e) => e.includes("stub payload is not allowed")));
assert.ok(stubResult.json.errors.some((e) => e.includes("source.manifest.v2")));

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("ops-handoff-pack: all tests passed\n");
