import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { encodeRepoPath, projectHeadRef } from "../lib/ref-projection.mjs";

const CLI = new URL("../bin/ops-refs-vault.mjs", import.meta.url).pathname;

function run(cmd, args, { cwd = undefined, check = true, env = {} } = {}) {
  const proc = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (check && proc.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(" ")}\nstdout:\n${proc.stdout}\nstderr:\n${proc.stderr}`);
  }
  return proc;
}

function git(args, opts = {}) {
  return run("git", args, opts);
}

function cli(args, opts = {}) {
  return run(process.execPath, [CLI, ...args], opts);
}

function cliJson(args, opts = {}) {
  const proc = cli(args, opts);
  return { proc, json: proc.stdout.trim() ? JSON.parse(proc.stdout) : null };
}

function tmpRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ops-refs-vault-${name}-`));
}

function initBare(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  git(["init", "-q", "--bare", p]);
}

function initWork(p, branch, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  git(["init", "-q", "-b", branch, p]);
  git(["config", "user.email", "ops-refs-vault@example.invalid"], { cwd: p });
  git(["config", "user.name", "ops-refs-vault"], { cwd: p });
  fs.writeFileSync(path.join(p, "README.txt"), `${text}\n`);
  git(["add", "README.txt"], { cwd: p });
  git(["commit", "-q", "-m", text], { cwd: p });
}

function commitChange(work, text) {
  fs.writeFileSync(path.join(work, "README.txt"), `${text}\n`);
  git(["add", "README.txt"], { cwd: work });
  git(["commit", "-q", "-m", text], { cwd: work });
  return git(["rev-parse", "HEAD"], { cwd: work }).stdout.trim();
}

function pushWork(work, remote, branch = "main") {
  git(["push", remote, `HEAD:refs/heads/${branch}`], { cwd: work });
}

function hash(remote, ref) {
  const out = git(["ls-remote", remote, ref]).stdout.trim();
  if (!out) return null;
  return out.split(/\s+/)[0];
}

function makeManifest(root, bareRoot, vault) {
  const manifest = path.join(root, "manifest.json");
  cli(["generate-manifest", "--bare-root", bareRoot, "--out", manifest, "--remote", vault]);
  return manifest;
}

