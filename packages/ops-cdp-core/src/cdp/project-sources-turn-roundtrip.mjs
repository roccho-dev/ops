// Project Sources roundtrip via "Add to project sources" (CDP/qjs)
//
// What this does
// - Writer thread: ask ChatGPT to emit a 2-line payload (TITLE + TOKEN)
// - Writer thread: click "Add to project sources" on that assistant turn
// - Project page: verify the TITLE appears in Project Sources list
// - Reader thread: ask ChatGPT to read that project source by TITLE and return TOKEN
// - (Optional) remove the source and verify NOT_FOUND
//
// TODO(opencode):
// - Determine the max reliable payload size for turn-promotion. Empirically, very large payloads can fail
//   before promotion (the model never emits the requested content), so the ceiling is model/UI-driven.
// - Tighten token verification. Today we treat "token substring observed" as success; large payload runs
//   have produced "TOKEN:" lines with extra suffix characters, and the reader sometimes echoes them.
// - Add a chunking strategy (multiple sources entries) and/or an alternate path (file upload to Sources)
//   for artifacts that exceed the model's faithful-echo limits.
//
// Runtime: quickjs-ng (qjs) with --std
//
// Example
//   nix shell .#chromium-cdp-tools
//   export HQ_CHROME_ADDR=127.0.0.1 HQ_CHROME_PORT=9222
//   qjs --std -m parts/cdp/project-sources-turn-roundtrip.mjs \
//     --projectUrl "https://chatgpt.com/g/g-p-<project>/project" \
//     --writerUrl  "https://chatgpt.com/g/g-p-<project>/c/<writer>" \
//     --readerUrl  "https://chatgpt.com/g/g-p-<project>/c/<reader>" \
//     --title "TXTROUNDTRIP_20260312T120000Z_abcd" \
//     --outDir /tmp/hq_turn_roundtrip

import * as std from "./qjs-compat/std.mjs";
import { SELECTORS, extractConversationId, keyTap, mouseClick, openOrCreateChatGptTarget } from "./domain/chatgpt/index.mjs";
import { requireCdp } from "./core/connect.mjs";
import { mkdirp } from "./core/io.mjs";
import {
  cdpCall,
  cdpEvaluate,
  getDefaultAddr,
  getDefaultPort,
  mkCaller,
  parseArgs,
  run as runEntry,
  sleepMs,
} from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m project-sources-turn-roundtrip.mjs --projectUrl <.../project> --writerUrl <.../c/...> --readerUrl <.../c/...> --title <id> --outDir <dir> [--token <tok>] [--removeAfter] [--downloadsDir <dir>] [--addr 127.0.0.1] [--port 9222] [--waitMs 600] [--timeoutMs 180000] [--fillerLines 0] [--fillerWidth 120] [--promoteRole assistant|user]\n" +
      "       qjs --std -m project-sources-turn-roundtrip.mjs ... --title <base> --outDir <dir> --sweep [--sweepLines 0,50,100,...] [--sweepStart 0 --sweepStep 50 --sweepMax 2000] [--maxConsecutiveFailures 2] [--sleepBetweenMs 800] [--keepSources]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      projectUrl: null,
      writerUrl: null,
      readerUrl: null,
      title: null,
      token: null,
      outDir: null,
      downloadsDir: null,
      removeAfter: false,
      waitMs: 600,
      timeoutMs: 180000,
      fillerLines: 0,
      fillerWidth: 120,
      promoteRole: "assistant",
      sweep: false,
      sweepLines: null,
      sweepStart: null,
      sweepStep: null,
      sweepMax: null,
      maxConsecutiveFailures: 2,
      sleepBetweenMs: 800,
      keepSources: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      projectUrl: { required: true },
      writerUrl: { required: true },
      readerUrl: { required: true },
      title: { required: true },
      token: {},
      outDir: { required: true },
      downloadsDir: {},
      removeAfter: { type: "boolean" },
      waitMs: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      timeoutMs: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      fillerLines: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      fillerWidth: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      promoteRole: {
        parse: (raw) => {
          const v = String(raw || "").trim().toLowerCase();
          return (v === "assistant" || v === "user") ? v : undefined;
        },
        validate: (value) => value === "assistant" || value === "user",
      },
      sweep: { type: "boolean" },
      sweepLines: { set: (out, value) => { out.sweep = true; out.sweepLines = String(value || ""); } },
      sweepStart: { set: (out, value) => { out.sweep = true; out.sweepStart = Number(value); } },
      sweepStep: { set: (out, value) => { out.sweep = true; out.sweepStep = Number(value); } },
      sweepMax: { set: (out, value) => { out.sweep = true; out.sweepMax = Number(value); } },
      maxConsecutiveFailures: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      sleepBetweenMs: { parse: (raw, current) => Number.isFinite(Number(raw)) ? Number(raw) : current },
      keepSources: { type: "boolean" },
    },
    onError: "null",
    finalize: (out) => {
      if (!out.downloadsDir) {
        const home = String(std.getenv("HOME") || "");
        out.downloadsDir = home ? `${home}/Downloads` : "./Downloads";
      }
      return out;
    },
  });
}
function parseSweepLinesValue(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const parts = s.split(",");
  const nums = [];
  for (const p of parts) {
    const n = Number(String(p).trim());
    if (!Number.isFinite(n)) continue;
    nums.push(Math.max(0, Math.floor(n)));
  }
  const uniq = Array.from(new Set(nums));
  uniq.sort((a, b) => a - b);
  return uniq.length ? uniq : null;
}

