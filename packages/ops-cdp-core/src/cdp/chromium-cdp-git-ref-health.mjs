import * as std from "qjs:std";

import { parseArgs, run } from "./lib.mjs";
import { pathExists, runCapture, shellQuote } from "./host-git-ops.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-git-ref-health.mjs --repo <repo> [--deleteInvalidLooseRefs] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      repo: null,
      deleteInvalidLooseRefs: false,
      json: false,
    },
    flags: {
      repo: { required: true },
      deleteInvalidLooseRefs: { type: "boolean" },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function lines(text) {
  return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function gitDir(repo) {
  const common = runCapture(["git", "-C", repo, "rev-parse", "--git-common-dir"]).out.trim();
  return common.startsWith("/") ? common : `${repo}/${common}`;
}

function objectExists(repo, oid) {
  if (!/^[0-9a-f]{40}$/i.test(String(oid || ""))) return false;
  return runCapture(["git", "-C", repo, "cat-file", "-e", `${oid}^{object}`], { check: false }).rc === 0;
}

function readLooseRefs(repo, commonDir) {
  const refsDir = `${commonDir}/refs`;
  if (!pathExists(refsDir)) return [];
  const found = runCapture(`find ${shellQuote(refsDir)} -type f -print`, { check: false });
  const out = [];
  for (const path of lines(found.out)) {
    const body = String(std.loadFile(path) || "").trim();
    const oid = body.split(/\s+/)[0] || "";
    const rel = path.slice(commonDir.length + 1);
    out.push({ kind: "loose", ref: rel, oid, path, valid: objectExists(repo, oid) });
  }
  return out;
}

function readPackedRefs(repo, commonDir) {
  const packed = `${commonDir}/packed-refs`;
  if (!pathExists(packed)) return [];
  const out = [];
  for (const line of String(std.loadFile(packed) || "").split(/\r?\n/)) {
    const s = String(line || "").trim();
    if (!s || s.startsWith("#") || s.startsWith("^")) continue;
    const parts = s.split(/\s+/);
    const oid = parts[0] || "";
    const ref = parts[1] || "";
    if (!ref) continue;
    out.push({ kind: "packed", ref, oid, path: packed, valid: objectExists(repo, oid) });
  }
  return out;
}

function deleteInvalidLooseRefs(rows) {
  const deleted = [];
  for (const row of rows) {
    if (!row || row.kind !== "loose" || row.valid) continue;
    runCapture(["rm", "-f", row.path]);
    deleted.push({ ref: row.ref, oid: row.oid, path: row.path });
  }
  return deleted;
}

function main(args) {
  const commonDir = gitDir(args.repo);
  const showRef = runCapture(["git", "-C", args.repo, "show-ref", "--head", "--dereference"], { check: false });
  const refs = readLooseRefs(args.repo, commonDir).concat(readPackedRefs(args.repo, commonDir));
  const invalid = refs.filter((row) => !row.valid);
  const deleted = args.deleteInvalidLooseRefs ? deleteInvalidLooseRefs(invalid) : [];
  const ok = invalid.length === 0 && showRef.rc === 0;
  const result = {
    ok,
    repo: args.repo,
    gitCommonDir: commonDir,
    showRef: {
      ok: showRef.rc === 0,
      rc: showRef.rc,
      output: showRef.out.trim(),
    },
    refsChecked: refs.length,
    invalidRefs: invalid,
    deletedInvalidLooseRefs: deleted,
    advice: ok
      ? ["git refs look healthy"]
      : [
          "Prefer path:$PWD#... for host validation until stale refs are resolved.",
          "Do not treat git+file:// flake eval failure as implementation failure without ref health proof.",
          "Use --deleteInvalidLooseRefs only when the invalid loose ref path is reviewed.",
        ],
  };
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else {
    std.out.puts(`ok=${ok}\n`);
    std.out.puts(`invalidRefs=${invalid.length}\n`);
    for (const row of invalid) std.out.puts(`${row.kind}\t${row.ref}\t${row.oid}\n`);
  }
  std.out.flush();
  return ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