function setupSource(root, repoPath = "alpha", branch = "main") {
  const bare = path.join(root, "ssot", `${repoPath}.git`);
  const work = path.join(root, "work", repoPath);
  initBare(bare);
  initWork(work, branch, `${repoPath}-A`);
  pushWork(work, bare, branch);
  git(["--git-dir", bare, "symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  return { bare, work, branch, sourceOid: hash(bare, `refs/heads/${branch}`) };
}

function setupRemoteAhead(name) {
  const root = tmpRoot(name);
  const vault = path.join(root, "refs.git");
  initBare(vault);
  const { bare, work, branch, sourceOid } = setupSource(root, "alpha");
  const manifest = makeManifest(root, path.join(root, "ssot"), vault);
  cli(["backup-all", "--manifest", manifest]);
  const remoteRef = projectHeadRef(encodeRepoPath("alpha"), branch);
  const remoteOid = commitChange(work, "alpha-B");
  git(["push", vault, `HEAD:${remoteRef}`], { cwd: work });
  assert.equal(hash(bare, `refs/heads/${branch}`), sourceOid);
  assert.equal(hash(vault, remoteRef), remoteOid);
  return { root, vault, bare, work, branch, manifest, remoteRef, sourceOid, remoteOid };
}

test("managed root audit scans all remote heads and catches legacy and unknown extras", () => {
  const root = tmpRoot("scan-");
  const vault = path.join(root, "refs.git");
  initBare(vault);
  setupSource(root, "team/api");
  setupSource(root, "a");
  setupSource(root, "a/b");
  const manifest = makeManifest(root, path.join(root, "ssot"), vault);
  const manifestJson = JSON.parse(fs.readFileSync(manifest, "utf8"));
  assert.equal(manifestJson.refProjection.profile, "heads-v1");
  assert.equal(manifestJson.refProjection.repoKeyPrefix, "=r1-");
  assert.deepEqual(
    manifestJson.repos.map((repo) => repo.repoPath).sort(),
    ["a", "a/b", "team/api"],
  );
  assert.notEqual(
    projectHeadRef(encodeRepoPath("a"), "b/main"),
    projectHeadRef(encodeRepoPath("a/b"), "main"),
  );

  cli(["backup-all", "--manifest", manifest]);
  const apiBare = path.join(root, "ssot", "team/api.git");
  git(["--git-dir", apiBare, "push", vault, "refs/heads/main:refs/heads/repos/team/api/main"]);
  git(["--git-dir", apiBare, "push", vault, "refs/heads/main:refs/heads/single"]);

  const audit = cliJson(["orphan-audit", "--manifest", manifest], { check: false });
  assert.notEqual(audit.proc.status, 0);
  assert.equal(audit.json.ok, false);
  assert.equal(audit.json.counts["extra-legacy-schema"], 1);
  assert.equal(audit.json.counts["unknown-managed-extra"], 1);
  assert(audit.json.orphanRefs.includes("refs/heads/repos/team/api/main"));
  assert(audit.json.orphanRefs.includes("refs/heads/single"));

  const backup = cliJson(["backup-all", "--manifest", manifest], { check: false });
  assert.notEqual(backup.proc.status, 0);
  assert.equal(backup.json.mode, "backup-all-preflight");
  assert.equal(backup.json.counts["extra-legacy-schema"], 1);
});

test("remote-ahead and diverged refs are classified as candidates, not adopted by backup", () => {
  const ahead = setupRemoteAhead("ahead-");
  const plan = cliJson(["candidate-plan", "--manifest", ahead.manifest, "--repo-id", "alpha", "--branch", "main"]);
  assert.equal(plan.json.classification, "remote-ahead-candidate");
  assert.equal(plan.json.sourceOid, ahead.sourceOid);
  assert.equal(plan.json.remoteOid, ahead.remoteOid);

  const backup = cliJson(["backup-all", "--manifest", ahead.manifest], { check: false });
  assert.notEqual(backup.proc.status, 0);
  assert.equal(backup.json.mode, "backup-all-preflight");
  assert.equal(backup.json.counts["remote-ahead-candidate"], 1);

  const root = tmpRoot("diverged-");
  const vault = path.join(root, "refs.git");
  initBare(vault);
  const { bare, work, branch } = setupSource(root, "alpha");
  const manifest = makeManifest(root, path.join(root, "ssot"), vault);
  cli(["backup-all", "--manifest", manifest]);
  const remoteRef = projectHeadRef(encodeRepoPath("alpha"), branch);
  commitChange(work, "alpha-remote-B");
  git(["push", vault, `HEAD:${remoteRef}`], { cwd: work });

  const sourceWork = path.join(root, "source-race");
  git(["clone", "-q", bare, sourceWork]);
  git(["config", "user.email", "ops-refs-vault@example.invalid"], { cwd: sourceWork });
  git(["config", "user.name", "ops-refs-vault"], { cwd: sourceWork });
  commitChange(sourceWork, "alpha-source-C");
  pushWork(sourceWork, bare, branch);

  const diverged = cliJson(["candidate-plan", "--manifest", manifest, "--repo-id", "alpha", "--branch", "main"]);
  assert.equal(diverged.json.classification, "diverged-candidate");
});

test("backup-all uses atomic push for multiple refs from one repository", () => {
  const root = tmpRoot("atomic-");
  const vault = path.join(root, "refs.git");
  const bare = path.join(root, "ssot", "alpha.git");
  const work = path.join(root, "work", "alpha");
  initBare(vault);
  initBare(bare);
  initWork(work, "main", "alpha-main");
  pushWork(work, bare, "main");
  git(["checkout", "-q", "-b", "dev"], { cwd: work });
  commitChange(work, "alpha-dev");
  pushWork(work, bare, "dev");
  git(["--git-dir", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const updateHook = path.join(vault, "hooks", "update");
  fs.writeFileSync(
    updateHook,
    "#!/bin/sh\ncase \"$1\" in\n  refs/heads/*/dev) exit 1 ;;\nesac\nexit 0\n",
    { mode: 0o755 },
  );

  const manifest = makeManifest(root, path.join(root, "ssot"), vault);
  const backup = cliJson(["backup-all", "--manifest", manifest], { check: false });
  assert.notEqual(backup.proc.status, 0);
  const mainRef = projectHeadRef(encodeRepoPath("alpha"), "main");
  const devRef = projectHeadRef(encodeRepoPath("alpha"), "dev");
  assert.equal(hash(vault, mainRef), null);
  assert.equal(hash(vault, devRef), null);
});

test("candidate adopt and discard require exact source and remote leases", () => {
  const adoptRace = setupRemoteAhead("adopt-race-");
  commitChange(adoptRace.work, "alpha-source-race-C");
  pushWork(adoptRace.work, adoptRace.bare, adoptRace.branch);
  const racedAdopt = cliJson(
    [
      "candidate-adopt",
      "--manifest",
      adoptRace.manifest,
      "--repo-id",
      "alpha",
      "--branch",
      "main",
      "--expected-source-oid",
      adoptRace.sourceOid,
      "--expected-remote-oid",
      adoptRace.remoteOid,
      "--staging-bare",
      path.join(adoptRace.root, "staging", "alpha.git"),
      "--confirm",
    ],
    { check: false },
  );
  assert.notEqual(racedAdopt.proc.status, 0);
  assert.match(racedAdopt.proc.stderr, /source lease mismatch/);

  const discardRace = setupRemoteAhead("discard-race-");
  commitChange(discardRace.work, "alpha-remote-race-D");
  git(["push", discardRace.vault, `HEAD:${discardRace.remoteRef}`], { cwd: discardRace.work });
  const racedDiscard = cliJson(
    [
      "candidate-discard",
      "--manifest",
      discardRace.manifest,
      "--repo-id",
      "alpha",
      "--branch",
      "main",
      "--expected-source-oid",
      discardRace.sourceOid,
      "--expected-remote-oid",
      discardRace.remoteOid,
      "--confirm",
    ],
    { check: false },
  );
  assert.notEqual(racedDiscard.proc.status, 0);
  assert.match(racedDiscard.proc.stderr, /remote lease mismatch/);

  const adoptOk = setupRemoteAhead("adopt-ok-");
  const adopt = cliJson([
    "candidate-adopt",
    "--manifest",
    adoptOk.manifest,
    "--repo-id",
    "alpha",
    "--branch",
    "main",
    "--expected-source-oid",
    adoptOk.sourceOid,
    "--expected-remote-oid",
    adoptOk.remoteOid,
    "--staging-bare",
    path.join(adoptOk.root, "staging", "alpha.git"),
    "--confirm",
  ]);
  assert.equal(adopt.json.sourceAfter, adoptOk.remoteOid);
  assert.equal(hash(adoptOk.bare, "refs/heads/main"), adoptOk.remoteOid);

  const discardOk = setupRemoteAhead("discard-ok-");
  const discard = cliJson([
    "candidate-discard",
    "--manifest",
    discardOk.manifest,
    "--repo-id",
    "alpha",
    "--branch",
    "main",
    "--expected-source-oid",
    discardOk.sourceOid,
    "--expected-remote-oid",
    discardOk.remoteOid,
    "--confirm",
  ]);
  assert.equal(discard.json.remoteAfter, discardOk.sourceOid);
  assert.equal(hash(discardOk.vault, discardOk.remoteRef), discardOk.sourceOid);
});

test("restore proves OID, HEAD, fsck, clone usability, and CLI avoids mirror push", () => {
  const root = tmpRoot("restore-");
  const vault = path.join(root, "refs.git");
  initBare(vault);
  const { sourceOid } = setupSource(root, "alpha");
  const manifest = makeManifest(root, path.join(root, "ssot"), vault);
  cli(["backup-all", "--manifest", manifest]);
  const staging = path.join(root, "restore", "alpha.git");
  const restored = cliJson([
    "restore-bare-one",
    "--manifest",
    manifest,
    "--repo-id",
    "alpha",
    "--branch",
    "main",
    "--staging-bare",
    staging,
  ]);
  assert.equal(restored.json.restoredHash, sourceOid);
  assert.equal(restored.json.headTarget, "refs/heads/main");
  git(["--git-dir", staging, "fsck", "--full"]);
  const cloneDir = path.join(root, "clone-proof");
  git(["clone", "-q", staging, cloneDir]);
  assert.equal(git(["rev-parse", "HEAD"], { cwd: cloneDir }).stdout.trim(), sourceOid);

  const cliSource = fs.readFileSync(CLI, "utf8");
  assert.equal(cliSource.includes("--mirror"), false);
});
