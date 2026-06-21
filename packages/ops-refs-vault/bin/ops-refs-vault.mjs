#!/usr/bin/env node
// Back up repo-specific bare SSOT repos into one namespaced forge vault.
//
// Node ESM port of ops-refs-vault.py (stdlib only, behavior-identical).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  MANAGED_REMOTE_PATTERN,
  REF_PROFILE,
  REPO_KEY_PREFIX,
  encodeRepoPath,
  identityFromRepo,
  logicalHeadId,
  normalizeRepoPath,
  parseManagedRemoteRef,
  projectHeadRef,
  repoPathFromBare,
} from "../lib/ref-projection.mjs";
import { SAFE_BACKUP_CLASSIFICATIONS, reconcileRefSets } from "../lib/ref-reconcile.mjs";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const REMOTE_ENV = "OPS_REFS_VAULT_REMOTE";
const REPO_ID_RE = /^(?!\.)(?!.*\.\.)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9._-]+$/;
const ZERO_OID = "0".repeat(40);
const OBJECT_ID_RE = /^[0-9a-f]{40}$/i;

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

function writeJsonFile(p, value) {
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  fs.writeFileSync(p, dumps2(value) + "\n", { encoding: "utf8" });
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
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
  const remote = target.sshUrl || target.url || process.env[REMOTE_ENV];
  if (!remote) {
    throw new VaultError(`backup remote is required: pass --remote, set manifest targetForgeRepo.sshUrl/url, or set ${REMOTE_ENV}`);
  }
  return remote;
}

// Python generator manifest_repos: yields [repo_id, repo] for repos with a repoId,
// validating each yielded repoId. Returns an array here.
function manifestRepos(manifest) {
  const result = [];
  for (const repo of manifest.repos || []) {
    const identity = identityFromRepo(repo);
    result.push([identity.repoPath, { ...repo, repoId: repo.repoId || identity.repoPath, ...identity }]);
  }
  return result;
}

function manifestRepo(manifest, repoId) {
  const wanted = normalizeRepoPath(repoId);
  for (const [currentId, repo] of manifestRepos(manifest)) {
    if (currentId === wanted) return repo;
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

function readExcludeFile(p) {
  if (!p) return new Set();
  const ids = new Set();
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    ids.add(normalizeRepoPath(line));
  }
  return ids;
}

function discoverBareRepos(bareRoot, excludeFile = null) {
  const root = path.resolve(bareRoot);
  const excludes = readExcludeFile(excludeFile);
  const repos = [];
  const seen = new Set();

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (!ent.isDirectory()) continue;
      if (ent.name.endsWith(".git") && isLocalBare(p)) {
        const repoPath = repoPathFromBare(root, p);
        const repoKey = encodeRepoPath(repoPath);
        seen.add(repoPath);
        if (!excludes.has(repoPath)) {
          repos.push({ repoId: repoPath, repoPath, repoKey, sourceBarePath: p });
        }
        continue;
      }
      walk(p);
    }
  }

  walk(root);
  const unknownExcludes = [...excludes].filter((repoId) => !seen.has(repoId)).sort();
  if (unknownExcludes.length) {
    throw new VaultError(`exclude file contains repoIds not present under bare root: ${unknownExcludes.join(", ")}`);
  }
  repos.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  return { bareRoot: root, repos, excludedRepoIds: [...excludes].sort() };
}

function cmdGenerateManifest(args) {
  const discovered = discoverBareRepos(args.bare_root, args.exclude_file);
  const remote = args.remote || process.env[REMOTE_ENV] || null;
  const manifest = {
    kind: "ops.refsVault.generatedManifest.v1",
    authority: "filesystem-snapshot-not-ssot-authority",
    source: {
      bareRoot: discovered.bareRoot,
      excludeFile: args.exclude_file || null,
      excludedRepoIds: discovered.excludedRepoIds,
    },
    targetForgeRepo: remote ? { sshUrl: remote } : {},
    refProjection: {
      profile: REF_PROFILE,
      managedRemotePattern: MANAGED_REMOTE_PATTERN,
      repoKeyPrefix: REPO_KEY_PREFIX,
    },
    repos: discovered.repos,
  };
  writeJsonFile(args.out, manifest);
  printJson({
    ok: true,
    mode: "generate-manifest",
    out: path.resolve(args.out),
    repoCount: manifest.repos.length,
    excludedRepoIds: discovered.excludedRepoIds,
    manifestDigest: sha256File(args.out),
  });
}

function namespacedHead(repoId, branch) {
  const repoKey = encodeRepoPath(repoId);
  validateBranch(branch);
  return projectHeadRef(repoKey, branch);
}

