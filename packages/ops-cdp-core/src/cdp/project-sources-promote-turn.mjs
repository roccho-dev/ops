// Promote an assistant turn to Project Sources (Add to project sources).
//
// Why this exists
// - In the "threads as git worktrees" workflow, we want a deterministic way to
//   publish a specific worker answer into the project's shared Sources.
// - This promotes the *turn* (and any file chips attached to that turn) into
//   Project Sources. The file itself does not become a standalone Source row;
//   it remains downloadable from the promoted turn.
//
// Runtime: quickjs-ng (qjs) with --std
//
// Example
//   nix shell .#chromium-cdp-tools
//   qjs --std -m parts/cdp/project-sources-promote-turn.mjs \
//     --url "https://chatgpt.com/g/g-p-<project>/c/<thread>" \
//     --needle "SOURCE_ID: worktree-foo-001" \
//     --port 9223

import * as std from "./qjs-compat/std.mjs";
import * as os from "./qjs-compat/os.mjs";
import { mouseClick, openOrCreateChatGptTarget } from "./domain/chatgpt/index.mjs";
import { requireCdp } from "./core/connect.mjs";
import {
  cdpCall,
  cdpEvaluate,
  getDefaultAddr,
  getDefaultPort,
  mkCaller,
  parseArgs,
  run,
  sleepMs,
} from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m project-sources-promote-turn.mjs --url <thread-url> [--needle <s>] [--latest] [--role assistant|user] [--addr 127.0.0.1] [--port 9222] [--waitMs 800] [--timeoutMs 180000]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      url: null,
      needle: null,
      latest: false,
      role: "assistant",
      waitMs: 800,
      timeoutMs: 180000,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: { required: true },
      needle: {},
      latest: { type: "boolean" },
      role: {
        parse: (raw) => {
          const v = String(raw || "").trim().toLowerCase();
          return (v === "assistant" || v === "user") ? v : undefined;
        },
        validate: (value) => value === "assistant" || value === "user",
      },
      waitMs: { parse: (raw, current) => Number(raw) || current },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
    },
    onError: "null",
    finalize: (out) => {
      if (!out.latest && !out.needle) return null;
      return out;
    },
  });
}
function roleSnapshotExpr(role, needle, latest) {
  const r = JSON.stringify(String(role || "assistant"));
  const n = JSON.stringify(String(needle || ""));
  const l = latest ? "true" : "false";
  return `(() => {
    const role = ${r};
    const needle = ${n};
    const latest = ${l};
    const stopSel = 'button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],button[aria-label="Stop"],button[aria-label="停止"]';
    const generating = !!document.querySelector(stopSel);
    const turns = Array.from(document.querySelectorAll('[data-message-author-role]')).filter((el) => String(el.getAttribute('data-message-author-role') || '') === role);

    let matchText = '';
    for (let i = turns.length - 1; i >= 0; i--) {
      const el = turns[i];
      const txt = el ? String(el.textContent || el.innerText || '') : '';
      if (latest) {
        if (txt && txt.trim().length) { matchText = txt; break; }
      } else {
        if (needle && txt.includes(needle)) { matchText = txt; break; }
      }
    }

    const tailMax = 4096;
    const tail = matchText.length > tailMax ? matchText.slice(matchText.length - tailMax) : matchText;
    const has = latest ? !!matchText : (needle ? matchText.includes(needle) : false);
    return { generating, role, turn_count: turns.length, has, match_tail: tail };
  })()`;
}

function waitForRole(thread, role, needle, latest, timeoutMs) {
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = thread.evalValue(roleSnapshotExpr(role, needle, latest), { timeoutMs: 60000 }) || null;
    if (last && !last.generating && last.has) return { ok: true, timed_out: false, last };
    sleepMs(700);
  }
  return { ok: false, timed_out: true, last };
}

