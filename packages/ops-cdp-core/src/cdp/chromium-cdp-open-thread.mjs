import * as std from "./qjs-compat/std.mjs";
import { getDefaultAddr, parseArgs, run } from "./lib.mjs";
import { openOrCreateChatGptTarget } from "./chatgpt/index.mjs";
import { requireRecommendedSession } from "./session-flow.mjs";
import { requireCdp } from "./connect.mjs";

function usage() {
  std.err.puts("usage: qjs --std -m chromium-cdp-open-thread.mjs --url <chatgpt-thread-url> [--addr 127.0.0.1] [--port <n>] [--json]\n");
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: { url: null, addr: getDefaultAddr(), port: null, json: false },
    flags: {
      url: { required: true },
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function summarize(args) {
  const conn = args.port ? requireCdp(args.addr, args.port) : requireRecommendedSession({ addr: args.addr, app: "chatgpt" });
  const opened = openOrCreateChatGptTarget(conn, args.url, { purpose: "open-thread" });
  return {
    ok: true,
    addr: opened.addr,
    port: opened.port,
    targetId: String((opened.target && opened.target.id) || ""),
    title: String((opened.target && opened.target.title) || ""),
    url: String(opened.finalUrl || (opened.target && opened.target.url) || args.url),
    created: !!opened.created,
    navigated: !!opened.navigated,
  };
}

function main(args) {
  const result = summarize(args);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else {
    std.out.puts(`addr: ${result.addr}\n`);
    std.out.puts(`port: ${result.port}\n`);
    std.out.puts(`target: ${result.targetId}\n`);
    std.out.puts(`title: ${result.title}\n`);
    std.out.puts(`url: ${result.url}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
