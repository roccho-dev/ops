import * as std from "./qjs-compat/std.mjs";

import {
  ensureCleanGitWorktree,
  ensureGitInfoExclude,
  fileSha256,
  fileSize,
  git,
  gitRevParse,
  pathExists,
  readJson,
  runCapture,
} from "./core/host-git.mjs";

export const PACKAGE_ARTIFACT_FORMATS = ["patch", "mbox", "bundle"];

function joinPath(dir, name) {
  const d = String(dir || "").replace(/\/+$/, "");
  return d ? `${d}/${name}` : String(name || "");
}

function firstExisting(paths) {
  for (const path of paths) {
    if (path && pathExists(path)) return path;
  }
  return null;
}

function candidateNames(worker, suffixes) {
  const out = [];
  const w = String(worker || "").trim();
  if (w) for (const suffix of suffixes) out.push(`${w}${suffix}`);
  for (const suffix of suffixes) out.push(suffix.replace(/^\./, ""));
  return out;
}

function inboxCandidates(inbox, worker, suffixes) {
  if (!inbox) return [];
  return candidateNames(worker, suffixes).map((name) => joinPath(inbox, name));
}

function safeName(value, fallback) {
  const s = String(value || fallback || "package-run")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || String(fallback || "package-run");
}

function readJsonIfPath(path) {
  return path ? readJson(path) : null;
}

function textFile(path) {
  return String(std.loadFile(path) || "");
}

function artifactMeta(path) {
  if (!path) return null;
  return { path, size: fileSize(path), sha256: fileSha256(path) };
}

function validateBase(meta, expectedBaseRev, errors, label) {
  if (!meta || !meta.baseRev) {
    errors.push(`${label}.baseRev is required`);
    return;
  }
  if (expectedBaseRev && String(meta.baseRev) !== String(expectedBaseRev)) {
    errors.push(`baseRev mismatch: expected ${expectedBaseRev}, got ${meta.baseRev}`);
  }
}

export function detectPackageArtifacts(args) {
  const a = args || {};
  const inbox = a.inbox || null;
  const worker = a.worker || null;
  const result = a.result || firstExisting(inboxCandidates(inbox, worker, [".result.json", ".json"]));
  const patch = a.patch || firstExisting(inboxCandidates(inbox, worker, [".changes.patch", ".patch", ".diff"]));
  const series = a.series || firstExisting(inboxCandidates(inbox, worker, [".series.json", ".mbox.json", ".json"]));
  const mbox = a.mbox || firstExisting(inboxCandidates(inbox, worker, [".series.mbox", ".mbox"]));
  const bundle = a.bundle || firstExisting(inboxCandidates(inbox, worker, [".repo.bundle", ".bundle", ".git.bundle"])
    .concat(inbox ? [joinPath(inbox, "repo.bundle"), joinPath(inbox, "bundle.bundle")] : []));

  const formats = [];
  if (result && patch) formats.push("patch");
  if (series && mbox) formats.push("mbox");
  if (bundle) formats.push("bundle");

  return { inbox, worker, result, patch, series, mbox, bundle, formats };
}