function defaultSweepLines() {
  return [0, 25, 50, 100, 200, 350, 500, 700, 900, 1200, 1500, 1800, 2000, 2500, 3000];
}

function buildSweepLines(args) {
  if (args && args.sweepLines) {
    const parsed = parseSweepLinesValue(args.sweepLines);
    if (parsed) return parsed;
  }
  const start = Number.isFinite(args.sweepStart) ? Math.max(0, Math.floor(args.sweepStart)) : null;
  const step = Number.isFinite(args.sweepStep) ? Math.max(1, Math.floor(args.sweepStep)) : null;
  const max = Number.isFinite(args.sweepMax) ? Math.max(0, Math.floor(args.sweepMax)) : null;
  if (start !== null && step !== null && max !== null) {
    const out = [];
    for (let n = start; n <= max; n += step) out.push(n);
    return out;
  }
  return defaultSweepLines();
}

function safeSlug(s) {
  const raw = String(s || "");
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "run";
}

function repeatChar(ch, n) {
  const c = String(ch || "");
  const want = Math.max(0, Number(n) || 0);
  if (!c || want <= 0) return "";
  // Cheap and sufficient for the small widths we use.
  let s = "";
  while (s.length < want) s += c;
  return s.slice(0, want);
}

function buildLargePayload(title, token, fillerLines, fillerWidth) {
  const lines = [];
  lines.push(String(title || ""));
  lines.push("BEGIN_LARGE_PAYLOAD");
  const width = Math.max(40, Math.min(400, Number(fillerWidth) || 120));
  const count = Math.max(0, Math.min(5000, Number(fillerLines) || 0));
  const base = repeatChar("A", width);
  for (let i = 0; i < count; i++) {
    const idx = String(i + 1).padStart(4, "0");
    // Make each line distinct so it is less likely to be auto-collapsed.
    lines.push(`FILL_${idx}:${base}`);
  }
  lines.push("END_LARGE_PAYLOAD");
  // Put token at the end so truncation is detectable.
  lines.push("TOKEN: " + String(token || ""));
  return lines.join("\n");
}

function ensureDir(path) {
  mkdirp(path);
}

function writeOptional(path, data) {
  if (!path) return;
  std.writeFile(path, data);
}

function normalizeProjectSourcesUrl(projectUrl) {
  const u = String(projectUrl || "");
  if (!u) return u;
  if (u.includes("tab=sources")) return u;
  if (u.includes("?")) return u + "&tab=sources";
  return u + "?tab=sources";
}

function makeToken() {
  const t = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*Z$/, "Z");
  const r = Math.floor(Math.random() * 1e9).toString(16);
  return `HQ_TXTROUNDTRIP_${t}_${r}`;
}

function makeMarker(prefix) {
  const p = String(prefix || "HQ_MARK");
  const r = Math.floor(Math.random() * 1e9).toString(16);
  return `${p}_${r}`;
}

