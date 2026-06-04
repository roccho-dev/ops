import * as std from "./core/std.mjs";
import { cdpList, getDefaultAddr, getDefaultPort, parseArgs, run } from "./lib.mjs";
import { findAdapterTarget, getAppAdapter, listAppAdapterNames } from "./app-adapters.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-app-login.mjs --app <name> [--addr 127.0.0.1] [--port 9222] [--json]\n",
  );
  std.err.puts(`known apps: ${listAppAdapterNames().join(", ")}\n`);
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      app: null,
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      json: false,
    },
    flags: {
      app: { required: true },
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function summarize(args) {
  const adapter = getAppAdapter(args.app);
  if (!adapter) {
    return {
      ok: false,
      status: "adapter-not-found",
      reason: "UNKNOWN_APP_ADAPTER",
      app: String(args.app || ""),
      knownApps: listAppAdapterNames(),
    };
  }

  const targets = cdpList(args.addr, args.port);
  const target = findAdapterTarget(targets, adapter);
  if (!target) {
    return {
      ok: false,
      status: "target-not-found",
      reason: "APP_TAB_NOT_FOUND",
      app: adapter.name,
      hint: adapter.hint || "",
    };
  }

  return {
    app: adapter.name,
    ...adapter.classifyTarget(target),
  };
}

function printText(result) {
  std.out.puts(`app: ${result.app || "(unknown)"}\n`);
  std.out.puts(`status: ${result.status}\n`);
  std.out.puts(`reason: ${result.reason}\n`);
  if (result.url) std.out.puts(`url: ${result.url}\n`);
  if (result.title) std.out.puts(`title: ${result.title}\n`);
  if (result.hint) std.out.puts(`hint: ${result.hint}\n`);
  if (result.authCookies && result.authCookies.length) {
    std.out.puts(`auth-cookies: ${result.authCookies.join(", ")}\n`);
  }
  if (result.preauthCookies && result.preauthCookies.length) {
    std.out.puts(`preauth-cookies: ${result.preauthCookies.join(", ")}\n`);
  }
  if (result.knownApps && result.knownApps.length) {
    std.out.puts(`known-apps: ${result.knownApps.join(", ")}\n`);
  }
}

function main(args) {
  const result = summarize(args);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else printText(result);
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
