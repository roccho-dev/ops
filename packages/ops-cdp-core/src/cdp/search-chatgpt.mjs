// ChatGPT search and thread reader via CDP.
// Usage:
//   qjs --std -m search-chatgpt.mjs --help
//   qjs --std -m search-chatgpt.mjs --search "query" [--target-id ID] [--addr ADDR] [--port PORT]
//   qjs --std -m search-chatgpt.mjs --read URL [--target-id ID] [--addr ADDR] [--port PORT]

import * as std from "./qjs-compat/std.mjs";
import { cdpCall, cdpEvaluate, parseArgs, run, sleepMs, getDefaultAddr, getDefaultPort } from "./lib.mjs";
import { SELECTORS, openOrCreateChatGptTarget, requireChatGptTarget } from "./domain/chatgpt/index.mjs";
import {
  isFreshIr,
  loadIr,
  materializeThreadIr,
  materializeSearchIr,
  projectReadThreadResultFromIr,
  projectSearchResultFromIr,
  saveIr,
} from "./domain/chatgpt/ir.mjs";
import { requireCdp } from "./core/connect.mjs";

const SEARCH_INPUT_SELECTORS = [
  "input[placeholder='Search chats...']",
  "input[type='search']",
  "form input",
];

const MSG_SELECTOR = `${SELECTORS.assistantMsg},${SELECTORS.userMsg}`;
const THREAD_LINK_SELECTOR = "a[href*='/c/']";

function usage(stream) {
  const out = stream === "stdout" ? std.out : std.err;
  out.puts("ChatGPT Search and Thread Reader via CDP\n\nUsage:\n  qjs --std -m search-chatgpt.mjs --search QUERY [--addr ADDR] [--port PORT]\n  qjs --std -m search-chatgpt.mjs --read URL [--tail N] [--addr ADDR] [--port PORT]\n  qjs --std -m search-chatgpt.mjs --help\n\nOptions:\n  --addr ADDR    CDP address (default: 127.0.0.1)\n  --port PORT    CDP port (default: 9222)\n  --target-id ID  Use specific CDP target\n  --search QUERY  Search ChatGPT chats\n  --read URL      Read thread at URL\n  --tail N        Show last N messages\n  --irPath PATH   Read/write IR snapshot\n  --preferIr      Use fresh IR first\n  --refresh       Ignore cached IR and refresh from live CDP\n  --maxAgeSec N   Freshness TTL for --preferIr\n  --stats         Include access statistics\n");
  out.flush();
}

function evalByValue(wsUrl, expression, timeoutMs) {
  const result = cdpEvaluate(wsUrl, expression, { returnByValue: true, timeoutMs: timeoutMs || 15000 });
  return result?.result?.result?.value;
}

function clickElement(wsUrl, x, y) {
  cdpCall(wsUrl, { id: 99, method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x, y } }, 3000);
  cdpCall(wsUrl, { id: 100, method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x, y, button: "left", clickCount: 1 } }, 3000);
  cdpCall(wsUrl, { id: 101, method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x, y, button: "left", clickCount: 1 } }, 3000);
}

function sendKey(wsUrl, key, code, modifiers) {
  modifiers = modifiers || 0;
  cdpCall(wsUrl, { id: 102, method: "Input.dispatchKeyEvent", params: { type: "keyDown", key, code, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers } }, 3000);
  cdpCall(wsUrl, { id: 103, method: "Input.dispatchKeyEvent", params: { type: "keyUp", key, code, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, modifiers } }, 3000);
}

function sendText(wsUrl, text) {
  cdpCall(wsUrl, { id: 104, method: "Input.insertText", params: { text } }, 5000);
}

function openSearchDialog(wsUrl) {
  sendKey(wsUrl, "k", "KeyK", 2);
  sleepMs(800);
  return { ok: true };
}

function search(wsUrl, query) {
  openSearchDialog(wsUrl);
  sleepMs(500);

  sendKey(wsUrl, "a", "KeyA", 2);
  sleepMs(100);
  sendText(wsUrl, query);
  sleepMs(1000);
  sendKey(wsUrl, "Enter", "Enter");
  sleepMs(3000);
  return { ok: true };
}

function getSearchResults(wsUrl) {
  const code = "Array.from(document.querySelectorAll('" + THREAD_LINK_SELECTOR + "')).map(a => ({ href: a.href, title: a.textContent ? a.textContent.trim().slice(0, 200) : '' }))";
  return evalByValue(wsUrl, code, 10000) || [];
}

function getMessages(wsUrl, maxCount) {
  maxCount = maxCount || 200;
  const code = "Array.from(document.querySelectorAll('" + MSG_SELECTOR + "')).slice(0," + maxCount + ").map((el, i) => ({ idx: i, role: el.getAttribute('data-message-author-role'), text: (el.innerText || '').slice(0, 5000) }))";
  return evalByValue(wsUrl, code, 15000) || [];
}

function waitForThreadLoad(wsUrl, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = evalByValue(wsUrl, "({ readyState: document.readyState, msgCount: document.querySelectorAll('" + MSG_SELECTOR + "').length, href: location.href })", 5000);
    if (state && state.readyState === "complete" && state.msgCount > 0) {
      return { ok: true, msgCount: state.msgCount, href: state.href };
    }
    sleepMs(2000);
  }
  return { ok: false, reason: "timeout" };
}