export function validatePackageArtifacts(args) {
  const a = args || {};
  const detected = detectPackageArtifacts(a);
  const requestedFormat = a.format ? String(a.format) : null;
  const format = requestedFormat || detected.formats[0] || null;
  const errors = [];
  const checks = [];
  let result = null;
  let series = null;
  let patchText = "";
  let mboxText = "";
  let bundleHeads = [];
  let patchInfo = null;
  let mboxInfo = null;

  if (!format) errors.push("no supported package artifact set found: expected result+patch, series+mbox, or bundle");
  if (requestedFormat && PACKAGE_ARTIFACT_FORMATS.indexOf(requestedFormat) < 0) errors.push(`unsupported format: ${requestedFormat}`);

  if (format === "patch") {
    if (!detected.result) errors.push("patch format requires result.json");
    if (!detected.patch) errors.push("patch format requires changes.patch");
    if (detected.result) {
      result = readJsonIfPath(detected.result);
      if (!result || typeof result !== "object") errors.push("result is not an object");
      else {
        if (!result.worker) errors.push("result.worker is required");
        if (a.worker && String(result.worker || "") !== String(a.worker)) errors.push(`worker mismatch: expected ${a.worker}, got ${result.worker}`);
        validateBase(result, a.expectedBaseRev, errors, "result");
        if (!Array.isArray(result.filesChanged) || result.filesChanged.length === 0) errors.push("result.filesChanged must be a non-empty array");
      }
    }
    if (detected.patch) {
      if (a.skipPayloadText) {
        if (fileSize(detected.patch) <= 0) errors.push("patch is empty");
        patchInfo = { hasDiffHeader: null, skippedPayloadText: true };
      } else {
        patchText = textFile(detected.patch);
        if (!patchText.trim()) errors.push("patch is empty");
        patchInfo = { hasDiffHeader: /^diff --git /m.test(patchText) };
      }
      if (a.repo && !a.skipRepoChecks) {
        const check = git(a.repo, ["apply", "--check", detected.patch], { check: false });
        checks.push({ kind: "git-apply-check", ok: check.rc === 0, rc: check.rc, output: check.out.trim() });
        if (check.rc !== 0) errors.push(`git apply --check failed: ${check.out.trim()}`);
      }
    }
  } else if (format === "mbox") {
    if (!detected.series) errors.push("mbox format requires series.json");
    if (!detected.mbox) errors.push("mbox format requires series.mbox");
    if (detected.series) {
      series = readJsonIfPath(detected.series);
      if (!series || typeof series !== "object") errors.push("series is not an object");
      else {
        if (!series.worker) errors.push("series.worker is required");
        if (a.worker && String(series.worker || "") !== String(a.worker)) errors.push(`worker mismatch: expected ${a.worker}, got ${series.worker}`);
        validateBase(series, a.expectedBaseRev, errors, "series");
        const patchFormat = String(series.patchFormat || "");
        if (patchFormat && patchFormat !== "git-format-patch-mbox") errors.push(`unsupported patchFormat: ${patchFormat}`);
      }
    }
    if (detected.mbox) {
      if (a.skipPayloadText) {
        if (fileSize(detected.mbox) <= 0) errors.push("mbox is empty");
        mboxInfo = { looksLikeFormatPatch: null, skippedPayloadText: true };
      } else {
        mboxText = textFile(detected.mbox);
        if (!/^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001/m.test(mboxText)) errors.push("mbox does not look like git format-patch output");
        mboxInfo = { looksLikeFormatPatch: /^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001/m.test(mboxText) };
      }
    }
  } else if (format === "bundle") {
    if (!detected.bundle) errors.push("bundle format requires a git bundle");
    if (detected.result) {
      result = readJsonIfPath(detected.result);
      if (result && typeof result === "object") {
        if (a.worker && result.worker && String(result.worker) !== String(a.worker)) errors.push(`worker mismatch: expected ${a.worker}, got ${result.worker}`);
        if (result.baseRev) validateBase(result, a.expectedBaseRev, errors, "result");
      }
    }
    if (detected.bundle && a.repo) {
      const verify = git(a.repo, ["bundle", "verify", detected.bundle], { check: false });
      checks.push({ kind: "git-bundle-verify", ok: verify.rc === 0, rc: verify.rc, output: verify.out.trim() });
      if (verify.rc !== 0) errors.push(`git bundle verify failed: ${verify.out.trim()}`);
      const heads = git(a.repo, ["bundle", "list-heads", detected.bundle], { check: false });
      checks.push({ kind: "git-bundle-list-heads", ok: heads.rc === 0, rc: heads.rc, output: heads.out.trim() });
      if (heads.rc !== 0) errors.push(`git bundle list-heads failed: ${heads.out.trim()}`);
      bundleHeads = heads.out.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const parts = line.split(/\s+/);
        return { oid: parts[0] || "", ref: parts[1] || parts[0] || "" };
      });
      if (heads.rc === 0 && bundleHeads.length === 0) errors.push("bundle has no heads");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    format,
    detected,
    artifacts: {
      result: artifactMeta(detected.result),
      patch: artifactMeta(detected.patch),
      series: artifactMeta(detected.series),
      mbox: artifactMeta(detected.mbox),
      bundle: artifactMeta(detected.bundle),
    },
    result,
    series,
    patch: detected.patch ? patchInfo : null,
    mbox: detected.mbox ? mboxInfo : null,
    bundle: detected.bundle ? { heads: bundleHeads } : null,
    checks,
  };
}

