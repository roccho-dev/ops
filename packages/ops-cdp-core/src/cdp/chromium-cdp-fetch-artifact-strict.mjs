import * as std from "./qjs-compat/std.mjs";

import { getDefaultAddr, getDefaultPort, parseArgs, run, runToString } from "./lib.mjs";
import { mkdirp } from "./fs.mjs";
import { fileSha256, fileSize, quarantineDownloadNames, nowIso, pathExists } from "./host-git-ops.mjs";

function getScriptModulePath(name) {
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || "");
  return root ? `${root}/${name}` : `parts/cdp/${name}`;
}

function getQjsExe() {
  return String(std.getenv("HQ_CDP_QJS") || "qjs");
}

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-fetch-artifact-strict.mjs --name <artifact> --outDir <dir> [--url <thread-url> | --irPath <path>] [--downloadsDir <dir>] [--archiveDir <dir>] [--addr 127.0.0.1] [--port <n>] [--json]\n",
  );
  std.err.flush();
}

function parseFetchOutput(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      url: null,
      irPath: null,
      name: null,
      outDir: null,
      downloadsDir: `${std.getenv("HOME") || "."}/Downloads`,
      archiveDir: null,
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      json: false,
    },
    flags: {
      url: {},
      irPath: {},
      name: { required: true },
      outDir: { required: true },
      downloadsDir: {},
      archiveDir: {},
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => (out.url || out.irPath) ? out : null,
  });
}

function main(args) {
  mkdirp(args.outDir);
  mkdirp(args.downloadsDir);
  const archiveDir = args.archiveDir || `${args.downloadsDir}/cdp-quarantine-${nowIso().replace(/[:.]/g, "-")}`;
  const moved = quarantineDownloadNames(args.downloadsDir, archiveDir, [args.name]);
  const outPath = `${args.outDir}/${args.name}`;
  if (pathExists(outPath)) {
    quarantineDownloadNames(args.outDir, archiveDir, [args.name]);
  }

  const cmd = [
    getQjsExe(),
    "--std",
    "-m",
    getScriptModulePath("chromium-cdp-fetch-artifact.mjs"),
    "--name", String(args.name),
    "--outDir", String(args.outDir),
    "--downloadsDir", String(args.downloadsDir),
    "--addr", String(args.addr),
    "--port", String(args.port),
  ];
  if (args.url) cmd.push("--url", String(args.url));
  if (args.irPath) cmd.push("--irPath", String(args.irPath));
  const raw = runToString(cmd);

  const parsed = parseFetchOutput(raw);
  const firstOk = parsed && Array.isArray(parsed.results)
    ? parsed.results.find((row) => row && row.ok === true)
    : null;
  const actualPath = firstOk && firstOk.out_path ? String(firstOk.out_path) : outPath;
  if (!pathExists(actualPath)) throw new Error(`artifact fetch did not create expected path: ${actualPath}\n${raw}`);
  const result = {
    ok: true,
    name: args.name,
    actualName: firstOk && firstOk.actual_name ? String(firstOk.actual_name) : args.name,
    filenameMismatch: firstOk ? firstOk.filename_mismatch === true : false,
    outPath: actualPath,
    size: fileSize(actualPath),
    sha256: fileSha256(actualPath),
    downloadsDir: args.downloadsDir,
    archiveDir,
    quarantined: moved,
    fetchOutput: raw.trim(),
  };
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else {
    std.out.puts(`outPath=${result.outPath}\n`);
    std.out.puts(`size=${result.size}\n`);
    std.out.puts(`sha256=${result.sha256}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
