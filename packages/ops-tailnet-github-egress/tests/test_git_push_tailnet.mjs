#!/usr/bin/env node
// Offline tests for git-push-tailnet default resolution and safety.
// Node ESM port of test_git_push_tailnet.py.

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT =
  process.env.GIT_PUSH_TAILNET_SCRIPT ||
  path.join(path.dirname(__dirname), "bin", "git-push-tailnet.mjs");

function run(cmd, { cwd = null, check = true, env = null, timeout = 20 } = {}) {
  const opts = { encoding: "utf8", timeout: timeout * 1000, stdio: ["ignore", "pipe", "pipe"] };
  if (cwd) opts.cwd = cwd;
  if (env) opts.env = env;
  const result = spawnSync(cmd[0], cmd.slice(1), opts);
  const returncode = result.status === null ? (result.signal ? 128 : 1) : result.status;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (check && returncode !== 0) {
    throw new Error(`failed: ${cmd.join(" ")}\nstdout=${stdout}\nstderr=${stderr}`);
  }
  return { returncode, stdout, stderr };
}

function initRepo(root) {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  run(["git", "init", "-q", "-b", "main", repo]);
  run(["git", "config", "user.email", "git-push-tailnet@example.invalid"], { cwd: repo });
  run(["git", "config", "user.name", "git-push-tailnet"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "ok\n", { encoding: "utf8" });
  run(["git", "add", "README.md"], { cwd: repo });
  run(["git", "commit", "-q", "-m", "init"], { cwd: repo });
  return repo;
}

function jsonRun(repo, args, { check = true } = {}) {
  const result = run(["node", SCRIPT, "--repo-dir", repo, "--json", ...args], { check });
  return [result, JSON.parse(result.stdout)];
}

function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + (msg || ""));
}

function withTempDir(fn) {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "git-push-tailnet-test-"));
  try {
    fn(td);
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
}

function testDefaultOriginFetchWhenPushurlDisabled() {
  withTempDir((td) => {
    const repo = initRepo(td);
    run(["git", "remote", "add", "origin", "git@github.com:roccho-dev/flakes.git"], { cwd: repo });
    run(["git", "remote", "set-url", "--push", "origin", "DISABLED-use-git-push-tailnet"], { cwd: repo });
    const [result, data] = jsonRun(repo, ["--dry-run"]);
    assert(result.returncode === 0);
    assert(data.remote === "git@github.com:roccho-dev/flakes.git");
    assert(data.remoteSource === "origin-fetch-because-pushurl-disabled");
    assert(data.refspec === "HEAD:refs/heads/main");
    assert(data.command.includes("--long-transfer"));
  });
}

function testRefspecAndRefsVault() {
  withTempDir((td) => {
    const repo = initRepo(td);
    let [result, data] = jsonRun(repo, [
      "--remote",
      "git@github.com:roccho-dev/flakes.git",
      "HEAD:refs/heads/topic",
      "--dry-run",
    ]);
    assert(result.returncode === 0);
    assert(data.dstRef === "refs/heads/topic");

    [result, data] = jsonRun(repo, [
      "--remote",
      "git@github.com:roccho-dev/refs.git",
      "--refs-vault",
      "--repo-id",
      "flakes",
      "--branch",
      "topic",
      "--dry-run",
    ]);
    assert(result.returncode === 0);
    assert(data.dstRef === "refs/heads/repos/flakes/topic");
  });
}

function testNonGithubAndDetachedFail() {
  withTempDir((td) => {
    const repo = initRepo(td);
    let [result, data] = jsonRun(repo, ["--remote", "ssh://git@example.invalid/repo.git", "--dry-run"], {
      check: false,
    });
    assert(result.returncode !== 0);
    assert(data.error.includes("non-GitHub"));

    const head = run(["git", "rev-parse", "HEAD"], { cwd: repo }).stdout.trim();
    run(["git", "checkout", "-q", "--detach", head], { cwd: repo });
    [result, data] = jsonRun(repo, ["--remote", "git@github.com:roccho-dev/flakes.git", "--dry-run"], {
      check: false,
    });
    assert(result.returncode !== 0);
    assert(data.error.includes("detached HEAD"));
  });
}

testDefaultOriginFetchWhenPushurlDisabled();
testRefspecAndRefsVault();
testNonGithubAndDetachedFail();
process.stdout.write("ok\n");