function locateComposerExpr() {
  return `(() => {
    const q = (sel, root) => {
      try { return (root || document).querySelector(sel); } catch (_) { return null; }
    };
    const qa = (sel, root) => {
      try { return Array.from((root || document).querySelectorAll(sel)); } catch (_) { return []; }
    };
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const area = (el) => {
      try {
        const r = el.getBoundingClientRect();
        return Math.max(0, r.width) * Math.max(0, r.height);
      } catch (_) {
        return 0;
      }
    };
    const bestVisible = (sels) => {
      for (const s of sels) {
        let best = null;
        let bestArea = 0;
        for (const el of qa(s)) {
          if (!isVisible(el)) continue;
          const a = area(el);
          if (a > bestArea) {
            best = el;
            bestArea = a;
          }
        }
        if (best) return best;
      }
      return null;
    };
    const info = (el) => {
      if (!el) return null;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      const r = el.getBoundingClientRect();
      const tag = String(el.tagName || '');
      return {
        tag,
        id: String(el.id || ''),
        aria: String(el.getAttribute('aria-label') || ''),
        testid: String(el.getAttribute('data-testid') || ''),
        role: String(el.getAttribute('role') || ''),
        disabled: !!el.disabled,
        contentEditable: !!el.isContentEditable,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        visible: isVisible(el),
      };
    };
    const prompt = bestVisible([
      '#prompt-textarea',
      "textarea[data-testid='prompt-textarea']",
      'form textarea',
      'form [contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
    ]);
    const root = prompt && prompt.closest ? (prompt.closest('form') || prompt.closest('main') || prompt.parentElement) : document;
    const send =
      q("button[data-testid='send-button']", root) ||
      q('#composer-submit-button', root) ||
      q('button[type="submit"]', root) ||
      q("button[data-testid='send-button']") ||
      q('#composer-submit-button') ||
      q('button[type="submit"]');
    const stop =
      q("button[data-testid='stop-button']", root) ||
      q("button[data-testid='stop-button']") ||
      q("button[aria-label='Stop generating']") ||
      q("button[aria-label='Stop streaming']") ||
      q("button[aria-label='Stop']") ||
      q("button[aria-label='停止']");
    const valueLen = (() => {
      if (!prompt) return 0;
      const tag = String(prompt.tagName || '').toUpperCase();
      try {
        if (tag === 'TEXTAREA' || tag === 'INPUT') return String(prompt.value || '').length;
        if (prompt.isContentEditable) return String(prompt.innerText || prompt.textContent || '').length;
        return String(prompt.textContent || '').length;
      } catch (_) {
        return 0;
      }
    })();
    return {
      href: (location && location.href) ? location.href : '',
      title: (document && document.title) ? document.title : '',
      readyState: (document && document.readyState) ? document.readyState : '',
      ok: !!prompt,
      value_len: valueLen,
      prompt: info(prompt),
      send: info(send),
      stop: info(stop),
    };
  })()`;
}

function waitForAssistantContainsExpr(needle, timeoutMs) {
  const ms = Number(timeoutMs) || 0;
  const n = JSON.stringify(String(needle || ""));
  return `(() => new Promise((resolve) => {
    const needle = ${n};
    const stopSel = 'button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],button[aria-label="Stop"],button[aria-label="停止"]';
    const assistantSel = '[data-message-author-role="assistant"],[data-testid*="assistant"],[data-role="assistant"]';
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const snapshot = (reason, timedOut) => {
      const stop = !!document.querySelector(stopSel);
      const assistants = Array.from(document.querySelectorAll(assistantSel)).filter(isVisible);
      const last = assistants.length ? assistants[assistants.length - 1] : null;
      const text = last ? String(last.textContent || last.innerText || '') : '';
      const tailMax = 4096;
      const tail = text.length > tailMax ? text.slice(text.length - tailMax) : text;
      return { ok: !timedOut, timed_out: !!timedOut, reason, generating: stop, assistant_count: assistants.length, has: needle ? text.includes(needle) : false, last_tail: tail };
    };
    const done = () => {
      const s = snapshot('check', false);
      return (!s.generating) && s.has;
    };
    if (done()) return resolve(snapshot('already_done', false));
    let finished = false;
    const finish = (timedOut) => {
      if (finished) return;
      finished = true;
      try { mo.disconnect(); } catch (_) {}
      resolve(snapshot(timedOut ? 'timeout' : 'done', timedOut));
    };
    const mo = new MutationObserver(() => { if (done()) finish(false); });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish(true), ${ms});
  }))()`;
}

function assistantSnapshotExpr(needle) {
  const n = JSON.stringify(String(needle || ""));
  return `(() => {
    const needle = ${n};
    const stopSel = 'button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],button[aria-label="Stop"],button[aria-label="停止"]';
    const assistantSel = '[data-message-author-role="assistant"],[data-testid*="assistant"],[data-role="assistant"]';
    const generating = !!document.querySelector(stopSel);
    const assistants = Array.from(document.querySelectorAll(assistantSel));
    let matchText = '';
    let matchIndex = -1;
    for (let i = 0; i < assistants.length; i++) {
      const el = assistants[i];
      const txt = el ? String(el.textContent || el.innerText || '') : '';
      if (needle && txt.includes(needle)) {
        matchText = txt;
        matchIndex = i;
        break;
      }
    }
    const last = assistants.length ? assistants[assistants.length - 1] : null;
    const lastText = last ? String(last.textContent || last.innerText || '') : '';
    const tailMax = 4096;
    const lastTail = lastText.length > tailMax ? lastText.slice(lastText.length - tailMax) : lastText;
    const matchTail = matchText.length > tailMax ? matchText.slice(matchText.length - tailMax) : matchText;
    const has = matchIndex >= 0;
    return { generating, assistant_count: assistants.length, has, match_index: matchIndex, match_tail: matchTail, last_tail: lastTail };
  })()`;
}

function waitForAssistantContains(thread, needle, timeoutMs) {
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = thread.evalValue(assistantSnapshotExpr(needle), { timeoutMs: 60000 }) || null;
    if (last && !last.generating && last.has) {
      return {
        ok: true,
        timed_out: false,
        reason: "done",
        generating: false,
        assistant_count: last.assistant_count,
        has: true,
        match_index: last.match_index,
        match_tail: last.match_tail,
        last_tail: last.last_tail,
      };
    }
    sleepMs(600);
  }
  const generating = !!(last && last.generating);
  return {
    ok: false,
    timed_out: true,
    reason: "timeout",
    generating,
    assistant_count: last ? last.assistant_count : 0,
    has: !!(last && last.has),
    match_index: last ? last.match_index : -1,
    match_tail: last ? last.match_tail : "",
    last_tail: last ? last.last_tail : "",
  };
}

