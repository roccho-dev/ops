import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { ensureCleanGitWorktree, ensureGitInfoExclude, git, gitRevParse, runCapture } from "./host-git-ops.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-worker-merge-queue.mjs --repo <repo> --branch <branch> [--branch <branch> ...] [--target main] [--testCmd <cmd>|--noTest] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: { repo: null, branches: [], target: "main", testCmd: "./scripts/test.sh", json: false },
    flags: {
      repo: { required: true },
      branches: { names: ["--branch"], multiple: true },
      target: {},
      testCmd: {},
      noTest: { type: "boolean", set: (out) => { out.testCmd = ""; } },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => out.branches.length > 0 ? out : null,
  });
}

function main(args) {
  ensureGitInfoExclude(args.repo, ".worktrees/");
  ensureCleanGitWorktree(args.repo);
  git(args.repo, ["switch", args.target]);
  const merged = [];
  for (const branch of args.branches) {
    ensureCleanGitWorktree(args.repo);
    git(args.repo, ["merge", "--no-ff", branch, "-m", `merge ${branch}`]);
    let test = null;
    if (args.testCmd) {
      const r = runCapture(String(args.testCmd), { cwd: args.repo, check: false });
      test = { ok: r.rc === 0, rc: r.rc, output: r.out.trim() };
      if (r.rc !== 0) throw new Error(`test failed after merge ${branch} rc=${r.rc}:\n${r.out}`);
    }
    merged.push({ branch, head: gitRevParse(args.repo, "HEAD"), test });
  }
  const out = { ok: true, repo: args.repo, target: args.target, head: gitRevParse(args.repo, "HEAD"), merged };
  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else std.out.puts(`head=${out.head}\n`);
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
