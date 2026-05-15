import * as std from "qjs:std";
import { openOrCreateChatGptTarget } from "./chatgpt/index.mjs";
import { requireCdp } from "./connect.mjs";
import { getDefaultAddr, getDefaultPort, parseArgs, run } from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m cdp-open.mjs --url <chatgpt-url> [--addr 127.0.0.1] [--port 9222] [--timeoutMs 60000]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      url: null,
      timeoutMs: 60000,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: { required: true },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
    },
    onError: "null",
  });
}

function main(args) {
  const conn = requireCdp(args.addr, args.port);
  const opened = openOrCreateChatGptTarget(conn, args.url, {
    purpose: "cdp-open",
    timeoutMs: args.timeoutMs,
  });

  std.out.puts(
    JSON.stringify(
      {
        ok: true,
        addr: opened.addr,
        port: opened.port,
        requestedUrl: args.url,
        finalUrl: opened.finalUrl || (opened.target && opened.target.url) || args.url,
        created: !!opened.created,
        navigated: !!opened.navigated,
        target: opened.target
          ? {
              id: opened.target.id,
              title: opened.target.title,
              url: opened.target.url,
              wsUrl: opened.target.webSocketDebuggerUrl,
            }
          : null,
      },
      null,
      2,
    ) + "\n",
  );
  std.out.flush();
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