function assistantSnapshotAnyExpr(needles) {
  const arr = JSON.stringify((needles || []).map((s) => String(s || "")));
  return `(() => {
    const needles = ${arr};
    const stopSel = 'button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],button[aria-label="Stop"],button[aria-label="停止"]';
    const assistantSel = '[data-message-author-role="assistant"],[data-testid*="assistant"],[data-role="assistant"]';
    const generating = !!document.querySelector(stopSel);
    const assistants = Array.from(document.querySelectorAll(assistantSel));

    let hit = null;
    let matchText = '';
    let matchIndex = -1;
    for (let i = assistants.length - 1; i >= 0; i--) {
      const el = assistants[i];
      const txt = el ? String(el.textContent || el.innerText || '') : '';
      for (let j = 0; j < needles.length; j++) {
        const n = String(needles[j] || '');
        if (!n) continue;
        if (txt.includes(n)) {
          hit = n;
          matchText = txt;
          matchIndex = i;
          i = -1;
          break;
        }
      }
    }

    const last = assistants.length ? assistants[assistants.length - 1] : null;
    const lastText = last ? String(last.textContent || last.innerText || '') : '';
    const tailMax = 4096;
    const lastTail = lastText.length > tailMax ? lastText.slice(lastText.length - tailMax) : lastText;
    const matchTail = matchText.length > tailMax ? matchText.slice(matchText.length - tailMax) : matchText;
    return { generating, assistant_count: assistants.length, hit, match_index: matchIndex, match_tail: matchTail, last_tail: lastTail };
  })()`;
}

function waitForAssistantAny(thread, needles, timeoutMs) {
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = thread.evalValue(assistantSnapshotAnyExpr(needles), { timeoutMs: 60000 }) || null;
    if (last && !last.generating && last.hit) {
      return {
        ok: true,
        timed_out: false,
        reason: "done",
        generating: false,
        assistant_count: last.assistant_count,
        hit: last.hit,
        match_index: last.match_index,
        match_tail: last.match_tail,
        last_tail: last.last_tail,
      };
    }
    sleepMs(600);
  }
  const generating = !!(last && last.generating);
  return {
    ok: false,
    timed_out: true,
    reason: "timeout",
    generating,
    assistant_count: last ? last.assistant_count : 0,
    hit: last ? last.hit : null,
    match_index: last ? last.match_index : -1,
    match_tail: last ? last.match_tail : "",
    last_tail: last ? last.last_tail : "",
  };
}

function roleSnapshotExpr(role, needle) {
  const r = JSON.stringify(String(role || "assistant"));
  const n = JSON.stringify(String(needle || ""));
  return `(() => {
    const role = ${r};
    const needle = ${n};
    const stopSel = 'button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],button[aria-label="Stop"],button[aria-label="停止"]';
    const sel = '[data-message-author-role="' + role + '"]';
    const generating = !!document.querySelector(stopSel);
    const nodes = Array.from(document.querySelectorAll(sel));

    let matchText = '';
    let matchIndex = -1;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const txt = el ? String(el.textContent || el.innerText || '') : '';
      if (needle && txt.includes(needle)) {
        matchText = txt;
        matchIndex = i;
        break;
      }
    }

    const last = nodes.length ? nodes[nodes.length - 1] : null;
    const lastText = last ? String(last.textContent || last.innerText || '') : '';
    const tailMax = 4096;
    const lastTail = lastText.length > tailMax ? lastText.slice(lastText.length - tailMax) : lastText;
    const matchTail = matchText.length > tailMax ? matchText.slice(matchText.length - tailMax) : matchText;
    const has = matchIndex >= 0;
    return { generating, role, message_count: nodes.length, has, match_index: matchIndex, match_tail: matchTail, last_tail: lastTail };
  })()`;
}

function waitForRoleContains(thread, role, needle, timeoutMs, requireIdle) {
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  const needIdle = requireIdle !== false;
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = thread.evalValue(roleSnapshotExpr(role, needle), { timeoutMs: 60000 }) || null;
    if (last && last.has && (!needIdle || !last.generating)) {
      return {
        ok: true,
        timed_out: false,
        reason: "done",
        generating: !!last.generating,
        role: last.role,
        message_count: last.message_count,
        has: true,
        match_index: last.match_index,
        match_tail: last.match_tail,
        last_tail: last.last_tail,
      };
    }
    sleepMs(600);
  }
  const generating = !!(last && last.generating);
  return {
    ok: false,
    timed_out: true,
    reason: "timeout",
    generating,
    role: String(role || ""),
    message_count: last ? last.message_count : 0,
    has: !!(last && last.has),
    match_index: last ? last.match_index : -1,
    match_tail: last ? last.match_tail : "",
    last_tail: last ? last.last_tail : "",
  };
}