function copyGitIdentity(repo, worktree) {
  const email = git(repo, ["config", "--get", "user.email"], { check: false }).out.trim();
  const name = git(repo, ["config", "--get", "user.name"], { check: false }).out.trim();
  if (email) git(worktree, ["config", "user.email", email]);
  if (name) git(worktree, ["config", "user.name", name]);
}

function configureWorktreeGitIdentity(sourceRepo, worktree) {
  const name = git(sourceRepo, ["config", "--get", "user.name"], { check: false }).out.trim() || "CDP Package Runner";
  const email = git(sourceRepo, ["config", "--get", "user.email"], { check: false }).out.trim() || "cdp-package-run@example.invalid";
  git(worktree, ["config", "user.name", name]);
  git(worktree, ["config", "user.email", email]);
}
function ensureWorktree(repo, branch, worktree, baseRef, reuse) {
  ensureGitInfoExclude(repo, ".worktrees/");
  if (!pathExists(worktree)) {
    runCapture(["git", "clone", "-q", "--no-checkout", repo, worktree]);
    copyGitIdentity(repo, worktree);
    git(worktree, ["checkout", "-q", "-B", branch, baseRef]);
  } else if (!reuse) {
    throw new Error(`worktree already exists; pass --reuse if intended: ${worktree}`);
  }
  configureWorktreeGitIdentity(repo, worktree);
  ensureCleanGitWorktree(worktree);
}

function branchRef(branch) {
  const b = String(branch || "");
  return b.indexOf("refs/") === 0 ? b : `refs/heads/${b}`;
}

function runOptionalTest(worktree, testCmd) {
  if (!testCmd) return null;
  const r = runCapture(String(testCmd), { cwd: worktree, check: false });
  const test = { ok: r.rc === 0, rc: r.rc, output: r.out.trim() };
  if (r.rc !== 0) throw new Error(`test failed rc=${r.rc}:\n${r.out}`);
  return test;
}

function defaultBranch(worker, format) {
  return `package/${safeName(worker, format || "artifact")}`;
}

function defaultWorktree(repo, worker, format) {
  return `${String(repo).replace(/\/+$/, "")}/.worktrees/${safeName(worker, `package-${format || "artifact"}`)}`;
}

function pickBundleHead(validation, requested) {
  const heads = validation && validation.bundle && Array.isArray(validation.bundle.heads) ? validation.bundle.heads : [];
  if (!heads.length) return null;
  const want = String(requested || "");
  if (want) {
    const hit = heads.find((h) => h.ref === want || h.ref.endsWith("/" + want) || h.oid === want || h.oid.startsWith(want));
    return hit || null;
  }
  for (const h of heads) if (h.ref === "HEAD") return h;
  return heads[0] || null;
}

