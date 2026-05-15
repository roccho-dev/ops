import * as std from "qjs:std";

import { getDefaultAddr, getDefaultPort, parseArgs, run, runToString, sleepMs } from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-wait-artifacts.mjs --url <thread-url> --name <artifact> [--name <artifact> ...] [--timeoutMs 1800000] [--intervalMs 600000] [--addr 127.0.0.1] [--port <n>] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      url: null,
      names: [],
      timeoutMs: 1800000,
      intervalMs: 600000,
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      json: false,
    },
    flags: {
      url: { required: true },
      names: { names: ["--name"], multiple: true },
      timeoutMs: { type: "number", names: ["--timeoutMs", "--timeout-ms"] },
      intervalMs: { type: "number", names: ["--intervalMs", "--interval-ms"] },
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => out.names.length ? out : null,
  });
}

function getScriptModulePath(name) {
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || "");
  return root ? `${root}/${name}` : `parts/cdp/${name}`;
}

function getQjsExe() {
  return String(std.getenv("HQ_CDP_QJS") || "qjs");
}

function listArtifacts(args) {
  const out = runToString([
    getQjsExe(), "--std", "-m", getScriptModulePath("chromium-cdp-list-artifacts.mjs"),
    "--url", args.url,
    "--addr", String(args.addr),
    "--port", String(args.port),
    "--json",
  ]);
  return JSON.parse(out);
}

function presentNames(doc) {
  const artifacts = Array.isArray(doc && doc.artifacts) ? doc.artifacts : [];
  return artifacts.map((row) => String(row && row.name || "")).filter(Boolean);
}

function main(args) {
  const start = Date.now();
  const deadline = start + Math.max(1, args.timeoutMs);
  let tries = 0;
  let last = null;
  while (true) {
    tries++;
    last = listArtifacts(args);
    const names = presentNames(last);
    const missing = args.names.filter((name) => !names.includes(name));
    if (!missing.length) {
      const result = {
        ok: true,
        url: args.url,
        expected: args.names,
        present: names,
        tries,
        elapsedMs: Math.trunc(Date.now() - start),
      };
      if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
      else std.out.puts(`ok=true tries=${tries}\n`);
      return 0;
    }
    if (Date.now() >= deadline) {
      const result = {
        ok: false,
        url: args.url,
        expected: args.names,
        present: names,
        missing,
        tries,
        elapsedMs: Math.trunc(Date.now() - start),
      };
      if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
      else std.out.puts(`ok=false missing=${missing.join(",")}\n`);
      return 1;
    }
    sleepMs(Math.max(1000, args.intervalMs));
  }
}

run(scriptArgs, { usage, buildArgs, main });