function clickAddToProjectSourcesForTurnExpr(role, token, title, timeoutMs) {
  const rol = JSON.stringify(String(role || "assistant"));
  const tok = JSON.stringify(String(token || ""));
  const ttl = JSON.stringify(String(title || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const role = ${rol};
    const token = ${tok};
    const title = ${ttl};
    const needles = [token, title].filter((s) => !!s);
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const find = () => {
      const sel = '[data-message-author-role="' + role + '"]';
      const nodes = Array.from(document.querySelectorAll(sel));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const el = nodes[i];
        const txt = String(el.textContent || el.innerText || '');
        if (needles.length && !needles.some((n) => txt.includes(n))) continue;
        const art = el.closest('[data-testid^="conversation-turn-"]');
        const btn = art ? art.querySelector('button[data-testid="project-save-turn-action-button"]') : null;
        if (btn) return { art, btn };
      }
      return null;
    };
    const start = Date.now();
    const attempt = () => {
      const hit = find();
      if (!hit) return null;
      const btn = hit.btn;
      try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      const before = String(btn.getAttribute('aria-label') || '');
      try { btn.click(); } catch (_) {}
      return { ok: true, before };
    };
    const already = find();
    if (already) {
      const b = already.btn;
      const aria = String(b.getAttribute('aria-label') || '');
      if (aria.includes('Remove from project sources')) return resolve({ ok: true, already: true, aria });
    }
    const res = attempt();
    if (res && res.ok) {
      // Wait for aria-label to flip.
      const hit = find();
      const btn = hit ? hit.btn : null;
      if (!btn) return resolve({ ok: false, reason: 'button_disappeared' });
      let done = false;
      const finish = (timedOut) => {
        if (done) return;
        done = true;
        try { mo.disconnect(); } catch (_) {}
        const aria = String(btn.getAttribute('aria-label') || '');
        resolve({ ok: !timedOut && aria.includes('Remove from project sources'), timed_out: !!timedOut, aria, waited_ms: Date.now() - start });
      };
      const mo = new MutationObserver(() => {
        const aria = String(btn.getAttribute('aria-label') || '');
        if (aria.includes('Remove from project sources')) finish(false);
      });
      try { mo.observe(btn, { attributes: true, attributeFilter: ['aria-label'] }); } catch (_) {}
      setTimeout(() => finish(true), ${ms});
      return;
    }
     resolve({ ok: false, reason: 'turn_or_button_not_found' });
  }))()`;
}

function clickAddToProjectSourcesForAssistantExpr(token, title, timeoutMs) {
  return clickAddToProjectSourcesForTurnExpr("assistant", token, title, timeoutMs);
}

function clickRemoveFromProjectSourcesForTurnExpr(role, token, title, timeoutMs) {
  const rol = JSON.stringify(String(role || "assistant"));
  const tok = JSON.stringify(String(token || ""));
  const ttl = JSON.stringify(String(title || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const role = ${rol};
    const token = ${tok};
    const title = ${ttl};
    const needles = [token, title].filter((s) => !!s);
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const find = () => {
      const sel = '[data-message-author-role="' + role + '"]';
      const nodes = Array.from(document.querySelectorAll(sel));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const el = nodes[i];
        const txt = String(el.textContent || el.innerText || '');
        if (needles.length && !needles.some((n) => txt.includes(n))) continue;
        const art = el.closest('[data-testid^="conversation-turn-"]');
        const btn = art ? art.querySelector('button[data-testid="project-save-turn-action-button"]') : null;
        if (btn) return { art, btn };
      }
      return null;
    };
    const hit = find();
    if (!hit) return resolve({ ok: false, reason: 'turn_or_button_not_found' });
    const btn = hit.btn;
    try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    const before = String(btn.getAttribute('aria-label') || '');
    if (!before.includes('Remove from project sources')) return resolve({ ok: false, reason: 'not_in_remove_state', before });
    try { btn.click(); } catch (_) {}
    let done = false;
    const start = Date.now();
    const finish = (timedOut) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      const aria = String(btn.getAttribute('aria-label') || '');
      resolve({ ok: !timedOut && aria.includes('Add to project sources'), timed_out: !!timedOut, before, aria, waited_ms: Date.now() - start });
    };
    const mo = new MutationObserver(() => {
      const aria = String(btn.getAttribute('aria-label') || '');
      if (aria.includes('Add to project sources')) finish(false);
    });
    try { mo.observe(btn, { attributes: true, attributeFilter: ['aria-label'] }); } catch (_) {}
    setTimeout(() => finish(true), ${ms});
  }))()`;
}

function clickRemoveFromProjectSourcesForAssistantExpr(token, title, timeoutMs) {
  return clickRemoveFromProjectSourcesForTurnExpr("assistant", token, title, timeoutMs);
}

