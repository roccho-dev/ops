// Read a ChatGPT thread (or any page) via CDP, without jq/node.
// Fixed version: resolves truncation issues with streaming responses.
//
// Key fixes:
// 1. Stability polling: call CDP multiple times until message text is stable
// 2. Full text capture: no truncation for last N messages
// 3. Stop button detection: wait for streaming to complete
//
// Usage:
//   nix shell .#chromium-cdp-tools
//   qjs --std -m read-thread.mjs \
//     --url "https://chatgpt.com/c/<thread>" --tail 5 --waitMs 30000

import * as std from "./core/std.mjs";
import { listDownloadArtifactsExpr, openOrCreateChatGptTarget, requireChatGptTarget } from "./domain/chatgpt/index.mjs";
import { isFreshIr, loadIr, materializeThreadIr, projectReadThreadResultFromIr, saveIr } from "./domain/chatgpt/ir.mjs";
import { requireCdp } from "./core/connect.mjs";
import { requireRecommendedSession } from "./domain/session-flow.mjs";
import {
  cdpCall,
  cdpEvaluate,
  getDefaultAddr,
  getDefaultPort,
  parseArgs,
  run,
  sleepMs,
} from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m read-thread.mjs --url <url> [--id <targetId>] [--addr 127.0.0.1] [--port 9222] [--waitMs 30000] [--pollMs 2000] [--tail 5] [--markers m1,m2] [--stabilityRounds 3] [--openIfNeeded]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      url: null,
      id: null,
      waitMs: 30000,
      pollMs: 2000,
      tail: 5,
      markers: [],
      stabilityRounds: 3,
      irPath: null,
      preferIr: false,
      refresh: false,
      maxAgeSec: 14400,
      stats: false,
      openIfNeeded: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: { required: true },
      id: {},
      waitMs: { parse: (raw, current) => Number(raw) || current },
      pollMs: { parse: (raw, current) => Number(raw) || current },
      tail: { parse: (raw, current) => Number(raw) || current },
      stabilityRounds: { parse: (raw, current) => Number(raw) || current },
      markers: {
        parse: (raw) => String(raw || "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length),
      },
      irPath: {},
      preferIr: { type: "boolean" },
      refresh: { type: "boolean" },
      maxAgeSec: { parse: (raw, current) => Number(raw) || current },
      stats: { type: "boolean" },
      openIfNeeded: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}
// Simple expression to get message count and basic info
function buildSimpleExpr() {
  return `(() => {
    const nodes = Array.from(document.querySelectorAll("main [data-message-author-role]"));
    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      msgCount: nodes.length,
      hasPrompt: !!document.querySelector("#prompt-textarea"),
      isStreaming: !!(document.querySelector("[data-testid='stop-button']")),
    };
  })()`;
}

function buildArtifactsExpr() {
  return listDownloadArtifactsExpr();
}

// Full expression for getting messages with FULL text (no truncation)
function buildFullExpr(markers, tail) {
  const markersJson = JSON.stringify(markers);
  const tailN = Math.max(1, Number(tail) || 5);

  return `(() => {
    const markers = ${markersJson};
    const tailN = ${tailN};

    const nodes = Array.from(document.querySelectorAll("main [data-message-author-role]"));
    const msgs = nodes.map((n, i) => ({
      idx: i,
      role: n.getAttribute("data-message-author-role") || "",
      text: (n.innerText || "").trim(),
    })).filter((m) => m.text.length > 0);

    const hits = [];
    for (const marker of markers) {
      for (const m of msgs.filter((x) => x.text.includes(marker))) {
        hits.push({
          marker,
          idx: m.idx,
          role: m.role,
          preview: m.text.slice(0, 500).replace(/\\n/g, " "),
          textLen: m.text.length,
        });
      }
    }

    // FULL text, no truncation
    const last = msgs.slice(-tailN).map((m) => ({
      idx: m.idx,
      role: m.role,
      preview: m.text.replace(/\\n/g, " "),
      textLen: m.text.length,
    }));

    return { msgs, hits, last };
  })()`;
}

function buildStats() {
  return {
    ir_hit: false,
    ir_written: false,
    cdp: {
      list_count: 0,
      call_count: 0,
      evaluate_count: 0,
      navigate_count: 0,
    },
  };
}

function withStats(stats) {
  return {
    call(wsUrl, req, timeoutMs) {
      stats.cdp.call_count += 1;
      return cdpCall(wsUrl, req, timeoutMs);
    },
    evaluate(wsUrl, expression, opts) {
      stats.cdp.evaluate_count += 1;
      return cdpEvaluate(wsUrl, expression, opts);
    },
  };
}

function maybeLoadIr(args, stats) {
  if (!args.irPath || !args.preferIr || args.refresh) return null;
  try {
    const doc = loadIr(args.irPath);
    if (!doc) return null;
    if (!isFreshIr(doc, { maxAgeSec: args.maxAgeSec })) return null;
    stats.ir_hit = true;
    return doc;
  } catch {
    return null;
  }
}

