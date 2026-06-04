import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { fileSha256, fileSize, git, readJson } from "./core/host-git.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-worker-artifact-validate.mjs --result <result.json> --patch <changes.patch> [--repo <repo>] [--expectedBaseRev <rev>] [--worker <name>] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      result: null,
      patch: null,
      repo: null,
      expectedBaseRev: null,
      worker: null,
      json: false,
    },
    flags: {
      result: { required: true },
      patch: { required: true },
      repo: {},
      expectedBaseRev: {},
      worker: {},
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function main(args) {
  const result = readJson(args.result);
  const patchText = String(std.loadFile(args.patch) || "");
  const errors = [];
  if (!result || typeof result !== "object") errors.push("result is not an object");
  if (!result.worker) errors.push("result.worker is required");
  if (!result.baseRev) errors.push("result.baseRev is required");
  if (!Array.isArray(result.filesChanged) || result.filesChanged.length === 0) errors.push("result.filesChanged must be a non-empty array");
  if (!patchText.trim()) errors.push("patch is empty");
  if (args.worker && String(result.worker || "") !== String(args.worker)) errors.push(`worker mismatch: expected ${args.worker}, got ${result.worker}`);
  if (args.expectedBaseRev && String(result.baseRev || "") !== String(args.expectedBaseRev)) {
    errors.push(`baseRev mismatch: expected ${args.expectedBaseRev}, got ${result.baseRev}`);
  }
  let applyCheck = null;
  if (args.repo && patchText.trim()) {
    const check = git(args.repo, ["apply", "--check", args.patch], { check: false });
    applyCheck = { ok: check.rc === 0, rc: check.rc, output: check.out.trim() };
    if (check.rc !== 0) errors.push(`git apply --check failed: ${check.out.trim()}`);
  }
  const out = {
    ok: errors.length === 0,
    errors,
    worker: result.worker || null,
    baseRev: result.baseRev || null,
    filesChanged: Array.isArray(result.filesChanged) ? result.filesChanged : [],
    result: { path: args.result, size: fileSize(args.result), sha256: fileSha256(args.result) },
    patch: { path: args.patch, size: fileSize(args.patch), sha256: fileSha256(args.patch), hasDiffHeader: /^diff --git /m.test(patchText) },
    applyCheck,
  };
  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else {
    std.out.puts(out.ok ? "ok\n" : "ng\n");
    for (const e of errors) std.out.puts(`error: ${e}\n`);
  }
  return out.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