function waitPageContainsExpr(needle, timeoutMs) {
  const n = JSON.stringify(String(needle || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const needle = ${n};
    const has = () => {
      const t = document.body ? String(document.body.innerText || '') : '';
      return needle ? t.includes(needle) : false;
    };
    if (has()) return resolve(true);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      resolve(!!v);
    };
    const mo = new MutationObserver(() => { if (has()) finish(true); });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish(has()), ${ms});
  }))()`;
}

function findSourceRowActionsExpr(title) {
  const ttl = JSON.stringify(String(title || ""));
  return `(() => {
    const title = ${ttl};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const leaves = Array.from(document.querySelectorAll('*')).filter((el) => isVisible(el) && String(el.innerText || '').trim() === title);
    const leaf = leaves.length ? leaves[0] : null;
    if (!leaf) return { ok: false, reason: 'title_not_found' };
    let cur = leaf;
    for (let i = 0; i < 10 && cur; i++) {
      const btn = cur.querySelector ? Array.from(cur.querySelectorAll('button')).find((b) => String(b.getAttribute('aria-label') || '') === 'Source actions') : null;
      if (btn && isVisible(btn)) {
        const r = btn.getBoundingClientRect();
        return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      }
      cur = cur.parentElement;
    }
    // Fallback: scan page for any Source actions button (dangerous, but better than nothing).
    const any = Array.from(document.querySelectorAll('button')).find((b) => isVisible(b) && String(b.getAttribute('aria-label') || '') === 'Source actions') || null;
    if (!any) return { ok: false, reason: 'actions_not_found' };
    const r = any.getBoundingClientRect();
    return { ok: true, fallback: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
}

function findMenuItemExpr(label) {
  const lbl = JSON.stringify(String(label || ""));
  return `(() => {
    const label = ${lbl};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item]'));
    const hit = items.find((el) => isVisible(el) && String(el.innerText || el.textContent || '').trim() === label) || null;
    if (!hit) return { ok: false };
    const r = hit.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
}

function sendText(thread, text) {
  const waitFor = (ms) => {
    const timeout = Math.max(0, Number(ms) || 0);
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeout) {
      last = thread.evalValue(locateComposerExpr(), { timeoutMs: Math.min(60000, timeout) }) || null;
      // The send button may not render until after typing.
      if (last && last.ok && last.prompt) return last;
      sleepMs(350);
    }
    throw new Error("composer not ready: " + JSON.stringify(last));
  };
  const waitIdle = (ms) => {
    const timeout = Math.max(0, Number(ms) || 0);
    const start = Date.now();
    let last = null;
    let stopClicks = 0;
    let reloaded = false;
    while (Date.now() - start < timeout) {
      last = thread.evalValue(locateComposerExpr(), { timeoutMs: Math.min(60000, timeout) }) || null;
      if (last && last.stop && last.stop.center && last.stop.visible && stopClicks < 3) {
        // If the tab is stuck streaming from a prior run, stop it.
        try {
          mouseClick(thread.call, last.stop.center.x, last.stop.center.y);
          stopClicks++;
        } catch {
          // ignore
        }
        sleepMs(800);
        continue;
      }
      if (last && last.stop && last.stop.visible && stopClicks >= 3 && !reloaded) {
        // If stop won't clear, reload once and retry.
        try {
          thread.call("Page.reload", { ignoreCache: true });
          reloaded = true;
          stopClicks = 0;
        } catch {
          // ignore
        }
        sleepMs(2500);
        continue;
      }
      if (last && !last.stop) return last;
      sleepMs(500);
    }
    throw new Error("page did not become idle: " + JSON.stringify(last));
  };

  const before = waitFor(60000);
  waitIdle(60000);

  mouseClick(thread.call, before.prompt.center.x, before.prompt.center.y);
  sleepMs(50);
  try {
    // Ctrl+A then Backspace.
    keyTap(thread.call, "a", "KeyA", 65, 2);
    keyTap(thread.call, "Backspace", "Backspace", 8, 0);
  } catch {
    // ignore
  }

  const chunkSize = 800;
  for (let i = 0; i < text.length; i += chunkSize) {
    thread.call("Input.insertText", { text: text.slice(i, i + chunkSize) });
  }

  let afterType = thread.evalValue(locateComposerExpr(), { timeoutMs: 60000 });
  if (!afterType || !afterType.send) {
    throw new Error("send button not available: " + JSON.stringify(afterType));
  }
  if (afterType.send.disabled) {
    const start = Date.now();
    let last = afterType;
    while (Date.now() - start < 30000) {
      sleepMs(250);
      last = thread.evalValue(locateComposerExpr(), { timeoutMs: 60000 }) || last;
      if (last && last.send && !last.send.disabled) {
        afterType = last;
        break;
      }
    }
  }
  if (!afterType || !afterType.send || afterType.send.disabled) {
    throw new Error("send button not available: " + JSON.stringify(afterType));
  }
  mouseClick(thread.call, afterType.send.center.x, afterType.send.center.y);
  return { before, afterType };
}

function runRoundtrip(conn, args) {
  ensureDir(args.outDir);

  const token = args.token || makeToken();
  const title = String(args.title);
  const promoteRole = (String(args.promoteRole || "assistant").toLowerCase() === "user") ? "user" : "assistant";
  const writerPayload = (args.fillerLines && args.fillerLines > 0)
    ? buildLargePayload(title, token, args.fillerLines, args.fillerWidth)
    : (title + "\n" + "TOKEN: " + token);
  const writerPrompt = (promoteRole === "user")
    ? writerPayload
    : ((args.fillerLines && args.fillerLines > 0)
      ? ("Reply with EXACTLY the following content (no extra commentary).\n" +
          "Important: the last non-empty line MUST be the TOKEN line.\n\n" +
          writerPayload)
      : ("Reply with EXACTLY the following two lines and nothing else:\n" + writerPayload));

  // Writer thread
  const { target: writerTarget } = openOrCreateChatGptTarget(conn, args.writerUrl, { purpose: "project-sources-turn-roundtrip writer", checkSession: false });
  const writer = mkCaller(writerTarget.webSocketDebuggerUrl);
  try { writer.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const writerSend = sendText(writer, writerPrompt);
  // Wait for the title (first line) on the role we intend to promote.
  const writerWait = waitForRoleContains(writer, promoteRole, title, args.timeoutMs, promoteRole === "assistant");
  const writerTokenProbe = writer.evalValue(roleSnapshotExpr(promoteRole, token), { timeoutMs: 60000 });

  const writerPromote = writer.evalValue(clickAddToProjectSourcesForTurnExpr(promoteRole, token, title, 30000), {
    awaitPromise: true,
    timeoutMs: 40000,
  });

  // Project Sources (best-effort; not required for the core roundtrip)
  const sourcesUrl = normalizeProjectSourcesUrl(args.projectUrl);
  let projectTarget = null;
  let titleSeen = null;
  let projectError = null;
  try {
    projectTarget = openOrCreateChatGptTarget(conn, sourcesUrl, { purpose: "project-sources-turn-roundtrip project", checkSession: false }).target;
    const project = mkCaller(projectTarget.webSocketDebuggerUrl);
    try { project.call("Page.bringToFront", {}); } catch {}
    sleepMs(400);
    titleSeen = project.evalValue(waitPageContainsExpr(title, 30000), { awaitPromise: true, timeoutMs: 40000 });
  } catch (e) {
    projectError = String(e);
  }

  // Reader thread
  const { target: readerTarget } = openOrCreateChatGptTarget(conn, args.readerUrl, { purpose: "project-sources-turn-roundtrip reader", checkSession: false });
  const reader = mkCaller(readerTarget.webSocketDebuggerUrl);
  try { reader.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const readNotFound = makeMarker("HQ_NOT_FOUND");
  const readerPrompt =
    "Project Sources read check.\n\n" +
    `Read the Project source titled \"${title}\" and reply with exactly the TOKEN value (just the token). ` +
    `If it is not accessible, reply exactly: ${readNotFound}`;
  const readerSend = sendText(reader, readerPrompt);
  const readerWait = waitForAssistantAny(reader, [token, readNotFound], args.timeoutMs);

  let removal = null;
  let readerAfterRemoval = null;
  let removedNotFound = null;
  if (args.removeAfter) {
    // Remove via the same writer turn action (does not require sources list visibility).
    try { writer.call("Page.bringToFront", {}); } catch {}
    sleepMs(args.waitMs);
    removal = writer.evalValue(clickRemoveFromProjectSourcesForTurnExpr(promoteRole, token, title, 30000), {
      awaitPromise: true,
      timeoutMs: 40000,
    });

    // Reader re-check
    try { reader.call("Page.bringToFront", {}); } catch {}
    sleepMs(args.waitMs);
    removedNotFound = makeMarker("HQ_NOT_FOUND_REMOVED");
    const prompt2 =
      "Project Sources removal check.\n\n" +
      `Try to read the Project source titled \"${title}\". If it is not accessible, reply exactly: ${removedNotFound}`;
    sendText(reader, prompt2);
    readerAfterRemoval = waitForAssistantContains(reader, removedNotFound, args.timeoutMs);
  }

  const ok =
    !!(writerWait && writerWait.ok && writerWait.has) &&
    !!(writerPromote && writerPromote.ok) &&
    !!(readerWait && readerWait.ok && readerWait.hit === token);

  const result = {
    ok,
    promoteRole,
    projectUrl: args.projectUrl,
    projectSourcesUrl: sourcesUrl,
    writerUrl: args.writerUrl,
    readerUrl: args.readerUrl,
    title,
    token,
    writer: {
      target: { id: writerTarget.id, url: writerTarget.url, title: writerTarget.title },
      send: writerSend,
      waited: writerWait,
      token_probe: writerTokenProbe,
      promote: writerPromote,
    },
    project: projectTarget
      ? { target: { id: projectTarget.id, url: projectTarget.url, title: projectTarget.title }, title_seen: !!titleSeen, error: projectError }
      : { target: null, title_seen: null, error: projectError },
    reader: { target: { id: readerTarget.id, url: readerTarget.url, title: readerTarget.title }, send: readerSend, waited: readerWait },
    reader_not_found_marker: readNotFound,
    removed_not_found_marker: removedNotFound,
    removal,
    reader_after_removal: readerAfterRemoval,
  };

  const slug = safeSlug(title).slice(0, 96);
  writeOptional(`${args.outDir}/turn_roundtrip.${slug}.json`, JSON.stringify(result, null, 2) + "\n");
  writeOptional(`${args.outDir}/turn_roundtrip.json`, JSON.stringify(result, null, 2) + "\n");
  return result;
}

function runSweep(conn, args) {
  ensureDir(args.outDir);
  const startedAt = new Date().toISOString();
  const linesList = buildSweepLines(args);
  const baseTitle = String(args.title || "SWEEP");

  const results = [];
  let consecutiveFailures = 0;
  for (let i = 0; i < linesList.length; i++) {
    const fillerLines = linesList[i];
    const runId = makeToken();
    const token = makeToken();
    const title = `${baseTitle}_L${String(fillerLines).padStart(4, "0")}_W${args.fillerWidth}_ID${runId}`;
    const payload = buildLargePayload(title, token, fillerLines, args.fillerWidth);
    const payloadChars = payload.length;
    const iterArgs = {
      ...args,
      sweep: false,
      token,
      title,
      fillerLines,
      // Keep sources clean by default during sweeps.
      removeAfter: args.keepSources ? false : true,
    };

    let res = null;
    let err = null;
    try {
      res = runRoundtrip(conn, iterArgs);
    } catch (e) {
      err = String(e) + (e && e.stack ? "\n" + String(e.stack) : "");
    }

    const ok = !!(res && res.ok);
    results.push({
      ok,
      fillerLines,
      fillerWidth: args.fillerWidth,
      payloadChars,
      title,
      runId,
      token,
      error: err,
      result: res,
    });

    if (!ok) consecutiveFailures++;
    else consecutiveFailures = 0;

    writeOptional(`${args.outDir}/turn_sweep.json`, JSON.stringify({
      ok: false,
      started_at: startedAt,
      updated_at: new Date().toISOString(),
      base_title: baseTitle,
      config: {
        fillerWidth: args.fillerWidth,
        sweep_lines: linesList,
        waitMs: args.waitMs,
        timeoutMs: args.timeoutMs,
        removeAfter: args.keepSources ? false : true,
        maxConsecutiveFailures: args.maxConsecutiveFailures,
        sleepBetweenMs: args.sleepBetweenMs,
      },
      results,
    }, null, 2) + "\n");

    if (consecutiveFailures >= Math.max(1, args.maxConsecutiveFailures)) break;
    sleepMs(Math.max(0, Number(args.sleepBetweenMs) || 0));
  }

  const bestOk = results.filter((r) => r && r.ok).reduce((m, r) => Math.max(m, r.fillerLines), -1);
  const firstFail = results.find((r) => r && !r.ok);
  const overallOk = results.length > 0 && results.every((r) => r && r.ok);
  const finishedAt = new Date().toISOString();
  const summary = {
    ok: overallOk,
    started_at: startedAt,
    finished_at: finishedAt,
    base_title: baseTitle,
    config: {
      fillerWidth: args.fillerWidth,
      sweep_lines: linesList,
      waitMs: args.waitMs,
      timeoutMs: args.timeoutMs,
      removeAfter: args.keepSources ? false : true,
      maxConsecutiveFailures: args.maxConsecutiveFailures,
      sleepBetweenMs: args.sleepBetweenMs,
    },
    best_ok_fillerLines: bestOk,
    first_fail: firstFail ? { fillerLines: firstFail.fillerLines, title: firstFail.title, error: firstFail.error } : null,
    results,
  };
  writeOptional(`${args.outDir}/turn_sweep_summary.json`, JSON.stringify(summary, null, 2) + "\n");
  writeOptional(`${args.outDir}/turn_sweep.json`, JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

export function main(args) {
  const conn = requireCdp(args.addr, args.port);
  const res = args.sweep ? runSweep(conn, args) : runRoundtrip(conn, args);
  std.out.puts(JSON.stringify(res, null, 2) + "\n");
  std.out.flush();
  return res && res.ok ? 0 : 1;
}

runEntry(scriptArgs, {
  usage,
  buildArgs,
  main,
  formatError: (e) => {
    std.err.puts(String(e) + "\n");
    if (e && e.stack) std.err.puts(String(e.stack) + "\n");
    std.err.flush();
  },
});
