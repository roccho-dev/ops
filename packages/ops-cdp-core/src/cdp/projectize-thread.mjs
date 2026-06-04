// Move (attach) a non-project ChatGPT thread into a Project.
//
// Goal
// - "Non-project thread" URL: https://chatgpt.com/c/<thread>
// - "Project thread" URL:    https://chatgpt.com/g/g-p-<projectId>/c/<thread>
//
// This script automates the UI flow:
// - Open conversation options (…) -> "Move to project" -> pick a project
// - Verify by checking the Project's Chats list for a link containing the thread id.
//
// Runtime: quickjs-ng (qjs) with --std
//
// Example
//   nix shell .#chromium-cdp-tools
//   export HQ_CHROME_ADDR=127.0.0.1 HQ_CHROME_PORT=9223
//   qjs --std -m parts/cdp/projectize-thread.mjs \
//     --threadUrl "https://chatgpt.com/c/<thread>" \
//     --projectId "<projectId>" \
//     --outPath /tmp/projectize.json

import * as std from "./qjs-compat/std.mjs";
import * as os from "./qjs-compat/os.mjs";
import { extractConversationId, extractProjectId, mouseClick, openOrCreateChatGptTarget } from "./chatgpt/index.mjs";
import { requireCdp } from "./connect.mjs";
import {
  cdpCall,
  cdpEvaluate,
  getDefaultAddr,
  getDefaultPort,
  mkCaller,
  parseArgs,
  pollUntil,
  run,
  sleepMs,
} from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m projectize-thread.mjs --threadUrl <.../c/...> (--projectId <id> | --projectUrl <.../g/g-p-.../project>) [--outPath <file>] [--dryRun] [--addr 127.0.0.1] [--port 9222] [--waitMs 800] [--timeoutMs 180000] [--pollMs 250]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      threadUrl: null,
      projectId: null,
      projectUrl: null,
      outPath: null,
      dryRun: false,
      waitMs: 800,
      timeoutMs: 180000,
      pollMs: 250,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      threadUrl: { required: true },
      projectId: {},
      projectUrl: {},
      outPath: {},
      waitMs: { parse: (raw, current) => Number(raw) || current },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
      pollMs: { parse: (raw, current) => Number(raw) || current },
      dryRun: { type: "boolean" },
    },
    onError: "null",
    finalize: (out) => {
      if (!out.projectId && !out.projectUrl) return null;
      return out;
    },
  });
}
function locateConversationOptionsButtonExpr() {
  return `(() => {
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const b = document.querySelector('button[data-testid="conversation-options-button"]');
    if (!b || !isVisible(b)) return { ok: false, reason: 'not_found' };
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
}

function listMenuItemsExpr() {
  return `(() => {
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).filter(isVisible);
    const out = [];
    for (const it of items) {
      const t = String(it.innerText || it.textContent || '').trim();
      if (!t) continue;
      const href = String(it.getAttribute('href') || '');
      const testid = String(it.getAttribute('data-testid') || '');
      const r = it.getBoundingClientRect();
      out.push({
        tag: String(it.tagName || ''),
        text: t,
        href,
        testid,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
      });
    }
    return { ok: true, count: out.length, items: out };
  })()`;
}

function summarizeMenuSnapshot(snapshot) {
  if (!snapshot || !snapshot.ok || !Array.isArray(snapshot.items)) return null;
  const items = snapshot.items;
  const lower = (s) => String(s || "").trim().toLowerCase();
  const out = {
    count: items.length,
    has_move_to_project: false,
    remove_from_text: null,
    texts: [],
  };
  for (const it of items) {
    if (!it) continue;
    const t = String(it.text || "").trim();
    if (!t) continue;
    out.texts.push(t);
    const low = lower(t);
    if (low.includes("move to project") || low === "move to" || low.includes("move to a project") || low.includes("move to another project") || t.includes("プロジェクト")) {
      out.has_move_to_project = true;
    }
    if (!out.remove_from_text) {
      if (low.startsWith("remove from ") || low.includes("remove from project") || low.includes("remove from this project") || t.includes("から削除")) {
        out.remove_from_text = t;
      }
    }
  }
  // Keep a short sample.
  if (out.texts.length > 18) out.texts = out.texts.slice(0, 18);
  return out;
}

function clickMenuItemByHrefExpr(hrefNeedle) {
  const n = JSON.stringify(String(hrefNeedle || ""));
  return `(() => {
    const want = ${n};
    if (!want) return { ok: false, reason: 'missing_href' };
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const items = Array.from(document.querySelectorAll('[role="menuitem"][href], a[role="menuitem"][href]')).filter(isVisible);
    for (const it of items) {
      const href = String(it.getAttribute('href') || '');
      if (!href) continue;
      if (href === want || href.includes(want)) {
        try { it.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
        try { it.click(); } catch (_) {}
        return { ok: true, href };
      }
    }
    return { ok: false, reason: 'not_found', want, count: items.length };
  })()`;
}

function waitHrefIncludes(thread, needle, timeoutMs, pollMs) {
  const want = String(needle || "");
  let last = null;
  try {
    return pollUntil(() => {
      last = thread.evalValue("(() => location.href)()", { timeoutMs: 60000 });
      if (last && want && String(last).includes(want)) {
        return { ok: true, timed_out: false, href: String(last) };
      }
      return null;
    }, { timeoutMs, pollMs, label: `href includes ${want}` });
  } catch {
    return { ok: false, timed_out: true, href: last ? String(last) : "" };
  }
}
function findMenuItem(items, predicate) {
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    if (!it) continue;
    try {
      if (predicate(it)) return it;
    } catch {
      // ignore
    }
  }
  return null;
}

function waitForMenuItem(thread, pred, timeoutMs, pollMs) {
  let last = null;
  try {
    const found = pollUntil(() => {
      last = thread.evalValue(listMenuItemsExpr(), { timeoutMs: 60000 });
      const item = last && last.ok ? findMenuItem(last.items, pred) : null;
      if (item) return { ok: true, timed_out: false, item, snapshot: last };
      return null;
    }, { timeoutMs, pollMs, label: "menu item" });
    return found;
  } catch {
    return { ok: false, timed_out: true, item: null, snapshot: last };
  }
}
function normalizeAbsUrl(href) {
  const h = String(href || "");
  if (!h) return h;
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("/")) return "https://chatgpt.com" + h;
  return h;
}

function projectPageUrl(projectId) {
  const pid = String(projectId || "");
  return pid ? `https://chatgpt.com/g/g-p-${pid}/project` : null;
}