function main(args) {
  const stats = buildStats();
  const irDoc = maybeLoadIr(args, stats);
  if (irDoc) {
    const fromIr = projectReadThreadResultFromIr(irDoc);
    const output = args.stats ? { ...fromIr, stats } : fromIr;
    std.out.puts(JSON.stringify(output, null, 2) + "\n");
    std.out.flush();
    return 0;
  }

  const conn = args.openIfNeeded
    ? requireRecommendedSession({ addr: args.addr, port: args.port, app: "chatgpt" })
    : requireCdp(args.addr, args.port);
  stats.cdp.list_count += 1;
  const { target, wsUrl } = args.openIfNeeded
    ? openOrCreateChatGptTarget(conn, args.url, { purpose: "read-thread" })
    : requireChatGptTarget(conn, { url: args.url, id: args.id }, { purpose: "read-thread" });
  const ops = withStats(stats);

  // Best-effort: activate.
  try {
    ops.call(wsUrl, { id: 10, method: "Page.bringToFront", params: {} }, 30000);
  } catch {
    // ignore
  }

  const timeoutMs = Math.max(30000, Number(args.waitMs) + 30000);
  const pollMs = Math.max(1000, Number(args.pollMs) || 2000);
  const waitMs = Math.max(0, Number(args.waitMs) || 30000);
  const deadline = Date.now() + waitMs;
  const stabilityRounds = Math.max(1, Number(args.stabilityRounds) || 3);
  const maxStreamingRounds = Math.max(1, Math.ceil(waitMs / pollMs));

  // Phase 1: Wait for streaming to complete AND for messages to appear
  let isStreaming = true;
  let msgCount = 0;
  let round = 0;
  let streamWaitRounds = 0;
  while ((isStreaming || msgCount === 0) && streamWaitRounds < maxStreamingRounds && Date.now() < deadline) {
    const simple = ops.evaluate(wsUrl, buildSimpleExpr(), {
      id: 1,
      returnByValue: true,
      awaitPromise: false,
      timeoutMs,
    });
    const val = simple?.result?.result?.value;
    isStreaming = val?.isStreaming;
    msgCount = val?.msgCount || 0;
    if (isStreaming || msgCount === 0) {
      sleepMs(pollMs);
    }
    streamWaitRounds++;
  }

  // Phase 2: Stability polling - get messages multiple times until stable
  let lastResult = null;
  let stableCount = 0;
  round = 0;

  while (round < stabilityRounds && Date.now() < deadline) {
    const full = ops.evaluate(wsUrl, buildFullExpr(args.markers, args.tail), {
      id: 2,
      returnByValue: true,
      awaitPromise: false,
      timeoutMs,
    });
    const val = full?.result?.result?.value;

    if (val && val.msgs && val.msgs.length > 0) {
      const currentLast = val.msgs[val.msgs.length - 1];
      const prevLast = lastResult?.msgs?.[lastResult.msgs.length - 1];

      if (prevLast && currentLast.text === prevLast.text) {
        stableCount++;
        if (stableCount >= 2) {
          lastResult = val;
          break;
        }
      } else {
        stableCount = 0;
      }
      lastResult = val;
    }

    if (round < stabilityRounds - 1) {
      sleepMs(pollMs);
    }
    round++;
  }

  // Fallback: if lastResult is still null, do one direct buildFullExpr call
  if (!lastResult) {
    const full = ops.evaluate(wsUrl, buildFullExpr(args.markers, args.tail), {
      id: 4,
      returnByValue: true,
      awaitPromise: false,
      timeoutMs,
    });
    const val = full?.result?.result?.value;
    if (val && val.msgs && val.msgs.length > 0) {
      lastResult = val;
    }
  }

  // Build final result
  const simple = ops.evaluate(wsUrl, buildSimpleExpr(), {
    id: 3,
    returnByValue: true,
    awaitPromise: false,
    timeoutMs,
  });
  const simpleVal = simple?.result?.result?.value || {};

  const finalResult = {
    href: simpleVal.href || lastResult?.msgs?.[0]?.text || "",
    title: simpleVal.title || "",
    readyState: simpleVal.readyState || "",
    msgCount: lastResult?.msgs?.length || 0,
    hasPrompt: simpleVal.hasPrompt || false,
    isStreaming: simpleVal.isStreaming || false,
    stableRounds: round,
    streamWaitRounds,
    hits: lastResult?.hits || [],
    last: lastResult?.last || [],
  };
  const artifactsResult = ops.evaluate(wsUrl, buildArtifactsExpr(), {
    id: 5,
    returnByValue: true,
    awaitPromise: false,
    timeoutMs,
  });
  const artifacts = Array.isArray(artifactsResult?.result?.result?.value?.artifacts)
    ? artifactsResult.result.result.value.artifacts
    : [];

  if (args.irPath) {
    const visibleMessages = Array.isArray(lastResult?.msgs) ? lastResult.msgs : [];
    const doc = materializeThreadIr({
      captured_at: new Date().toISOString(),
      url: args.url,
      title: finalResult.title,
      source: {
        kind: "cdp-live",
        addr: args.addr,
        port: args.port,
        target_id: target && target.id ? String(target.id) : null,
      },
      visible_messages: visibleMessages,
      artifacts,
      final_result: finalResult,
      stats,
    });
    saveIr(args.irPath, doc);
    stats.ir_written = true;
  }

  const baseOutput = { ...finalResult, artifacts };
  const output = args.stats ? { ...baseOutput, stats } : baseOutput;
  std.out.puts(JSON.stringify(output, null, 2) + "\n");
  std.out.flush();
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