function buildArgs(argv) {
  return parseArgs(argv, {
    startIndex: 1,
    allowUnknown: true,
    onError: "null",
    onHelp: "set",
    helpKey: "help",
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      targetId: null,
      search: null,
      read: null,
      readTail: null,
      irPath: null,
      preferIr: false,
      refresh: false,
      maxAgeSec: 0,
      stats: false,
      help: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw) => Number(raw) },
      targetId: { name: "--target-id" },
      search: {},
      read: {},
      readTail: { name: "--tail", parse: (raw) => Number(raw) },
      irPath: { name: "--irPath" },
      preferIr: { type: "boolean" },
      refresh: { type: "boolean" },
      maxAgeSec: { parse: (raw) => Number(raw) },
      stats: { type: "boolean" },
    },
  });
}
function main(args) {
  if (args.help) {
    usage("stdout");
    return 0;
  }

  if (!args.search && !args.read) {
    std.err.puts("Error: specify --search or --read\n");
    return 1;
  }

  const stats = {
    ir_hit: false,
    ir_written: false,
    cdp: {
      list_count: 0,
      call_count: 0,
      evaluate_count: 0,
      navigate_count: 0,
    },
  };

  if (args.irPath && args.preferIr && !args.refresh) {
    try {
      const existing = loadIr(args.irPath);
      if (existing && isFreshIr(existing, { maxAgeSec: args.maxAgeSec })) {
        if (args.search && existing.search && String(existing.search.query || "") === String(args.search)) {
          stats.ir_hit = true;
          const out = projectSearchResultFromIr(existing);
          if (args.stats) out.stats = stats;
          std.out.puts(JSON.stringify(out, null, 2) + "\n");
          return 0;
        }
        if (args.read && existing.thread && String(existing.thread.id || "") === String(args.read).split("/").pop()) {
          stats.ir_hit = true;
          const out = {
            url: args.read,
            target: null,
            msgCount: Array.isArray(existing._cdp && existing._cdp.visible_messages) ? existing._cdp.visible_messages.length : 0,
            messages: Array.isArray(existing._cdp && existing._cdp.visible_messages) ? existing._cdp.visible_messages.slice(-(args.readTail || 200)) : [],
          };
          const projected = projectReadThreadResultFromIr(existing);
          out.url = projected.href || out.url;
          out.msgCount = projected.msgCount;
          if (args.stats) out.stats = stats;
          std.out.puts(JSON.stringify(out, null, 2) + "\n");
          return 0;
        }
      }
    } catch (_) {}
  }

  const conn = requireCdp(args.addr, args.port);
  stats.cdp.list_count += 1;
  let wsUrl = null;
  let target = null;

  if (args.targetId) {
    const resolved = requireChatGptTarget(conn, { id: args.targetId }, { purpose: "search-chatgpt" });
    target = resolved.target;
    wsUrl = resolved.wsUrl;
  }

  if (args.search) {
    if (!wsUrl) {
      const resolved = openOrCreateChatGptTarget(conn, "https://chatgpt.com/", { purpose: "search-chatgpt search", checkSession: false });
      target = resolved.target;
      wsUrl = resolved.wsUrl;
      stats.cdp.navigate_count += 1;
      sleepMs(3000);
    }

    const result = search(wsUrl, args.search);
    stats.cdp.call_count += 5;
    if (!result.ok) {
      std.err.puts("Search failed: " + result.reason + "\n");
      return 1;
    }

    const results = getSearchResults(wsUrl);
    stats.cdp.evaluate_count += 1;
    const output = {
      query: args.search,
      target: target ? target.id : null,
      results: results,
    };
    if (args.irPath) {
      saveIr(args.irPath, materializeSearchIr({
        captured_at: new Date().toISOString(),
        query: args.search,
        results,
        source: { kind: "cdp-live", addr: args.addr, port: args.port, target_id: target ? target.id : null, url: "https://chatgpt.com/" },
        stats,
      }));
      stats.ir_written = true;
    }
    if (args.stats) output.stats = stats;
    std.out.puts(JSON.stringify(output, null, 2) + "\n");
  }

  if (args.read) {
    if (!wsUrl) {
      const resolved = openOrCreateChatGptTarget(conn, args.read, { purpose: "search-chatgpt read", checkSession: false });
      target = resolved.target;
      wsUrl = resolved.wsUrl;
      stats.cdp.navigate_count += 1;
      waitForThreadLoad(wsUrl);
      stats.cdp.evaluate_count += 1;
    }

    const msgs = getMessages(wsUrl, args.readTail || 200);
    stats.cdp.evaluate_count += 1;
    const outputMsgs = args.readTail ? msgs.slice(-args.readTail) : msgs;

    const output = {
      url: args.read,
      target: target ? target.id : null,
      msgCount: msgs.length,
      messages: outputMsgs,
    };
    if (args.irPath) {
      saveIr(args.irPath, materializeThreadIr({
        captured_at: new Date().toISOString(),
        url: args.read,
        title: target && target.title ? target.title : "",
        source: { kind: "cdp-live", addr: args.addr, port: args.port, target_id: target ? target.id : null, url: args.read },
        visible_messages: msgs,
        final_result: {
          href: args.read,
          title: target && target.title ? target.title : "",
          readyState: "complete",
          msgCount: msgs.length,
          hasPrompt: false,
          isStreaming: false,
          stableRounds: 0,
          hits: [],
          last: outputMsgs.slice(-3).map((m) => ({
            idx: m.idx,
            role: m.role,
            preview: String(m.text || "").slice(0, 120),
            textLen: String(m.text || "").length,
          })),
        },
        stats,
      }));
      stats.ir_written = true;
    }
    if (args.stats) output.stats = stats;
    std.out.puts(JSON.stringify(output, null, 2) + "\n");
  }

  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