function normalizeExpectedOid(value, name) {
  if (value === "absent" || value === "none" || value === "null" || value === ZERO_OID) return null;
  if (!OBJECT_ID_RE.test(value || "")) throw new VaultError(`invalid ${name}: ${value}`);
  return value.toLowerCase();
}

function assertOidEquals(actual, expected, label) {
  const normalizedActual = actual ? actual.toLowerCase() : null;
  if (normalizedActual !== expected) {
    throw new VaultError(`${label} lease mismatch: expected ${expected || "absent"}, observed ${normalizedActual || "absent"}`);
  }
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

function pushRefsToVaultAtomic(source, vault, refs) {
  const refspecs = refs.map((ref) => `${ref.sourceRef}:${ref.vaultRef}`);
  if (isLocalBare(source)) {
    run(["git", "--git-dir", source, "push", "--atomic", vault, ...refspecs], { capture: true });
    return refspecs;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-refs-vault-source-"));
  try {
    run(["git", "init", "-q", "--bare", tmp]);
    for (const ref of refs) {
      run(["git", "--git-dir", tmp, "fetch", "--no-tags", source, `+${ref.sourceRef}:${ref.sourceRef}`], { capture: true });
    }
    run(["git", "--git-dir", tmp, "push", "--atomic", vault, ...refspecs], { capture: true });
    return refspecs;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function pushSourceOidToVaultWithLease(source, vault, sourceOid, dstRef, expectedRemoteOid) {
  const lease = `--force-with-lease=${dstRef}:${expectedRemoteOid}`;
  run(["git", "--git-dir", source, "push", lease, vault, `${sourceOid}:${dstRef}`], { capture: true });
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

function expectedRowsForManifest(manifest, branchFilter = null) {
  const rows = [];
  const sourceFailures = [];
  for (const [repoPath, repo] of manifestRepos(manifest)) {
    const source = sourceBare(repo);
    const { repoKey } = identityFromRepo(repo);
    try {
      const heads = branchFilter ? [[null, branchFilter, `refs/heads/${branchFilter}`]] : listSourceHeads(source);
      for (const [shaMaybe, branch, sourceRef] of heads) {
        validateBranch(branch);
        const sourceOid = shaMaybe || oneRemoteHash(source, sourceRef);
        if (!sourceOid) throw new VaultError(`source branch missing: ${source} ${sourceRef}`);
        rows.push({
          logicalId: logicalHeadId(repoPath, branch),
          repoId: repoPath,
          repoPath,
          repoKey,
          sourceBarePath: source,
          branch,
          sourceRef,
          sourceOid,
          remoteRef: projectHeadRef(repoKey, branch),
        });
      }
    } catch (exc) {
      sourceFailures.push({ repoId: repoPath, repoPath, sourceBarePath: source, error: errStr(exc) });
    }
  }
  return { rows, sourceFailures };
}

function observedRowsForManagedRoot(vault) {
  return lsRemote(vault, "refs/heads/*").map(([remoteOid, remoteRef]) => ({
    remoteRef,
    remoteOid,
    parsed: parseManagedRemoteRef(remoteRef),
  }));
}

function classifyCommitRelation(source, sourceRef, sourceOid, vault, remoteRef, remoteOid) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-refs-vault-relation-"));
  try {
    run(["git", "init", "-q", "--bare", tmp]);
    const srcFetch = run(["git", "--git-dir", tmp, "fetch", "--no-tags", source, `+${sourceRef}:refs/heads/source`], {
      capture: true,
      check: false,
    });
    const remoteFetch = run(["git", "--git-dir", tmp, "fetch", "--no-tags", vault, `+${remoteRef}:refs/heads/remote`], {
      capture: true,
      check: false,
    });
    if (srcFetch.returncode !== 0 || remoteFetch.returncode !== 0) {
      return { classification: "unclassified", reason: "relation-fetch-failed" };
    }
    const gotSource = oneRemoteHash(tmp, "refs/heads/source");
    const gotRemote = oneRemoteHash(tmp, "refs/heads/remote");
    if (gotSource !== sourceOid || gotRemote !== remoteOid) {
      return { classification: "observation-raced", reason: "observed-oid-changed" };
    }
    const remoteAncestorOfSource = run(["git", "--git-dir", tmp, "merge-base", "--is-ancestor", gotRemote, gotSource], {
      capture: true,
      check: false,
    }).returncode === 0;
    if (remoteAncestorOfSource) return { classification: "source-ahead" };
    const sourceAncestorOfRemote = run(["git", "--git-dir", tmp, "merge-base", "--is-ancestor", gotSource, gotRemote], {
      capture: true,
      check: false,
    }).returncode === 0;
    if (sourceAncestorOfRemote) return { classification: "remote-ahead-candidate" };
    return { classification: "diverged-candidate" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function relationMapForRows(expectedRows, observedRows, vault) {
  const observedByRef = new Map(observedRows.map((row) => [row.remoteRef, row]));
  const relations = new Map();
  for (const exp of expectedRows) {
    const obs = observedByRef.get(exp.remoteRef);
    if (!obs || obs.remoteOid === exp.sourceOid) continue;
    relations.set(exp.remoteRef, classifyCommitRelation(exp.sourceBarePath, exp.sourceRef, exp.sourceOid, vault, exp.remoteRef, obs.remoteOid));
  }
  return relations;
}

function reconcileManifestWithRemote(manifest, vault, branchFilter = null) {
  const expected = expectedRowsForManifest(manifest, branchFilter);
  const observedRows = observedRowsForManagedRoot(vault);
  const relationByRemoteRef = relationMapForRows(expected.rows, observedRows, vault);
  const reconciled = reconcileRefSets(expected.rows, observedRows, relationByRemoteRef);
  return { ...reconciled, sourceFailures: expected.sourceFailures };
}

function findReconciledRow(reconciled, remoteRef) {
  const row = reconciled.rows.find((item) => item.remoteRef === remoteRef);
  if (!row) throw new VaultError(`remote ref not found in reconciled rows: ${remoteRef}`);
  return row;
}

function restoreRemoteRefToStaging(vault, remoteRef, branch, stagingBare, expectedRemoteOid = null) {
  const staging = ensureEmptyOrNewBare(stagingBare);
  const dstRef = `refs/heads/${branch}`;
  const fetch = run(["git", "--git-dir", staging, "fetch", "--no-tags", vault, `+${remoteRef}:${dstRef}`], {
    capture: true,
    check: false,
  });
  if (fetch.returncode !== 0) {
    throw new VaultError(`missing vault branch: ${remoteRef}`);
  }
  const restoredHash = oneRemoteHash(staging, dstRef);
  if (expectedRemoteOid && restoredHash !== expectedRemoteOid) {
    throw new VaultError(`staged candidate oid mismatch: expected ${expectedRemoteOid}, restored ${restoredHash}`);
  }
  run(["git", "--git-dir", staging, "symbolic-ref", "HEAD", dstRef], { capture: true });
  const headTarget = run(["git", "--git-dir", staging, "symbolic-ref", "HEAD"], { capture: true }).stdout.trim();
  if (headTarget !== dstRef) throw new VaultError(`staging HEAD target mismatch: ${headTarget}`);
  run(["git", "--git-dir", staging, "fsck", "--full"], { capture: true });
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-refs-vault-clone-proof-"));
  try {
    run(["git", "clone", "-q", staging, cloneDir], { capture: true });
    const cloneHash = run(["git", "rev-parse", "HEAD"], { cwd: cloneDir, capture: true }).stdout.trim();
    if (cloneHash !== restoredHash) {
      throw new VaultError("restored staging bare clone usability proof failed");
    }
  } finally {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }
  return { staging, dstRef, restoredHash, headTarget };
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
  const { repoKey } = typeof repoId === "string" ? { repoKey: encodeRepoPath(repoId) } : identityFromRepo(repoId);
  const srcRef = `refs/heads/${branch}`;
  const dstRef = projectHeadRef(repoKey, branch);
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

function plannedSourceRefs(source, repo, branches) {
  const { repoKey } = identityFromRepo(repo);
  const refs = [];
  for (const branch of branches) {
    const sourceRef = `refs/heads/${branch}`;
    const vaultRef = projectHeadRef(repoKey, branch);
    const sourceHash = oneRemoteHash(source, sourceRef);
    if (!sourceHash) throw new VaultError(`source branch missing: ${source} ${sourceRef}`);
    refs.push({ sourceRef, sourceHash, vaultRef, branch, refspec: `${sourceRef}:${vaultRef}` });
  }
  return refs;
}

function pushSourceRefsToVault(source, vault, repo, branches, dryRun = false) {
  const refs = plannedSourceRefs(source, repo, branches);
  if (!dryRun && refs.length) pushRefsToVaultAtomic(source, vault, refs);
  return refs;
}

function cmdBackupOne(args) {
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const source = sourceBare(repo);
  const vault = vaultRemote(manifest, args.remote);
  if (args.force) throw new VaultError("generic --force is not allowed for normal backup; use candidate adopt/discard flow");
  const preflight = reconcileManifestWithRemote(manifest, vault);
  const unsafe = preflight.rows.filter((row) => !SAFE_BACKUP_CLASSIFICATIONS.has(row.classification));
  if (preflight.sourceFailures.length || unsafe.length) {
    printJson({ ok: false, mode: "backup-one-preflight", counts: preflight.counts, unsafe, sourceFailures: preflight.sourceFailures });
    throw new VaultError("managed remote root is not safe for normal backup");
  }
  const result = pushSourceRefsToVault(source, vault, repo, [args.branch], args.dry_run)[0];
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
  if (args.force) throw new VaultError("generic --force is not allowed for normal backup; use candidate adopt/discard flow");
  const preflight = reconcileManifestWithRemote(manifest, vault);
  const unsafe = preflight.rows.filter((row) => !SAFE_BACKUP_CLASSIFICATIONS.has(row.classification));
  if (preflight.sourceFailures.length || unsafe.length) {
    const report = {
      ok: false,
      mode: "backup-all-preflight",
      manifestPath: path.resolve(args.manifest),
      manifestDigest: sha256File(args.manifest),
      vaultRemote: vault,
      counts: preflight.counts,
      unsafe,
      sourceFailures: preflight.sourceFailures,
    };
    if (args.receipt_out) writeJsonFile(args.receipt_out, report);
    printJson(report);
    throw new VaultError("managed remote root is not safe for normal backup");
  }
  const results = [];
  for (const [repoId, repo] of manifestRepos(manifest)) {
    const source = sourceBare(repo);
    const branches = args.branch ? [args.branch] : listSourceHeads(source).map(([, branch]) => branch);
    try {
      const pushed = pushSourceRefsToVault(source, vault, repo, branches, args.dry_run);
      for (const ref of pushed) {
        const item = { repoId, sourceBarePath: source, branch: ref.branch };
        Object.assign(item, ref);
        item.remoteHash = args.dry_run ? null : oneRemoteHash(vault, item.vaultRef);
        item.ok = args.dry_run || item.sourceHash === item.remoteHash;
        item.status = args.dry_run ? "dry-run" : "backed-up";
        results.push(item);
      }
    } catch (exc) {
      results.push({ ok: false, repoId, sourceBarePath: source, status: "failed", error: errStr(exc) });
    }
  }
  const allOk = results.every((item) => item.ok);
  const report = {
    ok: allOk,
    mode: "backup-all",
    manifestPath: path.resolve(args.manifest),
    manifestDigest: sha256File(args.manifest),
    vaultRemote: vault,
    dryRun: args.dry_run,
    results,
  };
  if (args.receipt_out) writeJsonFile(args.receipt_out, report);
  printJson(report);
  if (!allOk) {
    throw new VaultError("one or more refs failed backup");
  }
}

function cmdRestoreBareOne(args) {
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const vault = vaultRemote(manifest, args.remote);
  const srcRef = projectHeadRef(identityFromRepo(repo).repoKey, args.branch);
  const vaultHash = oneRemoteHash(vault, srcRef);
  if (!vaultHash) throw new VaultError(`missing vault branch: ${srcRef}`);
  const restored = restoreRemoteRefToStaging(vault, srcRef, args.branch, args.staging_bare, vaultHash);
  const ok = restored.restoredHash === vaultHash && Boolean(restored.restoredHash);
  printJson({
    ok,
    mode: "restore-bare-one",
    repoId: args.repo_id,
    branch: args.branch,
    vaultRemote: vault,
    vaultRef: srcRef,
    stagingBare: restored.staging,
    restoredRef: restored.dstRef,
    restoredHash: restored.restoredHash,
    headTarget: restored.headTarget,
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
  const refspecs = heads.map((ref) => `${ref}:${ref}`);
  run(["git", "--git-dir", staging, "push", "--atomic", target, ...refspecs], { capture: true });
  const stagingHead = run(["git", "--git-dir", staging, "symbolic-ref", "HEAD"], { capture: true, check: false });
  if (stagingHead.returncode === 0 && stagingHead.stdout.trim()) {
    run(["git", "--git-dir", target, "symbolic-ref", "HEAD", stagingHead.stdout.trim()], { capture: true });
  }
  run(["git", "--git-dir", target, "fsck", "--full"], { capture: true });
  const promoted = [];
  for (const ref of heads) {
    promoted.push({ ref, hash: oneRemoteHash(target, ref) });
  }
  printJson({
    ok: true,
    mode: "promote-staging-bare",
    repoId: args.repo_id,
    stagingBare: staging,
    targetBare: target,
    headTarget: stagingHead.returncode === 0 ? stagingHead.stdout.trim() : null,
    promoted,
  });
}

function cmdCandidatePlan(args) {
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const vault = vaultRemote(manifest, args.remote);
  const remoteRef = projectHeadRef(identityFromRepo(repo).repoKey, args.branch);
  const reconciled = reconcileManifestWithRemote(manifest, vault);
  const row = findReconciledRow(reconciled, remoteRef);
  printJson({
    ok: true,
    mode: "candidate-plan",
    repoId: args.repo_id,
    repoPath: row.repoPath || row.parsed?.repoPath || null,
    branch: args.branch,
    sourceBarePath: row.sourceBarePath || sourceBare(repo),
    vaultRemote: vault,
    remoteRef,
    classification: row.classification,
    sourceOid: row.sourceOid || null,
    remoteOid: row.remoteOid || null,
    parsed: row.parsed || null,
    actionRequired: !SAFE_BACKUP_CLASSIFICATIONS.has(row.classification),
  });
}

function cmdCandidateAdopt(args) {
  if (!args.confirm) throw new VaultError("candidate-adopt requires --confirm");
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const source = sourceBare(repo);
  if (!isLocalBare(source)) throw new VaultError("candidate-adopt requires a local source bare for exact source CAS");
  const vault = vaultRemote(manifest, args.remote);
  const branchRef = `refs/heads/${args.branch}`;
  const remoteRef = projectHeadRef(identityFromRepo(repo).repoKey, args.branch);
  const expectedSourceOid = normalizeExpectedOid(args.expected_source_oid, "expected source oid");
  const expectedRemoteOid = normalizeExpectedOid(args.expected_remote_oid, "expected remote oid");
  if (!expectedRemoteOid) throw new VaultError("candidate-adopt requires an expected remote oid");

  assertOidEquals(oneRemoteHash(source, branchRef), expectedSourceOid, "source");
  assertOidEquals(oneRemoteHash(vault, remoteRef), expectedRemoteOid, "remote");
  const relation =
    expectedSourceOid === null
      ? { classification: "remote-ahead-candidate" }
      : classifyCommitRelation(source, branchRef, expectedSourceOid, vault, remoteRef, expectedRemoteOid);
  if (relation.classification !== "remote-ahead-candidate") {
    throw new VaultError(`candidate-adopt requires remote-ahead-candidate, observed ${relation.classification}`);
  }

  const restored = restoreRemoteRefToStaging(vault, remoteRef, args.branch, args.staging_bare, expectedRemoteOid);
  const tempRef = `refs/ops-refs-vault/candidates/${args.branch}`;
  run(["git", "--git-dir", source, "fetch", "--no-tags", restored.staging, `+${restored.dstRef}:${tempRef}`], { capture: true });
  assertOidEquals(oneRemoteHash(source, branchRef), expectedSourceOid, "source");
  assertOidEquals(oneRemoteHash(vault, remoteRef), expectedRemoteOid, "remote");
  run(["git", "--git-dir", source, "update-ref", branchRef, expectedRemoteOid, expectedSourceOid || ZERO_OID], { capture: true });
  run(["git", "--git-dir", source, "update-ref", "-d", tempRef, expectedRemoteOid], { capture: true, check: false });
  const sourceAfter = oneRemoteHash(source, branchRef);
  if (sourceAfter !== expectedRemoteOid) throw new VaultError("candidate-adopt postcondition failed");
  printJson({
    ok: true,
    mode: "candidate-adopt",
    repoId: args.repo_id,
    branch: args.branch,
    sourceBarePath: source,
    vaultRemote: vault,
    remoteRef,
    expectedSourceOid: expectedSourceOid || "absent",
    expectedRemoteOid,
    sourceAfter,
    stagingBare: restored.staging,
    headTarget: restored.headTarget,
  });
}

function cmdCandidateDiscard(args) {
  if (!args.confirm) throw new VaultError("candidate-discard requires --confirm");
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const source = sourceBare(repo);
  if (!isLocalBare(source)) throw new VaultError("candidate-discard requires a local source bare for exact source observation");
  const vault = vaultRemote(manifest, args.remote);
  const branchRef = `refs/heads/${args.branch}`;
  const remoteRef = projectHeadRef(identityFromRepo(repo).repoKey, args.branch);
  const expectedSourceOid = normalizeExpectedOid(args.expected_source_oid, "expected source oid");
  const expectedRemoteOid = normalizeExpectedOid(args.expected_remote_oid, "expected remote oid");
  if (!expectedSourceOid) throw new VaultError("candidate-discard requires an existing expected source oid");
  if (!expectedRemoteOid) throw new VaultError("candidate-discard requires an expected remote oid");

  assertOidEquals(oneRemoteHash(source, branchRef), expectedSourceOid, "source");
  assertOidEquals(oneRemoteHash(vault, remoteRef), expectedRemoteOid, "remote");
  pushSourceOidToVaultWithLease(source, vault, expectedSourceOid, remoteRef, expectedRemoteOid);
  assertOidEquals(oneRemoteHash(source, branchRef), expectedSourceOid, "source");
  const remoteAfter = oneRemoteHash(vault, remoteRef);
  if (remoteAfter !== expectedSourceOid) throw new VaultError("candidate-discard postcondition failed");
  printJson({
    ok: true,
    mode: "candidate-discard",
    repoId: args.repo_id,
    branch: args.branch,
    sourceBarePath: source,
    vaultRemote: vault,
    remoteRef,
    expectedSourceOid,
    expectedRemoteOid,
    remoteAfter,
  });
}

function cmdVerifyOne(args) {
  const manifest = loadManifest(args.manifest);
  const repo = manifestRepo(manifest, args.repo_id);
  const source = sourceBare(repo);
  const vault = vaultRemote(manifest, args.remote);
  const sourceRef = `refs/heads/${args.branch}`;
  const vaultRef = projectHeadRef(identityFromRepo(repo).repoKey, args.branch);
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

function cmdVerifyAll(args) {
  const manifest = loadManifest(args.manifest);
  const vault = vaultRemote(manifest, args.remote);
  const reconciled = reconcileManifestWithRemote(manifest, vault);
  const results = reconciled.rows.map((row) => ({
    ok: row.classification === "equal",
    repoId: row.repoId || row.parsed?.repoPath || null,
    repoPath: row.repoPath || row.parsed?.repoPath || null,
    branch: row.branch || row.parsed?.branch || null,
    sourceBarePath: row.sourceBarePath || null,
    sourceRef: row.sourceRef || null,
    vaultRef: row.remoteRef,
    sourceHash: row.sourceOid || null,
    vaultHash: row.remoteOid || null,
    status: row.classification,
    parsed: row.parsed || null,
  }));
  const allOk = reconciled.sourceFailures.length === 0 && results.every((item) => item.ok);
  printJson({
    ok: allOk,
    mode: "verify-all",
    manifestPath: path.resolve(args.manifest),
    manifestDigest: sha256File(args.manifest),
    vaultRemote: vault,
    counts: reconciled.counts,
    sourceFailures: reconciled.sourceFailures,
    results,
  });
  if (!allOk) {
    throw new VaultError("one or more refs failed verify");
  }
}

function cmdOrphanAudit(args) {
  const manifest = loadManifest(args.manifest);
  const vault = vaultRemote(manifest, args.remote);
  const reconciled = reconcileManifestWithRemote(manifest, vault);
  const missingRefs = reconciled.rows.filter((row) => row.classification === "missing-remote").map((row) => row.remoteRef).sort();
  const orphanRefs = reconciled.rows
    .filter((row) => row.classification.startsWith("extra-") || row.classification === "unknown-managed-extra")
    .map((row) => row.remoteRef)
    .sort();
  const mismatchRefs = reconciled.rows
    .filter((row) => !["equal", "missing-remote"].includes(row.classification) && !orphanRefs.includes(row.remoteRef))
    .map((row) => row.remoteRef)
    .sort();
  const extraRepoIds = [...new Set(orphanRefs.map((ref) => parseManagedRemoteRef(ref).repoPath).filter(Boolean))].sort();
  const ok = reconciled.sourceFailures.length === 0 && missingRefs.length === 0 && orphanRefs.length === 0 && mismatchRefs.length === 0;
  printJson({
    ok,
    mode: "orphan-audit",
    manifestPath: path.resolve(args.manifest),
    manifestDigest: sha256File(args.manifest),
    vaultRemote: vault,
    counts: reconciled.counts,
    expectedRefs: reconciled.rows.filter((row) => row.sourceOid).length,
    vaultRefs: reconciled.rows.filter((row) => row.remoteOid).length,
    missingRefs,
    orphanRefs,
    mismatchRefs,
    extraRepoIds,
    sourceFailures: reconciled.sourceFailures,
  });
  if (!ok) {
    throw new VaultError("vault refs differ from generated manifest snapshot");
  }
}

function cmdAudit(args) {
  const manifest = loadManifest(args.manifest);
  const vault = vaultRemote(manifest, args.remote);
  const reconciled = reconcileManifestWithRemote(manifest, vault);
  const expected = manifestRepos(manifest).map(([repoPath]) => repoPath);
  const seenKeys = [
    ...new Set(reconciled.rows.filter((row) => row.remoteOid).map((row) => row.parsed?.repoPath).filter(Boolean)),
  ].sort();
  const missing = expected.filter((repoPath) => !reconciled.rows.some((row) => row.repoPath === repoPath && row.remoteOid));
  const extra = reconciled.rows
    .filter((row) => row.classification.startsWith("extra-") || row.classification === "unknown-managed-extra")
    .map((row) => row.remoteRef)
    .sort();
  const ok = reconciled.ok && reconciled.sourceFailures.length === 0;
  printJson({
    ok,
    mode: "audit",
    vaultRemote: vault,
    counts: reconciled.counts,
    expectedRepoIds: expected,
    seenRepoIds: seenKeys.slice().sort(),
    missing,
    extra,
    mismatched: reconciled.rows
      .filter((row) => !["equal", "missing-remote"].includes(row.classification) && !extra.includes(row.remoteRef))
      .map((row) => ({ ref: row.remoteRef, classification: row.classification })),
    sourceFailures: reconciled.sourceFailures,
  });
  if (!ok) {
    throw new VaultError("vault refs differ from generated manifest snapshot");
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
    withRedirectStdout(() =>
      cmdGenerateManifest({ bare_root: path.join(root, "ssot"), out: manifest, remote: vault, exclude_file: null }),
    );
    proof("P12", "generate-manifest derives a non-authority backup snapshot from the bare root", [manifest]);

    const receipt = path.join(root, "backup-receipt.json");
    const backup = { manifest, remote: null, branch: null, force: false, dry_run: false, receipt_out: receipt };
    withRedirectStdout(() => cmdBackupAll(backup));
    proof("P02", "backup-all reads manifest sourceBarePath and backs up repo-specific bare SSOT repos", [manifest]);
    if (!fs.existsSync(receipt)) {
      throw new VaultError("backup receipt missing");
    }
    proof("P13", "backup-all can emit a receipt containing the manifest digest and per-ref results", [receipt]);

    const vaultAlphaRef = namespacedHead("alpha", branch);
    const vaultBetaRef = namespacedHead("beta", branch);
    if (!oneRemoteHash(vault, vaultAlphaRef) || !oneRemoteHash(vault, vaultBetaRef)) {
      throw new VaultError("namespaced vault refs missing after backup-all");
    }
    proof("P03", "repoPath and branch map to refs/heads/<repoKey>/<branch>", [vaultAlphaRef, vaultBetaRef]);

    const audit = { manifest, remote: null };
    withRedirectStdout(() => cmdAudit(audit));
    proof("P04", "audit sees expected repoId namespaces in the single forge backup", ["audit"]);

    const verify = { manifest, remote: null, repo_id: "alpha", branch };
    withRedirectStdout(() => cmdVerifyOne(verify));
    proof("P05", "verify-one compares source bare hash with forge backup hash", ["verify-one alpha/main"]);
    withRedirectStdout(() => cmdVerifyAll({ manifest, remote: null }));
    proof("P14", "verify-all compares every generated manifest source head with the forge backup hash", ["verify-all"]);
    withRedirectStdout(() => cmdOrphanAudit({ manifest, remote: null }));
    proof("P15", "orphan-audit rejects missing or extra forge refs relative to the generated snapshot", ["orphan-audit"]);

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
  `                      {generate-manifest,backup-one,backup-all,restore-bare-one,promote-staging-bare,candidate-plan,candidate-adopt,candidate-discard,audit,verify-one,verify-all,orphan-audit,inventory,smoke-local} ...\n`;

// Per-subcommand usage blocks, byte-reproduced from argparse (prog="ops-refs-vault <cmd>").
const SUB_USAGE = {
  "generate-manifest":
    `usage: ${PROG} generate-manifest [-h] --bare-root BARE_ROOT --out OUT\n` +
    `                                      [--remote REMOTE]\n` +
    `                                      [--exclude-file EXCLUDE_FILE]\n`,
  "backup-one":
    `usage: ${PROG} backup-one [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                 --branch BRANCH [--remote REMOTE] [--force]\n` +
    `                                 [--dry-run]\n`,
  "backup-all":
    `usage: ${PROG} backup-all [-h] --manifest MANIFEST [--remote REMOTE]\n` +
    `                                 [--branch BRANCH] [--receipt-out RECEIPT_OUT]\n` +
    `                                 [--force] [--dry-run]\n`,
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
  "candidate-plan":
    `usage: ${PROG} candidate-plan [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                      --branch BRANCH [--remote REMOTE]\n`,
  "candidate-adopt":
    `usage: ${PROG} candidate-adopt [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                       --branch BRANCH --expected-source-oid EXPECTED_SOURCE_OID\n` +
    `                                       --expected-remote-oid EXPECTED_REMOTE_OID\n` +
    `                                       --staging-bare STAGING_BARE [--remote REMOTE]\n` +
    `                                       [--confirm]\n`,
  "candidate-discard":
    `usage: ${PROG} candidate-discard [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                         --branch BRANCH --expected-source-oid EXPECTED_SOURCE_OID\n` +
    `                                         --expected-remote-oid EXPECTED_REMOTE_OID\n` +
    `                                         [--remote REMOTE] [--confirm]\n`,
  audit: `usage: ${PROG} audit [-h] --manifest MANIFEST [--remote REMOTE]\n`,
  "verify-one":
    `usage: ${PROG} verify-one [-h] --manifest MANIFEST --repo-id REPO_ID\n` +
    `                                 --branch BRANCH [--remote REMOTE]\n`,
  "verify-all": `usage: ${PROG} verify-all [-h] --manifest MANIFEST [--remote REMOTE]\n`,
  "orphan-audit": `usage: ${PROG} orphan-audit [-h] --manifest MANIFEST [--remote REMOTE]\n`,
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
  "generate-manifest": {
    flags: ["--remote", "--exclude-file"],
    bools: [],
    required: ["--bare-root", "--out"],
  },
  "backup-one": { flags: ["--remote"], bools: ["--force", "--dry-run"], required: ["--manifest", "--repo-id", "--branch"] },
  "backup-all": { flags: ["--remote", "--branch", "--receipt-out"], bools: ["--force", "--dry-run"], required: ["--manifest"] },
  "restore-bare-one": { flags: ["--remote"], bools: [], required: ["--manifest", "--repo-id", "--branch", "--staging-bare"] },
  "promote-staging-bare": { flags: [], bools: ["--confirm"], required: ["--repo-id", "--staging-bare", "--target-bare"] },
  "candidate-plan": { flags: ["--remote"], bools: [], required: ["--manifest", "--repo-id", "--branch"] },
  "candidate-adopt": {
    flags: ["--remote"],
    bools: ["--confirm"],
    required: ["--manifest", "--repo-id", "--branch", "--expected-source-oid", "--expected-remote-oid", "--staging-bare"],
  },
  "candidate-discard": {
    flags: ["--remote"],
    bools: ["--confirm"],
    required: ["--manifest", "--repo-id", "--branch", "--expected-source-oid", "--expected-remote-oid"],
  },
  audit: { flags: ["--remote"], bools: [], required: ["--manifest"] },
  "verify-one": { flags: ["--remote"], bools: [], required: ["--manifest", "--repo-id", "--branch"] },
  "verify-all": { flags: ["--remote"], bools: [], required: ["--manifest"] },
  "orphan-audit": { flags: ["--remote"], bools: [], required: ["--manifest"] },
  inventory: { flags: [], bools: [], required: ["--manifest", "--out-dir"] },
  "smoke-local": { flags: [], bools: [], required: [] },
};

function parseSub(command, rest) {
  const spec = SUB_SPEC[command];
  const allFlags = [
    "--manifest",
    "--repo-id",
    "--branch",
    "--remote",
    "--staging-bare",
    "--target-bare",
    "--out-dir",
    "--bare-root",
    "--out",
    "--exclude-file",
    "--receipt-out",
    "--expected-source-oid",
    "--expected-remote-oid",
  ];
  const key = (flag) => flag.replace(/^--/, "").replace(/-/g, "_");
  const out = {
    manifest: undefined,
    repo_id: undefined,
    branch: undefined,
    remote: null,
    staging_bare: undefined,
    target_bare: undefined,
    out_dir: undefined,
    bare_root: undefined,
    out: undefined,
    exclude_file: null,
    receipt_out: null,
    expected_source_oid: undefined,
    expected_remote_oid: undefined,
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
  "generate-manifest": cmdGenerateManifest,
  "backup-one": cmdBackupOne,
  "backup-all": cmdBackupAll,
  "restore-bare-one": cmdRestoreBareOne,
  "promote-staging-bare": cmdPromoteStagingBare,
  "candidate-plan": cmdCandidatePlan,
  "candidate-adopt": cmdCandidateAdopt,
  "candidate-discard": cmdCandidateDiscard,
  audit: cmdAudit,
  "verify-one": cmdVerifyOne,
  "verify-all": cmdVerifyAll,
  "orphan-audit": cmdOrphanAudit,
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
      `argument command: invalid choice: '${command}' (choose from generate-manifest, backup-one, backup-all, restore-bare-one, promote-staging-bare, candidate-plan, candidate-adopt, candidate-discard, audit, verify-one, verify-all, orphan-audit, inventory, smoke-local)`,
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
