import * as std from "qjs:std";
import { cdpList, cdpVersion, getDefaultAddr, getDefaultPort, parseArgs, run } from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-status.mjs [--addr 127.0.0.1] [--port 9222] [--json]\n",
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
  const version = cdpVersion(args.addr, args.port);
  const targets = cdpList(args.addr, args.port);
  const pages = (targets || []).filter((t) => t && t.type === "page");
  const attachablePages = pages.filter((t) => String(t.webSocketDebuggerUrl || "").length > 0);
  const chatgpt = pages.find((t) => String(t.url || "").startsWith("https://chatgpt.com"));

  return {
    ok: true,
    addr: args.addr,
    port: args.port,
    browser: String(version.Browser || ""),
    protocolVersion: String(version["Protocol-Version"] || ""),
    pageCount: pages.length,
    attachablePageCount: attachablePages.length,
    chatgptTargetFound: !!chatgpt,
    chatgptTitle: chatgpt ? String(chatgpt.title || "") : "",
    chatgptUrl: chatgpt ? String(chatgpt.url || "") : "",
  };
}

function printText(result) {
  std.out.puts(`CDP OK ${result.addr}:${result.port}\n`);
  std.out.puts(`browser: ${result.browser || "unknown"}\n`);
  std.out.puts(`protocol: ${result.protocolVersion || "unknown"}\n`);
  std.out.puts(`pages: ${result.pageCount} attachable=${result.attachablePageCount}\n`);
  if (result.chatgptTargetFound) {
    std.out.puts(`chatgpt: found\n`);
    std.out.puts(`title: ${result.chatgptTitle || "(empty)"}\n`);
    std.out.puts(`url: ${result.chatgptUrl}\n`);
  } else {
    std.out.puts("chatgpt: not-found\n");
    std.out.puts("hint: chromium-cdp 'https://chatgpt.com/'\n");
  }
}

function main(args) {
  const result = summarize(args);
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else printText(result);
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