function findThreadLinkInProjectExpr(threadId) {
  const tid = JSON.stringify(String(threadId || ""));
  return `(() => {
    const tid = ${tid};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    // IMPORTANT: restrict to the Project page main area (exclude sidebar chat history).
    const root = document.querySelector('main') || document.body;
    const links = Array.from(root.querySelectorAll('a[href]')).filter(isVisible);
    const hits = [];
    for (const a of links) {
      const href = String(a.getAttribute('href') || '');
      if (!href || !tid) continue;
      if (!href.includes(tid)) continue;
      const t = String(a.innerText || a.textContent || '').trim();
      const r = a.getBoundingClientRect();
      hits.push({
        href,
        text: t.slice(0, 120),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
      });
    }
    // Prefer project-thread links.
    hits.sort((a, b) => {
      const ap = a.href.includes('/g/g-p-') ? 0 : 10;
      const bp = b.href.includes('/g/g-p-') ? 0 : 10;
      return ap - bp;
    });
    return { ok: true, hit_count: hits.length, hits: hits.slice(0, 8) };
  })()`;
}

function scrollSidebarOrMainExpr() {
  // Best-effort scroll to load more entries.
  return `(() => {
    try {
      const el = document.scrollingElement || document.documentElement || document.body;
      if (el) el.scrollTop = el.scrollHeight;
    } catch (_) {}
    try {
      const cands = Array.from(document.querySelectorAll('nav, main, [data-testid*="scroll" i], [class*="scroll" i]'))
        .filter((x) => x && x.scrollHeight && x.clientHeight && x.scrollHeight > x.clientHeight + 8);
      cands.sort((a,b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      const pick = cands[0] || null;
      if (pick) pick.scrollTop = pick.scrollHeight;
    } catch (_) {}
    return true;
  })()`;
}

