import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { ensureCleanGitWorktree, ensureGitInfoExclude, git, gitRevParse, pathExists, readJson, runCapture } from "./core/host-git.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-worker-apply.mjs --repo <repo> --worktree <path> --branch <branch> --result <result.json> --patch <changes.patch> [--baseRef <rev>] [--expectedBaseRev <rev>] [--testCmd <cmd>|--noTest] [--message <commit message>] [--reuse] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      repo: null,
      worktree: null,
      branch: null,
      result: null,
      patch: null,
      baseRef: "HEAD",
      expectedBaseRev: null,
      testCmd: "./scripts/test.sh",
      reuse: false,
      json: false,
      message: null,
    },
    flags: {
      repo: { required: true },
      worktree: { required: true },
      branch: { required: true },
      result: { required: true },
      patch: { required: true },
      baseRef: {},
      expectedBaseRev: {},
      testCmd: {},
      noTest: { type: "boolean", set: (out) => { out.testCmd = ""; } },
      reuse: { type: "boolean" },
      json: { type: "boolean" },
      message: {},
    },
    onError: "null",
    reportError: true,
  });
}

function main(args) {
  const result = readJson(args.result);
  if (!result.baseRev) throw new Error("result.baseRev is required");
  if (args.expectedBaseRev && String(result.baseRev) !== String(args.expectedBaseRev)) {
    throw new Error(`baseRev mismatch: expected ${args.expectedBaseRev}, got ${result.baseRev}`);
  }
  ensureGitInfoExclude(args.repo, ".worktrees/");
  if (!pathExists(args.worktree)) {
    git(args.repo, ["worktree", "add", "-B", args.branch, args.worktree, args.baseRef]);
  } else if (!args.reuse) {
    throw new Error(`worktree already exists; pass --reuse if intended: ${args.worktree}`);
  }
  ensureCleanGitWorktree(args.worktree);
  const applyCheck = git(args.worktree, ["apply", "--check", args.patch], { check: false });
  if (applyCheck.rc !== 0) throw new Error(`git apply --check failed:\n${applyCheck.out}`);
  git(args.worktree, ["apply", args.patch]);
  let test = null;
  if (args.testCmd) {
    const r = runCapture(String(args.testCmd), { cwd: args.worktree, check: false });
    test = { ok: r.rc === 0, rc: r.rc, output: r.out.trim() };
    if (r.rc !== 0) throw new Error(`test failed rc=${r.rc}:\n${r.out}`);
  }
  git(args.worktree, ["add", "-A"]);
  const status = git(args.worktree, ["status", "--short"]).out.trim();
  if (!status) throw new Error("patch produced no git changes");
  const message = args.message || `worker ${result.worker || args.branch} applies patch`;
  git(args.worktree, ["commit", "-m", message]);
  const commit = gitRevParse(args.worktree, "HEAD");
  const out = {
    ok: true,
    repo: args.repo,
    worktree: args.worktree,
    branch: args.branch,
    worker: result.worker || null,
    baseRev: result.baseRev,
    commit,
    filesChanged: Array.isArray(result.filesChanged) ? result.filesChanged : [],
    test,
  };
  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else {
    std.out.puts(`commit=${commit}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
