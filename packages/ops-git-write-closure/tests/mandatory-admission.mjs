#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const policyRoot = path.join(repoRoot, "packages/shiftleft-admission/policy");
const fixturesRoot = path.join(repoRoot, "packages/shiftleft-admission/fixtures");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!(options.allowed ?? [0]).includes(result.status)) {
    throw new Error(`${command} ${args.join(" ")} => ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function git(repo, ...args) {
  return run("git", ["-C", repo, ...args]).stdout.trim();
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function candidateTree(repo, indexFile) {
  fs.copyFileSync(path.join(repo, ".git", "index"), indexFile);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  run("git", ["-C", repo, "add", "-A", "--", "."], { env });
  return run("git", ["-C", repo, "write-tree"], { env }).stdout.trim();
}

function requestFor(repo, baseSha, receipt, policyHash, id) {
  const targetBranch = `proposal/connector/${id}`;
  return {
    schema: "ops.gitWriteRequest.v1",
    requestId: id,
    sourceRepo: "roccho-dev/ops",
    baseRef: "proposals",
    baseSha,
    worktree: repo,
    targetBranch,
    commitMessage: "proof: admitted candidate",
    force: false,
    pullRequest: {
      base: "proposals",
      head: targetBranch,
      title: "proof",
      body: "proof",
      draft: true,
    },
    checks: [{
      id: "shiftleft-admission",
      command: [
        "policyctl",
        "verify-worktree",
        "--receipt",
        receipt,
        "--policy-sha256",
        policyHash,
        "--repo",
        repo,
      ],
      timeoutSeconds: 120,
    }],
    adapter: {
      id: "local-proof",
      maxBlobBytes: 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
      supportsBase64: true,
      supportsCreateTree: true,
      supportsCreateCommit: true,
      supportsRefWrite: true,
      supportsPrCreate: true,
    },
  };
}

function prepare(requestFile, outDir, allowed = [0]) {
  return run("ops-git-write-closure", [
    "prepare",
    "--request",
    requestFile,
    "--out-dir",
    outDir,
    "--state-dir",
    `${outDir}.state`,
  ], { allowed });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-mandatory-admission-"));
try {
  const repo = path.join(temp, "repo");
  fs.mkdirSync(repo);
  run("git", ["init", "--quiet", "--initial-branch=proposals", repo]);
  git(repo, "config", "user.name", "proof");
  git(repo, "config", "user.email", "proof@example.invalid");
  fs.writeFileSync(path.join(repo, "value.txt"), "before\n");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  const baseSha = git(repo, "rev-parse", "HEAD");
  const baseTree = git(repo, "rev-parse", "HEAD^{tree}");

  fs.writeFileSync(path.join(repo, "value.txt"), "after\n");
  const tree = candidateTree(repo, path.join(temp, "candidate.index"));
  const policyHash = run("policyctl", ["hash", "--bundle", policyRoot]).stdout.trim();
  const proofDir = path.join(temp, "proof");
  run("policyctl", [
    "proof",
    "--bundle",
    policyRoot,
    "--fixtures",
    fixturesRoot,
    "--policy-ref",
    baseSha,
    "--base-tree",
    `git-tree-sha1:${baseTree}`,
    "--candidate-tree",
    `git-tree-sha1:${tree}`,
    "--out-dir",
    proofDir,
  ]);
  const receipt = path.join(proofDir, "receipt.1.json");

  const accepted = requestFor(repo, baseSha, receipt, policyHash, "mandatory-admission-pass");
  const acceptedFile = path.join(temp, "accepted.json");
  const acceptedOut = path.join(temp, "accepted-out");
  writeJson(acceptedFile, accepted);
  prepare(acceptedFile, acceptedOut);
  assert.equal(fs.existsSync(path.join(acceptedOut, "effect-plan.json")), true);

  const missing = structuredClone(accepted);
  missing.requestId = "mandatory-admission-missing";
  missing.targetBranch = `proposal/connector/${missing.requestId}`;
  missing.pullRequest.head = missing.targetBranch;
  missing.checks = [];
  const missingFile = path.join(temp, "missing.json");
  writeJson(missingFile, missing);
  const missingOut = path.join(temp, "missing-out");
  const missingResult = prepare(missingFile, missingOut, [1]);
  assert.match(missingResult.stderr, /SHIFTLEFT_ADMISSION_REQUIRED/);
  assert.equal(fs.existsSync(path.join(missingOut, "effect-plan.json")), false);

  const duplicate = structuredClone(accepted);
  duplicate.requestId = "mandatory-admission-duplicate";
  duplicate.targetBranch = `proposal/connector/${duplicate.requestId}`;
  duplicate.pullRequest.head = duplicate.targetBranch;
  duplicate.checks.push(structuredClone(duplicate.checks[0]));
  const duplicateFile = path.join(temp, "duplicate.json");
  writeJson(duplicateFile, duplicate);
  assert.match(prepare(duplicateFile, path.join(temp, "duplicate-out"), [1]).stderr, /SHIFTLEFT_ADMISSION_REQUIRED/);

  const wrongCommand = structuredClone(accepted);
  wrongCommand.requestId = "mandatory-admission-command";
  wrongCommand.targetBranch = `proposal/connector/${wrongCommand.requestId}`;
  wrongCommand.pullRequest.head = wrongCommand.targetBranch;
  wrongCommand.checks[0].command[0] = "/tmp/policyctl";
  const wrongCommandFile = path.join(temp, "wrong-command.json");
  writeJson(wrongCommandFile, wrongCommand);
  assert.match(prepare(wrongCommandFile, path.join(temp, "wrong-command-out"), [1]).stderr, /INVALID_SHIFTLEFT_ADMISSION/);

  fs.writeFileSync(path.join(repo, "extra.txt"), "stale\n");
  const stale = requestFor(repo, baseSha, receipt, policyHash, "mandatory-admission-stale");
  const staleFile = path.join(temp, "stale.json");
  const staleOut = path.join(temp, "stale-out");
  writeJson(staleFile, stale);
  const staleResult = prepare(staleFile, staleOut, [1]);
  assert.match(staleResult.stderr, /CHECK_FAILED/);
  assert.match(staleResult.stderr, /CANDIDATE_TREE_MISMATCH/);
  assert.equal(fs.existsSync(path.join(staleOut, "effect-plan.json")), false);

  process.stdout.write("mandatory Shift Left admission: PASS\n");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
