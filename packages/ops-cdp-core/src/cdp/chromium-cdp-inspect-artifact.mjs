import * as std from "./qjs-compat/std.mjs";
import { parseArgs, run } from "./lib.mjs";
import zip from "./qjs-compat/zip.mjs";

function usage() {
  std.err.puts("usage: qjs --std -m chromium-cdp-inspect-artifact.mjs --path <file> [--json]\n");
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: { path: null, json: false },
    flags: {
      path: { required: true },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function inspectZip(path) {
  // 脱python: zipfile を node 純正 zip reader(中央ディレクトリ)で置換。
  const rows = zip.entrySizes(String(path || ""));
  return { kind: "zip", entries: rows, entryCount: rows.length };
}

function inspectText(path) {
  const raw = std.loadFile(String(path || ""));
  const text = raw == null ? "" : String(raw);
  return {
    kind: "text",
    preview: text.slice(0, 4000),
    bytes: text.length,
  };
}

function main(args) {
  const path = String(args.path || "");
  const result = path.endsWith(".zip") ? inspectZip(path) : inspectText(path);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else if (result.kind === "zip") {
    std.out.puts(`zip entries: ${result.entryCount}\n`);
    for (const row of result.entries) std.out.puts(`${row.size}\t${row.name}\n`);
  } else {
    std.out.puts(result.preview + "\n");
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
