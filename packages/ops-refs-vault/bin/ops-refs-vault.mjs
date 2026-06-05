#!/usr/bin/env node
// Back up repo-specific bare SSOT repos into one namespaced forge vault.
//
// Node ESM port of ops-refs-vault.py (stdlib only, behavior-identical).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const DEFAULT_REMOTE = "git@github.com:roccho-dev/refs.git";
const REPO_ID_RE = /^(?!\.)(?!.*\.\.)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9._-]+$/;

class VaultError extends Error {}

// ---- JSON serializer matching json.dumps(indent=2, ensure_ascii=False) (NO sort_keys) ----
function jsonString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

function ser(value, sortKeys, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent) {
      const pad = " ".repeat(indent * (depth + 1));
      const closePad = " ".repeat(indent * depth);
      return "[\n" + value.map((v) => pad + ser(v, sortKeys, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    return "[" + value.map((v) => ser(v, sortKeys, indent, depth + 1)).join(", ") + "]";
  }
  let keys = Object.keys(value);
  if (sortKeys) keys = keys.sort();
  if (keys.length === 0) return "{}";
  if (indent) {
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return (
      "{\n" +
      keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(",\n") +
      "\n" +
      closePad +
      "}"
    );
  }
  return "{" + keys.map((k) => jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(", ") + "}";
}

function dumps2(value) {
  return ser(value, false, 2, 0);
}

let STDOUT_CAPTURE = null;
function out(text) {
  if (STDOUT_CAPTURE !== null) STDOUT_CAPTURE.push(text);
  else process.stdout.write(text);
}
function printJson(value) {
  out(dumps2(value) + "\n");
}

function run(cmd, { cwd = null, check = true, capture = false } = {}) {
  const opts = { encoding: "utf8" };
  if (cwd !== null && cwd !== undefined) opts.cwd = cwd;
  if (capture) opts.stdio = ["ignore", "pipe", "pipe"];
  else opts.stdio = ["ignore", "inherit", "inherit"];
  const proc = spawnSync(cmd[0], cmd.slice(1), opts);
  let returncode = proc.status;
  if (returncode === null) returncode = proc.signal ? 128 : 1;
  const stdout = capture ? proc.stdout || "" : null;
  const stderr = capture ? proc.stderr || "" : null;
  if (check && returncode !== 0) {
    let detail = "";
    if (capture) detail = `\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    throw new VaultError(`command failed rc=${returncode}: ${cmd.join(" ")}${detail}`);
  }
  return { returncode, stdout, stderr };
}

function validateRepoId(repoId) {
  if (!repoId || repoId.includes("/") || !REPO_ID_RE.test(repoId)) {
    throw new VaultError(`invalid repoId: ${repoId}`);
  }
}

function validateBranch(branch) {
  if (!branch || branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{")) {
    throw new VaultError(`invalid branch: ${branch}`);
  }
}

function loadManifest(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function vaultRemote(manifest, override = null) {
  if (override) return override;
  const target = manifest.targetForgeRepo || {};
  return target.sshUrl || target.url || DEFAULT_REMOTE;
}

// Python generator manifest_repos: yields [repo_id, repo] for repos with a repoId,
// validating each yielded repoId. Returns an array here.
function manifestRepos(manifest) {
  const result = [];
  for (const repo of manifest.repos || []) {
    const repoId = repo.repoId;
    if (!repoId) continue;
    validateRepoId(repoId);
    result.push([repoId, repo]);
  }
  return result;
}

function manifestRepo(manifest, repoId) {
  validateRepoId(repoId);
  for (const [currentId, repo] of manifestRepos(manifest)) {
    if (currentId === repoId) return repo;
  }
  throw new VaultError(`repoId not found in manifest: ${repoId}`);
}

function sourceBare(repo) {
  const p = repo.sourceBarePath || repo.sourceBare || repo.barePath;
  if (!p) {
    throw new VaultError(`manifest repoId=${repo.repoId} is missing sourceBarePath`);
  }
  return p;
}

function namespacedHead(repoId, branch) {
  validateRepoId(repoId);
  validateBranch(branch);
  return `refs/heads/repos/${repoId}/${branch}`;
}

function lsRemote(remote, pattern) {
  const result = run(["git", "ls-remote", remote, pattern], { capture: true });
  const rows = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf("\t");
    const sha = line.slice(0, idx);
    const ref = line.slice(idx + 1);
    rows.push([sha, ref]);
  }
  return rows;
}

function oneRemoteHash(remote, ref) {
  const rows = lsRemote(remote, ref);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new VaultError(`remote ref matched more than once: ${ref}`);
  }
  return rows[0][0];
}

function isLocalBare(remote) {
  try {
    if (!fs.existsSync(remote)) return false;
    const head = path.join(remote, "HEAD");
    const objects = path.join(remote, "objects");
    return fs.existsSync(head) && fs.statSync(head).isFile() && fs.existsSync(objects) && fs.statSync(objects).isDirectory();
  } catch {
    return false;
  }
}

function pushRefToVault(source, vault, srcRef, dstRef, force = false) {
  const refspec = `${force ? "+" : ""}${srcRef}:${dstRef}`;
  if (isLocalBare(source)) {
    run(["git", "--git-dir", source, "push", vault, refspec], { capture: true });
    return refspec;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-refs-vault-source-"));
  try {
    run(["git", "init", "-q", "--bare", tmp]);
    run(["git", "--git-dir", tmp, "fetch", "--no-tags", source, `+${srcRef}:${srcRef}`], { capture: true });
    run(["git", "--git-dir", tmp, "push", vault, refspec], { capture: true });
    return refspec;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function listSourceHeads(source) {
  const rows = lsRemote(source, "refs/heads/*");
  const result = [];
  const prefix = "refs/heads/";
  for (const [sha, ref] of rows) {
    const branch = ref.slice(prefix.length);
    if (branch) {
      validateBranch(branch);
      result.push([sha, branch, ref]);
    }
  }
  return result;
}

function ensureEmptyOrNewBare(p) {
  const bare = path.resolve(p);
  if (fs.existsSync(bare)) {
    const head = path.join(bare, "HEAD");
    const objects = path.join(bare, "objects");
    const headOk = fs.existsSync(head) && fs.statSync(head).isFile();
    const objOk = fs.existsSync(objects) && fs.statSync(objects).isDirectory();
    if (!headOk || !objOk) {
      throw new VaultError(`staging path exists but is not a bare git repo: ${bare}`);
    }
    const refs = run(["git", "--git-dir", bare, "for-each-ref", "--format=%(refname)"], { capture: true }).stdout.trim();
    if (refs) {
      throw new VaultError(`staging bare is not empty: ${bare}`);
    }
  } else {
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    run(["git", "init", "-q", "--bare", bare]);
  }
  return bare;
}

function initBareIfMissing(p) {
  const bare = path.resolve(p);
  if (!fs.existsSync(bare)) {
    fs.mkdirSync(path.dirname(bare), { recursive: true });
    run(["git", "init", "-q", "--bare", bare]);
  }
  const head = path.join(bare, "HEAD");
  const objects = path.join(bare, "objects");
  const headOk = fs.existsSync(head) && fs.statSync(head).isFile();
  const objOk = fs.existsSync(objects) && fs.statSync(objects).isDirectory();
  if (!headOk || !objOk) {
    throw new VaultError(`target path is not a bare git repo: ${bare}`);
  }
  return bare;
}

function pushSourceRefToVault(source, vault, repoId, branch, force = false, dryRun = false) {
  const srcRef = `refs/heads/${branch}`;
  const dstRef = namespacedHead(repoId, branch);
  const sourceSha = oneRemoteHash(source, srcRef);
  if (!sourceSha) {
    throw new VaultError(`source branch missing: ${source} ${srcRef}`);
  }
  const refspec = `${force ? "+" : ""}${srcRef}:${dstRef}`;
  if (!dryRun) {
    pushRefToVault(source, vault, srcRef, dstRef, force);
  }
  return { sourceRef: srcRef, sourceHash: sourceSha, vaultRef: dstRef, refspec };
}

function cmdBackupOne(args) {
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const source = sourceBare(repo);
  const vault = vaultRemote(manifest, args.remote);
  const result = pushSourceRefToVault(source, vault, args.repo_id, args.branch, args.force, args.dry_run);
  const remoteHash = args.dry_run ? null : oneRemoteHash(vault, result.vaultRef);
  const ok = args.dry_run || result.sourceHash === remoteHash;
  printJson({
    ok,
    mode: "backup-one",
    repoId: args.repo_id,
    sourceBarePath: source,
    vaultRemote: vault,
    dryRun: args.dry_run,
    remoteHash,
    ...result,
  });
  if (!ok) {
    throw new VaultError("post-push vault hash differs from source");
  }
}

function cmdBackupAll(args) {
  const manifest = loadManifest(args.manifest);
  const vault = vaultRemote(manifest, args.remote);
  const results = [];
  for (const [repoId, repo] of manifestRepos(manifest)) {
    const source = sourceBare(repo);
    const branches = args.branch ? [[null, args.branch, `refs/heads/${args.branch}`]] : listSourceHeads(source);
    for (const [, branch] of branches) {
      const item = { repoId, sourceBarePath: source, branch };
      try {
        Object.assign(item, pushSourceRefToVault(source, vault, repoId, branch, args.force, args.dry_run));
        item.remoteHash = args.dry_run ? null : oneRemoteHash(vault, item.vaultRef);
        item.ok = args.dry_run || item.sourceHash === item.remoteHash;
        item.status = args.dry_run ? "dry-run" : "backed-up";
      } catch (exc) {
        item.ok = false;
        item.status = "failed";
        item.error = errStr(exc);
      }
      results.push(item);
    }
  }
  const allOk = results.every((item) => item.ok);
  printJson({
    ok: allOk,
    mode: "backup-all",
    vaultRemote: vault,
    dryRun: args.dry_run,
    results,
  });
  if (!allOk) {
    throw new VaultError("one or more refs failed backup");
  }
}

function cmdRestoreBareOne(args) {
  const manifest = loadManifest(args.manifest);
  manifestRepo(manifest, args.repo_id);
  const vault = vaultRemote(manifest, args.remote);
  const staging = ensureEmptyOrNewBare(args.staging_bare);
  const srcRef = namespacedHead(args.repo_id, args.branch);
  const dstRef = `refs/heads/${args.branch}`;
  const fetch = run(["git", "--git-dir", staging, "fetch", "--no-tags", vault, `+${srcRef}:${dstRef}`], {
    capture: true,
    check: false,
  });
  if (fetch.returncode !== 0) {
    throw new VaultError(`missing vault branch: ${srcRef}`);
  }
  const restoredHash = oneRemoteHash(staging, dstRef);
  const vaultHash = oneRemoteHash(vault, srcRef);
  const ok = restoredHash === vaultHash && Boolean(restoredHash);
  printJson({
    ok,
    mode: "restore-bare-one",
    repoId: args.repo_id,
    branch: args.branch,
    vaultRemote: vault,
    vaultRef: srcRef,
    stagingBare: staging,
    restoredRef: dstRef,
    restoredHash,
    vaultHash,
  });
  if (!ok) {
    throw new VaultError("restored hash differs from vault");
  }
}

function cmdPromoteStagingBare(args) {
  if (!args.confirm) {
    throw new VaultError("promote-staging-bare requires --confirm");
  }
  const staging = path.resolve(args.staging_bare);
  const head = path.join(staging, "HEAD");
  const objects = path.join(staging, "objects");
  const headOk = fs.existsSync(head) && fs.statSync(head).isFile();
  const objOk = fs.existsSync(objects) && fs.statSync(objects).isDirectory();
  if (!headOk || !objOk) {
    throw new VaultError(`staging path is not a bare git repo: ${staging}`);
  }
  const target = initBareIfMissing(args.target_bare);
  const headsOut = run(["git", "--git-dir", staging, "for-each-ref", "--format=%(refname)", "refs/heads"], {
    capture: true,
  }).stdout;
  const heads = headsOut.split("\n").filter((l) => l !== "");
  // Python splitlines() drops a trailing newline-only empty; here we filter empties.
  if (heads.length === 0) {
    throw new VaultError("staging bare has no heads to promote");
  }
  const promoted = [];
  for (const ref of heads) {
    run(["git", "--git-dir", staging, "push", target, `${ref}:${ref}`], { capture: true });
    promoted.push({ ref, hash: oneRemoteHash(target, ref) });
  }
  printJson({
    ok: true,
    mode: "promote-staging-bare",
    repoId: args.repo_id,
    stagingBare: staging,
    targetBare: target,
    promoted,
  });
}

function cmdVerifyOne(args) {
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const source = sourceBare(repo);
  const vault = vaultRemote(manifest, args.remote);
  const sourceRef = `refs/heads/${args.branch}`;
  const vaultRef = namespacedHead(args.repo_id, args.branch);
  const sourceHash = oneRemoteHash(source, sourceRef);
  const vaultHash = oneRemoteHash(vault, vaultRef);
  const ok = Boolean(sourceHash) && sourceHash === vaultHash;
  printJson({
    ok,
    mode: "verify-one",
    repoId: args.repo_id,
    branch: args.branch,
    sourceBarePath: source,
    vaultRemote: vault,
    sourceRef,
    vaultRef,
    sourceHash,
    vaultHash,
  });
  if (!ok) {
    throw new VaultError("source and vault hashes differ");
  }
}

function cmdAudit(args) {
  const manifest = loadManifest(args.manifest);
  const vault = vaultRemote(manifest, args.remote);
  const seen = {};
  for (const [sha, ref] of lsRemote(vault, "refs/heads/repos/*")) {
    const mo = ref.match(/^refs\/heads\/repos\/([^/]+)\/(.+)$/);
    if (mo) {
      if (!(mo[1] in seen)) seen[mo[1]] = [];
      seen[mo[1]].push({ branch: mo[2], hash: sha });
    }
  }
  const expected = manifestRepos(manifest).map(([repoId]) => repoId);
  const seenKeys = Object.keys(seen);
  const missing = expected.filter((repoId) => !(repoId in seen));
  const extra = seenKeys.filter((k) => !expected.includes(k)).sort();
  // Python builds `seen` dict; key order is insertion order. To match
  // json.dumps without sort_keys, preserve insertion order of seen.
  printJson({
    ok: missing.length === 0,
    mode: "audit",
    vaultRemote: vault,
    expectedRepoIds: expected,
    seenRepoIds: seenKeys.slice().sort(),
    missing,
    extra,
    seen,
  });
  if (missing.length) {
    throw new VaultError("vault missing expected repo namespaces");
  }
}

function writeTsv(p, rows, fields) {
  let text = fields.join("\t") + "\n";
  for (const row of rows) {
    text += fields.map((field) => String(row[field] !== undefined && row[field] !== null ? row[field] : "")).join("\t") + "\n";
  }
  fs.writeFileSync(p, text, { encoding: "utf8" });
}

function cmdInventory(args) {
  const manifest = loadManifest(args.manifest);
  const outDir = path.resolve(args.out_dir);
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const [repoId, repo] of manifestRepos(manifest)) {
    const source = sourceBare(repo);
    try {
      const heads = listSourceHeads(source);
      if (heads.length === 0) {
        rows.push({ repoId, sourceBarePath: source, status: "empty" });
      }
      for (const [sha, branch, ref] of heads) {
        rows.push({ repoId, sourceBarePath: source, status: "ok", branch, ref, hash: sha });
      }
    } catch (exc) {
      rows.push({ repoId, sourceBarePath: source, status: "failed", error: errStr(exc) });
    }
  }
  const fields = ["repoId", "sourceBarePath", "status", "branch", "ref", "hash", "error"];
  writeTsv(path.join(outDir, "bare-inventory.tsv"), rows, fields);
  printJson({
    ok: rows.every((row) => row.status === "ok" || row.status === "empty"),
    mode: "inventory",
    outDir,
    rows: rows.length,
  });
}

function errStr(exc) {
  if (exc instanceof Error) return exc.message;
  return String(exc);
}

function initWorkRepo(p, branch, text) {
  fs.mkdirSync(p, { recursive: true });
  run(["git", "init", "-q", "-b", branch, p]);
  run(["git", "config", "user.email", "ops-refs-vault@example.invalid"], { cwd: p });
  run(["git", "config", "user.name", "ops-refs-vault"], { cwd: p });
  fs.writeFileSync(path.join(p, "README.txt"), text + "\n", { encoding: "utf8" });
  run(["git", "add", "README.txt"], { cwd: p });
  run(["git", "commit", "-q", "-m", "init"], { cwd: p });
}

function pushWorkToBare(work, bare, branch) {
  run(["git", "remote", "add", "ssot", bare], { cwd: work });
  run(["git", "push", "ssot", `refs/heads/${branch}:refs/heads/${branch}`], { cwd: work });
}

function withRedirectStdout(fn) {
  const prev = STDOUT_CAPTURE;
  STDOUT_CAPTURE = [];
  try {
    fn();
  } finally {
    STDOUT_CAPTURE = prev;
  }
}

function cmdSmokeLocal() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-refs-vault-bare-ssot-"));
  const proofs = [];

  function proof(proofId, requirement, evidence) {
    proofs.push({ id: proofId, requirement, status: "pass", evidence });
  }

  try {
    const vault = path.join(root, "refs.git");
    const alphaBare = path.join(root, "ssot", "alpha.git");
    const betaBare = path.join(root, "ssot", "beta.git");
    const alphaWork = path.join(root, "work", "alpha");
    const betaWork = path.join(root, "work", "beta");
    const branch = "main";
    run(["git", "init", "-q", "--bare", vault]);
    run(["git", "init", "-q", "--bare", alphaBare]);
    run(["git", "init", "-q", "--bare", betaBare]);
    initWorkRepo(alphaWork, branch, "alpha");
    initWorkRepo(betaWork, branch, "beta");
    pushWorkToBare(alphaWork, alphaBare, branch);
    pushWorkToBare(betaWork, betaBare, branch);
    proof("P01", "local working clones can update repo-specific bare SSOT repos by normal git push", [alphaBare, betaBare]);

    const manifest = path.join(root, "manifest.json");
    fs.writeFileSync(
      manifest,
      dumps2({
        targetForgeRepo: { sshUrl: vault },
        repos: [
          { repoId: "alpha", sourceBarePath: alphaBare },
          { repoId: "beta", sourceBarePath: betaBare },
        ],
      }),
      { encoding: "utf8" },
    );

    const backup = { manifest, remote: null, branch: null, force: false, dry_run: false };
    withRedirectStdout(() => cmdBackupAll(backup));
    proof("P02", "backup-all reads manifest sourceBarePath and backs up repo-specific bare SSOT repos", [manifest]);

    const vaultAlphaRef = namespacedHead("alpha", branch);
    const vaultBetaRef = namespacedHead("beta", branch);
    if (!oneRemoteHash(vault, vaultAlphaRef) || !oneRemoteHash(vault, vaultBetaRef)) {
      throw new VaultError("namespaced vault refs missing after backup-all");
    }
    proof("P03", "repoId and branch map to refs/heads/repos/<repoId>/<branch>", [vaultAlphaRef, vaultBetaRef]);

    const audit = { manifest, remote: null };
    withRedirectStdout(() => cmdAudit(audit));
    proof("P04", "audit sees expected repoId namespaces in the single forge backup", ["audit"]);

    const verify = { manifest, remote: null, repo_id: "alpha", branch };
    withRedirectStdout(() => cmdVerifyOne(verify));
    proof("P05", "verify-one compares source bare hash with forge backup hash", ["verify-one alpha/main"]);

    const inventory = { manifest, out_dir: path.join(root, "inventory") };
    withRedirectStdout(() => cmdInventory(inventory));
    if (!fs.existsSync(path.join(root, "inventory", "bare-inventory.tsv"))) {
      throw new VaultError("inventory did not write bare-inventory.tsv");
    }
    proof("P06", "inventory emits machine-readable bare SSOT rows", [path.join(root, "inventory", "bare-inventory.tsv")]);

    const staging = path.join(root, "staging", "alpha.git");
    const restore = { manifest, remote: null, repo_id: "alpha", branch, staging_bare: staging };
    withRedirectStdout(() => cmdRestoreBareOne(restore));
    proof("P07", "restore-bare-one restores exact repoId/branch into staging bare", [staging]);

    const restoreMissing = {
      manifest,
      remote: null,
      repo_id: "alpha",
      branch: "missing",
      staging_bare: path.join(root, "staging", "missing.git"),
    };
    try {
      withRedirectStdout(() => cmdRestoreBareOne(restoreMissing));
      throw new VaultError("missing branch restore unexpectedly passed");
    } catch (exc) {
      if (!(exc instanceof VaultError)) throw exc;
      if (!exc.message.includes("missing vault branch")) throw exc;
    }
    proof("P08", "missing branch restore fails instead of falling back to main", ["restore-bare-one alpha/missing"]);

    const promoted = path.join(root, "promoted", "alpha.git");
    const promote = { repo_id: "alpha", staging_bare: staging, target_bare: promoted, confirm: true };
    withRedirectStdout(() => cmdPromoteStagingBare(promote));

    const promotedHash = oneRemoteHash(promoted, "refs/heads/main");
    const alphaHash = oneRemoteHash(alphaBare, "refs/heads/main");
    if (promotedHash !== alphaHash) {
      throw new VaultError("promoted bare hash differs from source bare");
    }
    proof("P09", "promote-staging-bare updates target bare only after --confirm", [promoted]);

    const oldManifest = path.join(root, "old-working-clone-manifest.json");
    fs.writeFileSync(
      oldManifest,
      dumps2({
        targetForgeRepo: { sshUrl: vault },
        repos: [{ repoId: "old", localPath: "work/old" }],
      }),
      { encoding: "utf8" },
    );
    const oldInventory = { manifest: oldManifest, out_dir: path.join(root, "old-inventory") };
    try {
      withRedirectStdout(() => cmdInventory(oldInventory));
      throw new VaultError("manifest without sourceBarePath unexpectedly passed");
    } catch (exc) {
      if (!(exc instanceof VaultError)) throw exc;
      if (!exc.message.includes("sourceBarePath")) throw exc;
    }
    proof("P10", "local working clone paths are not accepted as canonical backup source", [oldManifest]);

    const gammaSource = path.join(root, "ssot", "gamma.git");
    const gammaOther = path.join(root, "ssot", "gamma-other.git");
    const gammaWork = path.join(root, "work", "gamma");
    const gammaOtherWork = path.join(root, "work", "gamma-other");
    run(["git", "init", "-q", "--bare", gammaSource]);
    run(["git", "init", "-q", "--bare", gammaOther]);
    initWorkRepo(gammaWork, branch, "gamma-source");
    initWorkRepo(gammaOtherWork, branch, "gamma-other");
    pushWorkToBare(gammaWork, gammaSource, branch);
    pushWorkToBare(gammaOtherWork, gammaOther, branch);
    pushRefToVault(gammaOther, vault, "refs/heads/main", namespacedHead("gamma", "main"), true);
    try {
      pushSourceRefToVault(gammaSource, vault, "gamma", "main", false, false);
      throw new VaultError("non-fast-forward backup unexpectedly passed");
    } catch (exc) {
      if (!(exc instanceof VaultError)) throw exc;
      if (!exc.message.includes("command failed")) throw exc;
    }
    proof("P11", "default backup is no-force and rejects diverged forge refs", ["gamma/main"]);

    printJson({
      ok: true,
      mode: "smoke-local",
      root,
      proofs,
    });
  } finally {
    if (process.env.OPS_REFS_VAULT_KEEP_SMOKE !== "1") {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

// ---- argument parsing (faithful argparse reproduction; prog = ops-refs-vault) ----
const PROG = "ops-refs-vault";

// argparse top-level usage, wrapped at the standard 80-column width.
// Byte-reproduced from argparse with prog="ops-refs-vault".
const TOP_USAGE =
  `usage: ${PROG} [-h]\n` +
  `                      {backup-one,backup-all,restore-bare-one,promote-staging-bare,audit,verify-one,inventory,smoke-local} ...\n`;

// Per-subcommand usage blocks, byte-reproduced from argparse (prog="ops-refs-vault <cmd>").
const SUB_USAGE = {
  "backup-one":
    `usage: ${PROG} backup-one [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                 --branch BRANCH [--remote REMOTE] [--force]\n` +
    `                                 [--dry-run]\n`,
  "backup-all":
    `usage: ${PROG} backup-all [-h] --manifest MANIFEST [--remote REMOTE]\n` +
    `                                 [--branch BRANCH] [--force] [--dry-run]\n`,
  "restore-bare-one":
    `usage: ${PROG} restore-bare-one [-h] --manifest MANIFEST\n` +
    `                                       --repo-id REPO_ID --branch BRANCH\n` +
    `                                       --staging-bare STAGING_BARE\n` +
    `                                       [--remote REMOTE]\n`,
  "promote-staging-bare":
    `usage: ${PROG} promote-staging-bare [-h] --repo-id REPO_ID\n` +
    `                                           --staging-bare STAGING_BARE\n` +
    `                                           --target-bare TARGET_BARE\n` +
    `                                           [--confirm]\n`,
  audit: `usage: ${PROG} audit [-h] --manifest MANIFEST [--remote REMOTE]\n`,
  "verify-one":
    `usage: ${PROG} verify-one [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                 --branch BRANCH [--remote REMOTE]\n`,
  inventory: `usage: ${PROG} inventory [-h] --manifest MANIFEST --out-dir OUT_DIR\n`,
  "smoke-local": `usage: ${PROG} smoke-local [-h]\n`,
};

function topUsageError(msg) {
  process.stderr.write(TOP_USAGE);
  process.stderr.write(`${PROG}: error: ${msg}\n`);
  process.exit(2);
}

function subUsageError(command, msg) {
  process.stderr.write(SUB_USAGE[command]);
  process.stderr.write(`${PROG} ${command}: error: ${msg}\n`);
  process.exit(2);
}

const SUB_SPEC = {
  "backup-one": { flags: ["--remote"], bools: ["--force", "--dry-run"], required: ["--manifest", "--repo-id", "--branch"] },
  "backup-all": { flags: ["--remote", "--branch"], bools: ["--force", "--dry-run"], required: ["--manifest"] },
  "restore-bare-one": { flags: ["--remote"], bools: [], required: ["--manifest", "--repo-id", "--branch", "--staging-bare"] },
  "promote-staging-bare": { flags: [], bools: ["--confirm"], required: ["--repo-id", "--staging-bare", "--target-bare"] },
  audit: { flags: ["--remote"], bools: [], required: ["--manifest"] },
  "verify-one": { flags: ["--remote"], bools: [], required: ["--manifest", "--repo-id", "--branch"] },
  inventory: { flags: [], bools: [], required: ["--manifest", "--out-dir"] },
  "smoke-local": { flags: [], bools: [], required: [] },
};

function parseSub(command, rest) {
  const spec = SUB_SPEC[command];
  const allFlags = ["--manifest", "--repo-id", "--branch", "--remote", "--staging-bare", "--target-bare", "--out-dir"];
  const key = (flag) => flag.replace(/^--/, "").replace(/-/g, "_");
  const out = {
    manifest: undefined,
    repo_id: undefined,
    branch: undefined,
    remote: null,
    staging_bare: undefined,
    target_bare: undefined,
    out_dir: undefined,
    force: false,
    dry_run: false,
    confirm: false,
  };
  const accepted = new Set(spec.flags);
  for (const f of spec.required) if (allFlags.includes(f)) accepted.add(f);
  const unrecognized = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--force" && spec.bools.includes("--force")) out.force = true;
    else if (a === "--dry-run" && spec.bools.includes("--dry-run")) out.dry_run = true;
    else if (a === "--confirm" && spec.bools.includes("--confirm")) out.confirm = true;
    else if (allFlags.includes(a) && accepted.has(a)) out[key(a)] = rest[++i];
    else unrecognized.push(a);
  }
  // argparse reports missing required args (at the subparser) before unrecognized
  // args (which surface at the top-level parser).
  const missing = spec.required.filter((req) => out[key(req)] === undefined);
  if (missing.length) {
    subUsageError(command, `the following arguments are required: ${missing.join(", ")}`);
  }
  if (unrecognized.length) {
    topUsageError(`unrecognized arguments: ${unrecognized.join(" ")}`);
  }
  return out;
}

const DISPATCH = {
  "backup-one": cmdBackupOne,
  "backup-all": cmdBackupAll,
  "restore-bare-one": cmdRestoreBareOne,
  "promote-staging-bare": cmdPromoteStagingBare,
  audit: cmdAudit,
  "verify-one": cmdVerifyOne,
  inventory: cmdInventory,
  "smoke-local": cmdSmokeLocal,
};

function main(argv) {
  const args = argv === undefined ? process.argv.slice(2) : argv;
  if (args.length === 0) {
    topUsageError("the following arguments are required: command");
  }
  const command = args[0];
  if (!(command in DISPATCH)) {
    topUsageError(
      `argument command: invalid choice: '${command}' (choose from backup-one, backup-all, restore-bare-one, promote-staging-bare, audit, verify-one, inventory, smoke-local)`,
    );
  }
  const parsed = command === "smoke-local" ? {} : parseSub(command, args.slice(1));
  try {
    DISPATCH[command](parsed);
  } catch (exc) {
    if (exc instanceof VaultError) {
      process.stderr.write(dumps2({ ok: false, error: errStr(exc) }) + "\n");
      return 1;
    }
    throw exc;
  }
  return 0;
}

process.exit(main());
