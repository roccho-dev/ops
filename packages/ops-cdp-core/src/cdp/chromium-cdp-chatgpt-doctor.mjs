import * as std from "qjs:std";
import { getDefaultAddr, parseArgs, run } from "./lib.mjs";
import { selectRecommendedSession } from "./session-flow.mjs";

function usage() {
  std.err.puts("usage: qjs --std -m chromium-cdp-chatgpt-doctor.mjs [--addr 127.0.0.1] [--json]\n");
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: { addr: getDefaultAddr(), json: false },
    flags: {
      addr: {},
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function summarize(args) {
  const { sessions, chosen } = selectRecommendedSession({ addr: args.addr, app: "chatgpt" });
  return {
    ok: !!chosen,
    recommended: chosen ? {
      addr: chosen.addr,
      port: chosen.port,
      status: chosen.app.status,
      reason: chosen.app.reason,
      url: chosen.app.url || "",
      title: chosen.app.title || "",
    } : null,
    sessions: sessions.map((row) => ({
      addr: row.addr,
      port: row.port,
      browser: row.browser,
      pageCount: row.pageCount,
      status: row.app.status,
      reason: row.app.reason,
      url: row.app.url || "",
      title: row.app.title || "",
      recommended: !!row.recommended,
    })),
  };
}

function printText(result) {
  if (result.recommended) {
    std.out.puts(`recommended: ${result.recommended.addr}:${result.recommended.port}\n`);
    std.out.puts(`status: ${result.recommended.status}\n`);
    std.out.puts(`reason: ${result.recommended.reason}\n`);
    if (result.recommended.url) std.out.puts(`url: ${result.recommended.url}\n`);
    if (result.recommended.title) std.out.puts(`title: ${result.recommended.title}\n`);
  } else {
    std.out.puts("recommended: none\n");
  }
  std.out.puts("sessions:\n");
  for (const row of result.sessions) {
    std.out.puts(`- ${row.addr}:${row.port} ${row.status} ${row.reason}\n`);
  }
}

function main(args) {
  const result = summarize(args);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else printText(result);
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
