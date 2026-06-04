import * as std from "./core/std.mjs";
import { getDefaultAddr, getDefaultPort, parseArgs, run } from "./lib.mjs";
import { getAppAdapter, findAdapterTarget } from "./app-adapters.mjs";
import { cdpList } from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-chatgpt-login.mjs [--addr 127.0.0.1] [--port 9222] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      json: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function summarize(args) {
  const adapter = getAppAdapter("chatgpt");
  const targets = cdpList(args.addr, args.port);
  const target = findAdapterTarget(targets, adapter);

  if (!target) {
    return {
      ok: false,
      status: "target-not-found",
      reason: "CHATGPT_TAB_NOT_FOUND",
      hint: adapter.hint,
    };
  }

  return adapter.classifyTarget(target);
}

function printText(result) {
  std.out.puts(`chatgpt-status: ${result.status}\n`);
  std.out.puts(`reason: ${result.reason}\n`);
  if (result.url) std.out.puts(`url: ${result.url}\n`);
  if (result.title) std.out.puts(`title: ${result.title}\n`);
  if (result.hint) std.out.puts(`hint: ${result.hint}\n`);
}

function main(args) {
  const result = summarize(args);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else printText(result);
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
