import * as std from "./qjs-compat/std.mjs";
import { getDefaultAddr, parseArgs, run } from "./lib.mjs";
import { listDownloadArtifactsExpr, openOrCreateChatGptTarget } from "./domain/chatgpt/index.mjs";
import { loadIr, projectReadThreadResultFromIr } from "./domain/chatgpt/ir.mjs";
import { mkCaller } from "./lib.mjs";
import { requireRecommendedSession } from "./domain/session-flow.mjs";
import { requireCdp } from "./core/connect.mjs";

function usage() {
  std.err.puts("usage: qjs --std -m chromium-cdp-list-artifacts.mjs [--url <chatgpt-thread-url> | --irPath <path>] [--addr 127.0.0.1] [--port <n>] [--json]\n");
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: { url: null, irPath: null, addr: getDefaultAddr(), port: null, json: false },
    flags: {
      url: {},
      irPath: {},
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => (out.url || out.irPath) ? out : null,
  });
}

function summarizeFromIr(path) {
  const doc = loadIr(path);
  const projected = projectReadThreadResultFromIr(doc);
  return {
    ok: true,
    source: "ir",
    url: projected.href || "",
    title: projected.title || "",
    artifacts: Array.isArray(projected.artifacts) ? projected.artifacts : [],
  };
}

function summarizeFromUrl(args) {
  const conn = args.port ? requireCdp(args.addr, args.port) : requireRecommendedSession({ addr: args.addr, app: "chatgpt" });
  const opened = openOrCreateChatGptTarget(conn, args.url, { purpose: "list-artifacts" });
  const caller = mkCaller(opened.wsUrl);
  const probed = caller.evalValue(listDownloadArtifactsExpr(), { timeoutMs: 15000 }) || {};
  return {
    ok: true,
    source: "live",
    addr: opened.addr,
    port: opened.port,
    url: String(opened.finalUrl || args.url),
    title: String((opened.target && opened.target.title) || ""),
    artifacts: Array.isArray(probed.artifacts) ? probed.artifacts : [],
  };
}

function main(args) {
  const result = args.irPath ? summarizeFromIr(args.irPath) : summarizeFromUrl(args);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else {
    std.out.puts(`source: ${result.source}\n`);
    if (result.url) std.out.puts(`url: ${result.url}\n`);
    if (result.title) std.out.puts(`title: ${result.title}\n`);
    for (const row of result.artifacts) std.out.puts(`- ${row.name}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
