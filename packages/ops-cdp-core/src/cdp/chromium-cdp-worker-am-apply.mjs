import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { ensureCleanGitWorktree, ensureGitInfoExclude, git, gitRevParse, pathExists, readJson, runCapture } from "./core/host-git.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-worker-am-apply.mjs --repo <repo> --worktree <path> --branch <branch> --series <series.json> --mbox <series.mbox> [--baseRef <rev>] [--expectedBaseRev <rev>] [--testCmd <cmd>|--noTest] [--reuse] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      repo: null,
      worktree: null,
      branch: null,
      series: null,
      mbox: null,
      baseRef: "HEAD",
      expectedBaseRev: null,
      testCmd: "./scripts/test.sh",
      reuse: false,
      json: false,
    },
    flags: {
      repo: { required: true },
      worktree: { required: true },
      branch: { required: true },
      series: { required: true },
      mbox: { required: true },
      baseRef: {},
      expectedBaseRev: {},
      testCmd: {},
      noTest: { type: "boolean", set: (out) => { out.testCmd = ""; } },
      reuse: { type: "boolean" },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function main(args) {
  const series = readJson(args.series);
  if (!series.baseRev) throw new Error("series.baseRev is required");
  if (args.expectedBaseRev && String(series.baseRev) !== String(args.expectedBaseRev)) {
    throw new Error(`baseRev mismatch: expected ${args.expectedBaseRev}, got ${series.baseRev}`);
  }
  const patchFormat = String(series.patchFormat || "");
  if (patchFormat && patchFormat !== "git-format-patch-mbox") {
    throw new Error(`unsupported patchFormat: ${patchFormat}`);
  }
  const mboxText = String(std.loadFile(args.mbox) || "");
  if (!/^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001/m.test(mboxText)) {
    throw new Error("mbox does not look like git format-patch output");
  }

  ensureGitInfoExclude(args.repo, ".worktrees/");
  if (!pathExists(args.worktree)) {
    git(args.repo, ["worktree", "add", "-B", args.branch, args.worktree, args.baseRef]);
  } else if (!args.reuse) {
    throw new Error(`worktree already exists; pass --reuse if intended: ${args.worktree}`);
  }
  ensureCleanGitWorktree(args.worktree);
  const before = gitRevParse(args.worktree, "HEAD");
  if (String(before) !== String(series.baseRev)) {
    throw new Error(`worktree base mismatch: expected ${series.baseRev}, got ${before}`);
  }

  const am = git(args.worktree, ["am", "--3way", args.mbox], { check: false });
  if (am.rc !== 0) {
    git(args.worktree, ["am", "--abort"], { check: false });
    throw new Error(`git am failed rc=${am.rc}:\n${am.out}`);
  }

  let test = null;
  if (args.testCmd) {
    const r = runCapture(String(args.testCmd), { cwd: args.worktree, check: false });
    test = { ok: r.rc === 0, rc: r.rc, output: r.out.trim() };
    if (r.rc !== 0) throw new Error(`test failed rc=${r.rc}:\n${r.out}`);
  }

  const head = gitRevParse(args.worktree, "HEAD");
  const commits = git(args.worktree, ["rev-list", "--reverse", `${series.baseRev}..HEAD`]).out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (series.patchCount && Number(series.patchCount) !== commits.length) {
    throw new Error(`patchCount mismatch: expected ${series.patchCount}, got ${commits.length}`);
  }

  const out = {
    ok: true,
    repo: args.repo,
    worktree: args.worktree,
    branch: args.branch,
    worker: series.worker || null,
    baseRev: series.baseRev,
    head,
    commits,
    patchCount: commits.length,
    filesChanged: Array.isArray(series.filesChanged) ? series.filesChanged : [],
    test,
  };
  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else std.out.puts(`head=${head}\n`);
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
