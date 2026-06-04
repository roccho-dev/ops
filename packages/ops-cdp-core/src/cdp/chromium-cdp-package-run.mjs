import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { applyPackageArtifacts, PACKAGE_ARTIFACT_FORMATS, validatePackageArtifacts } from "./package-run.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-package-run.mjs --repo <repo> [--inbox <dir>] [--worker <name>] [--result <result.json>] [--patch <changes.patch>] [--series <series.json>] [--mbox <series.mbox>] [--bundle <repo.bundle>] [--bundleRef <ref>] [--format patch|mbox|bundle] [--expectedBaseRev <rev>] [--branch <branch>] [--worktree <path>] [--baseRef <rev>] [--testCmd <cmd>|--noTest] [--message <commit message>] [--reuse] [--validateOnly] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      repo: null,
      inbox: null,
      worker: null,
      result: null,
      patch: null,
      series: null,
      mbox: null,
      bundle: null,
      bundleRef: null,
      format: null,
      expectedBaseRev: null,
      branch: null,
      worktree: null,
      baseRef: null,
      testCmd: "./scripts/test.sh",
      message: null,
      reuse: false,
      validateOnly: false,
      apply: false,
      json: false,
    },
    flags: {
      repo: { required: true },
      inbox: {},
      worker: {},
      result: {},
      patch: {},
      series: {},
      mbox: {},
      bundle: {},
      bundleRef: {},
      format: {},
      expectedBaseRev: {},
      branch: {},
      worktree: {},
      baseRef: {},
      testCmd: {},
      noTest: { type: "boolean", set: (out) => { out.testCmd = ""; } },
      message: {},
      reuse: { type: "boolean" },
      validateOnly: { type: "boolean" },
      apply: { type: "boolean" },
      json: { type: "boolean" },
    },
    finalize: (out) => {
      if (out.format && PACKAGE_ARTIFACT_FORMATS.indexOf(String(out.format)) < 0) return false;
      return out;
    },
    finalizeError: "--format must be one of patch, mbox, or bundle",
    onError: "null",
    reportError: true,
  });
}

function main(args) {
  const out = args.validateOnly ? validatePackageArtifacts(args) : applyPackageArtifacts(args);
  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else {
    const action = out.applied ? out.applied.action : "validated";
    std.out.puts(`${out.ok ? "ok" : "ng"} ${out.format || "unknown"} ${action}\n`);
    if (!out.ok) for (const e of out.errors || []) std.out.puts(`error: ${e}\n`);
  }
  std.out.flush();
  std.err.flush();
  return out.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