function waitCurrentPageContainsThreadLink(thread, threadId, timeoutMs, pollMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const poll = Math.max(50, Number(pollMs) || 250);
  let last = null;
  while (Date.now() < deadline) {
    try { thread.evalValue(scrollSidebarOrMainExpr(), { timeoutMs: 60000 }); } catch {}
    sleepMs(250);
    last = thread.evalValue(findThreadLinkInProjectExpr(threadId), { timeoutMs: 60000 });
    if (last && last.ok && last.hit_count > 0) {
      return { ok: true, timed_out: false, found: last };
    }
    sleepMs(poll);
  }
  return { ok: false, timed_out: true, last };
}

function waitProjectContainsThread(conn, args, projectId, threadId) {
  const url = projectPageUrl(projectId);
  if (!url) return { ok: false, reason: "missing_project_url" };
  const { target } = openOrCreateChatGptTarget(conn, url, { purpose: "projectize-thread verify", checkSession: false });
  const page = mkCaller(target.webSocketDebuggerUrl);
  try { page.call("Page.bringToFront", {}); } catch {}
  sleepMs(Math.max(400, args.waitMs));

  // Force refresh: project chat list can be SPA-stale across tabs.
  try { page.call("Page.reload", { ignoreCache: true }, 60000); } catch {}
  sleepMs(2500);

  const deadline = Date.now() + Math.max(0, Number(args.timeoutMs) || 0);
  let last = null;
  while (Date.now() < deadline) {
    try { page.evalValue(scrollSidebarOrMainExpr(), { timeoutMs: 60000 }); } catch {}
    sleepMs(250);
    last = page.evalValue(findThreadLinkInProjectExpr(threadId), { timeoutMs: 60000 });
    if (last && last.ok && last.hit_count > 0) {
      return {
        ok: true,
        projectUrl: url,
        target: { id: target.id, title: target.title, url: target.url },
        found: last,
      };
    }
    sleepMs(Math.max(200, args.pollMs));
  }

  return {
    ok: false,
    timed_out: true,
    projectUrl: url,
    target: { id: target.id, title: target.title, url: target.url },
    last,
  };
}