function clickPromoteTurnExpr(role, needle, latest, timeoutMs) {
  const r = JSON.stringify(String(role || "assistant"));
  const n = JSON.stringify(String(needle || ""));
  const l = latest ? "true" : "false";
  const ms = Math.max(0, Number(timeoutMs) || 0);
  return `(() => new Promise((resolve) => {
    const role = ${r};
    const needle = ${n};
    const latest = ${l};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const turns = Array.from(document.querySelectorAll('[data-message-author-role]')).filter((el) => String(el.getAttribute('data-message-author-role') || '') === role);
    const pickTurn = () => {
      for (let i = turns.length - 1; i >= 0; i--) {
        const el = turns[i];
        const txt = String(el && (el.textContent || el.innerText || '') || '');
        if (latest) {
          if (txt.trim().length) return el;
        } else {
          if (needle && txt.includes(needle)) return el;
        }
      }
      return null;
    };
    const a = pickTurn();
    if (!a) return resolve({ ok: false, reason: 'turn_not_found', role });
    const turn = a.closest('[data-testid^="conversation-turn-"]');
    const btn = turn ? turn.querySelector('button[data-testid="project-save-turn-action-button"]') : null;
    if (!btn) return resolve({ ok: false, reason: 'promote_button_not_found' });
    const aria0 = String(btn.getAttribute('aria-label') || '');
    if (aria0.includes('Remove from project sources')) {
      return resolve({ ok: true, already: true, aria: aria0, turn_testid: turn ? String(turn.getAttribute('data-testid') || '') : '' });
    }

    // Collect file chips visible in the same turn.
    const chips = [];
    if (turn) {
      const btns = Array.from(turn.querySelectorAll('button')).filter(isVisible);
      for (const b of btns) {
        const t = String(b.innerText || '').trim();
        if (!t) continue;
        if (t.length > 180) continue;
        if (!t.includes('.')) continue;
        // Heuristic: typical artifact extensions.
        const low = t.toLowerCase();
        if (!(low.endsWith('.txt') || low.endsWith('.diff') || low.endsWith('.patch') || low.endsWith('.zip') || low.endsWith('.json') || low.endsWith('.md'))) continue;
        chips.push(t);
      }
    }

    try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    try { btn.click(); } catch (_) {}

    let done = false;
    const start = Date.now();
    const finish = (timedOut) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      const aria = String(btn.getAttribute('aria-label') || '');
      resolve({
        ok: !timedOut && aria.includes('Remove from project sources'),
        timed_out: !!timedOut,
        waited_ms: Date.now() - start,
        aria,
        aria_before: aria0,
        turn_testid: turn ? String(turn.getAttribute('data-testid') || '') : '',
        file_chips: chips,
      });
    };

    const mo = new MutationObserver(() => {
      const aria = String(btn.getAttribute('aria-label') || '');
      if (aria.includes('Remove from project sources')) finish(false);
    });
    try { mo.observe(btn, { attributes: true, attributeFilter: ['aria-label'] }); } catch (_) {}
    setTimeout(() => finish(true), ${ms});
  }))()`;
}

function main(args) {
  const conn = requireCdp(args.addr, args.port);
  const { target } = openOrCreateChatGptTarget(conn, args.url, { purpose: "project-sources-promote-turn", checkSession: false });
  const thread = mkCaller(target.webSocketDebuggerUrl);
  try { thread.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const waited = waitForRole(thread, args.role, args.needle, args.latest, args.timeoutMs);
  const promote = thread.evalValue(clickPromoteTurnExpr(args.role, args.needle, args.latest, 60000), {
    awaitPromise: true,
    timeoutMs: 70000,
  });

  const ok = !!(waited && waited.ok) && !!(promote && promote.ok);
  const result = {
    ok,
    addr: args.addr,
    port: args.port,
    url: args.url,
    needle: args.needle,
    latest: !!args.latest,
    role: args.role,
    target: { id: target.id, title: target.title, url: target.url },
    waited,
    promote,
  };

  std.out.puts(JSON.stringify(result, null, 2) + "\n");
  std.out.flush();
  return ok ? 0 : 1;
}

run(scriptArgs, {
  usage,
  buildArgs,
  main,
  formatError: (e) => {
    std.err.puts(String(e) + "\n");
    if (e && e.stack) std.err.puts(String(e.stack) + "\n");
    std.err.flush();
  },
});