export function applyPackageArtifacts(args) {
  const a = args || {};
  let validation = validatePackageArtifacts(Object.assign({}, a, { skipRepoChecks: true, skipPayloadText: true }));
  if (!validation.ok) throw new Error(`package artifacts failed validation: ${validation.errors.join("; ")}`);

  const format = validation.format;
  const detected = {
    result: validation.detected && validation.detected.result ? String(validation.detected.result) : null,
    patch: validation.detected && validation.detected.patch ? String(validation.detected.patch) : null,
    series: validation.detected && validation.detected.series ? String(validation.detected.series) : null,
    mbox: validation.detected && validation.detected.mbox ? String(validation.detected.mbox) : null,
    bundle: validation.detected && validation.detected.bundle ? String(validation.detected.bundle) : null,
    formats: validation.detected && Array.isArray(validation.detected.formats) ? validation.detected.formats.slice() : [],
  };
  const result = validation.result ? JSON.parse(JSON.stringify(validation.result)) : null;
  const series = validation.series ? JSON.parse(JSON.stringify(validation.series)) : null;
  const artifacts = validation.artifacts ? JSON.parse(JSON.stringify(validation.artifacts)) : null;
  const checks = validation.checks ? JSON.parse(JSON.stringify(validation.checks)) : [];
  const patch = validation.patch ? JSON.parse(JSON.stringify(validation.patch)) : null;
  const mbox = validation.mbox ? JSON.parse(JSON.stringify(validation.mbox)) : null;
  const bundle = validation.bundle ? JSON.parse(JSON.stringify(validation.bundle)) : null;
  const sourceHead = format === "bundle" ? pickBundleHead({ bundle }, a.bundleRef || (result && result.bundleRef)) : null;

  const branch = a.branch || defaultBranch(a.worker || (result && result.worker) || (series && series.worker), format);
  const worktree = a.worktree || defaultWorktree(a.repo, a.worker || branch, format);
  const baseRef = a.baseRef || a.expectedBaseRev || (result && result.baseRev) || (series && series.baseRev) || "HEAD";
  const testCmd = Object.prototype.hasOwnProperty.call(a, "testCmd") ? a.testCmd : "./scripts/test.sh";
  validation = null;
  let out = null;

  if (format === "patch") {
    ensureWorktree(a.repo, branch, worktree, baseRef, a.reuse);
    git(worktree, ["apply", detected.patch]);
    const test = runOptionalTest(worktree, testCmd);
    git(worktree, ["add", "-A"]);
    const status = git(worktree, ["status", "--short"]).out.trim();
    if (!status) throw new Error("patch produced no git changes");
    const message = a.message || `package-run ${(result && result.worker) || branch} applies patch`;
    git(worktree, ["commit", "-q", "-m", message]);
    git(a.repo, ["fetch", "-q", worktree, `HEAD:${branchRef(branch)}`]);
    out = { ok: true, action: "applied-patch", format, branch, worktree, commit: gitRevParse(worktree, "HEAD"), test };
  } else if (format === "mbox") {
    ensureWorktree(a.repo, branch, worktree, baseRef, a.reuse);
    const before = gitRevParse(worktree, "HEAD");
    if (series && series.baseRev && String(before) !== String(series.baseRev)) {
      throw new Error(`worktree base mismatch: expected ${series.baseRev}, got ${before}`);
    }
    const am = git(worktree, ["am", "--3way", "--quiet", detected.mbox], { check: false });
    if (am.rc !== 0) {
      git(worktree, ["am", "--abort"], { check: false });
      throw new Error(`git am failed rc=${am.rc}:\n${am.out}`);
    }
    const test = runOptionalTest(worktree, testCmd);
    const commits = git(worktree, ["rev-list", "--reverse", `${before}..HEAD`]).out.split("\n").map((s) => s.trim()).filter(Boolean);
    git(a.repo, ["fetch", "-q", worktree, `HEAD:${branchRef(branch)}`]);
    out = { ok: true, action: "applied-mbox", format, branch, worktree, head: gitRevParse(worktree, "HEAD"), commits, patchCount: commits.length, test };
  } else if (format === "bundle") {
    ensureGitInfoExclude(a.repo, ".worktrees/");
    ensureCleanGitWorktree(a.repo);
    if (!sourceHead) throw new Error(`bundle ref not found: ${a.bundleRef || (result && result.bundleRef) || "<first-head>"}`);
    const unbundle = git(a.repo, ["bundle", "unbundle", detected.bundle], { check: false });
    if (unbundle.rc !== 0) throw new Error(`git bundle unbundle failed rc=${unbundle.rc}:\n${unbundle.out}`);
    git(a.repo, ["branch", "-f", branch, sourceHead.oid]);
    const baseRev = a.expectedBaseRev || (result && result.baseRev) || null;
    if (baseRev) {
      const ancestor = git(a.repo, ["merge-base", "--is-ancestor", baseRev, branch], { check: false });
      if (ancestor.rc !== 0) throw new Error(`bundle branch ${branch} is not based on ${baseRev}`);
    }
    let test = null;
    if (worktree) {
      if (!pathExists(worktree)) {
        runCapture(["git", "clone", "-q", "--no-checkout", a.repo, worktree]);
        git(worktree, ["checkout", "-q", "-B", branch, `origin/${branch}`]);
      } else if (!a.reuse) throw new Error(`worktree already exists; pass --reuse if intended: ${worktree}`);
      ensureCleanGitWorktree(worktree);
      test = runOptionalTest(worktree, testCmd);
    }
    out = { ok: true, action: "fetched-bundle", format, branch, worktree, head: gitRevParse(a.repo, branch), sourceRef: sourceHead.ref || sourceHead.oid, test };
  }

  return { ok: true, errors: [], format, detected, artifacts, result, series, patch, mbox, bundle, checks, applied: out };
}