function main(args) {
  const pid = args.projectId || extractProjectId(args.projectUrl);
  if (!pid) {
    std.err.puts("cannot derive project id; pass --projectId or a valid --projectUrl\n");
    std.err.flush();
    return 2;
  }

  const conn = requireCdp(args.addr, args.port);
  const { target } = openOrCreateChatGptTarget(conn, args.threadUrl, { purpose: "projectize-thread", checkSession: false });
  const thread = mkCaller(target.webSocketDebuggerUrl);
  try { thread.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const beforeHref = thread.evalValue("(() => location.href)()", { timeoutMs: 60000 });
  const beforeProjectId = extractProjectId(beforeHref);
  const threadId = extractConversationId(beforeHref || args.threadUrl);

  const result = {
    ok: false,
    addr: args.addr,
    port: args.port,
    dryRun: !!args.dryRun,
    threadUrl: args.threadUrl,
    before: {
      href: beforeHref,
      target: { id: target.id, title: target.title, url: target.url },
      thread_id: threadId,
      project_id: beforeProjectId,
    },
    desired: {
      project_id: pid,
      project_url: projectPageUrl(pid),
    },
    ui: {
      clicked: [],
      menu_snapshots: [],
      menu_summary: [],
      errors: [],
    },
    verify: null,
    after: null,
  };

  if (!threadId) {
    result.ui.errors.push("thread_id_not_found");
  }

  // If already projected into desired project, just verify.
  if (beforeProjectId && beforeProjectId === pid) {
    result.ui.clicked.push("already_projected");
  } else if (!args.dryRun) {
    // Open conversation options.
    const btn = thread.evalValue(locateConversationOptionsButtonExpr(), { timeoutMs: 60000 });
    if (!btn || !btn.ok) {
      result.ui.errors.push("conversation_options_button_not_found");
    } else {
      mouseClick(thread.call, btn.x, btn.y);
      result.ui.clicked.push("open_options");
      sleepMs(250);

      // Snapshot the top-level menu for debugging.
      const snap0 = thread.evalValue(listMenuItemsExpr(), { timeoutMs: 60000 });
      result.ui.menu_snapshots.push(snap0);
      result.ui.menu_summary.push(summarizeMenuSnapshot(snap0));

      // Wait + click "Move to project".
      const move = waitForMenuItem(thread, (it) => {
        const t = String(it.text || "").trim();
        const low = t.toLowerCase();
        return low.includes("move to project") || low.includes("move to a project") || low.includes("move to another project") || low === "move to" || t.includes("プロジェクト");
      }, 12000, args.pollMs);
      result.ui.menu_snapshots.push(move.snapshot);
      result.ui.menu_summary.push(summarizeMenuSnapshot(move.snapshot));
      if (!move.ok || !move.item) {
        result.ui.errors.push("move_to_project_menuitem_not_found");
      } else {
        mouseClick(thread.call, move.item.x, move.item.y);
        result.ui.clicked.push("click_move_to_project");
        sleepMs(250);

        // Wait + click the desired project in the submenu.
        const proj = waitForMenuItem(thread, (it) => {
          const href = String(it.href || "");
          return href.includes(`/g/g-p-${pid}/project`);
        }, 12000, args.pollMs);
        result.ui.menu_snapshots.push(proj.snapshot);
        result.ui.menu_summary.push(summarizeMenuSnapshot(proj.snapshot));
        if (!proj.ok || !proj.item) {
          result.ui.errors.push("project_menuitem_not_found");
        } else {
          // Clicking the submenu project item should navigate to the project page.
          const clicked = thread.evalValue(clickMenuItemByHrefExpr(proj.item.href), { timeoutMs: 60000 }) || null;
          result.ui.clicked.push("click_project_item");
          result.ui.project_click = clicked;
          // Wait for navigation to the project page (the UI flow completes there).
          result.ui.wait_project_nav = waitHrefIncludes(thread, `/g/g-p-${pid}/project`, 20000, args.pollMs);
          sleepMs(Math.max(800, args.waitMs));
        }
      }
    }
  }

  const afterHref = thread.evalValue("(() => location.href)()", { timeoutMs: 60000 });
  const afterProjectId = extractProjectId(afterHref);
  result.after = {
    href: afterHref,
    thread_id: extractConversationId(afterHref) || threadId,
    project_id: afterProjectId,
  };

  // Verification: check project chat list contains this thread id.
  if (threadId) {
    const cur = result.after && result.after.href ? String(result.after.href) : "";
    if (cur.includes(`/g/g-p-${pid}/project`)) {
      // Prefer verifying on the tab we just navigated to.
      const local = waitCurrentPageContainsThreadLink(thread, threadId, args.timeoutMs, args.pollMs);
      result.verify = local.ok
        ? {
          ok: true,
          projectUrl: cur,
          target: { id: target.id, title: target.title, url: target.url },
          found: local.found,
        }
        : {
          ok: false,
          timed_out: true,
          projectUrl: cur,
          target: { id: target.id, title: target.title, url: target.url },
          last: local.last,
        };
    } else {
      result.verify = waitProjectContainsThread(conn, args, pid, threadId);
    }
  }

  // Best-effort: derive the projected thread URL from verification hits.
  const projectedHref = (() => {
    const hits = result.verify && result.verify.ok && result.verify.found ? result.verify.found.hits : null;
    if (!Array.isArray(hits) || hits.length === 0) return null;
    const pick = hits.find((h) => h && String(h.href || "").includes(`/g/g-p-${pid}/c/`)) || hits[0];
    return pick ? normalizeAbsUrl(pick.href) : null;
  })();
  result.projected_thread_url = projectedHref;

  result.ok = !!(result.verify && result.verify.ok);

  const outText = JSON.stringify(result, null, 2) + "\n";
  std.out.puts(outText);
  std.out.flush();
  if (args.outPath) {
    try { std.writeFile(String(args.outPath), outText); } catch {
      // ignore
    }
  }
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
