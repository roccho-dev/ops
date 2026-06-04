// List Projects + Threads (unprojected/projected) via CDP/qjs.
//
// Output
// - Markdown tables to stdout (easy to paste into reports)
// - Optional JSON + Markdown files to --outDir
//
// Runtime: quickjs-ng (qjs) with --std
//
// Example
//   nix shell .#chromium-cdp-tools
//   export HQ_CHROME_ADDR=127.0.0.1 HQ_CHROME_PORT=9223
//   chromium-cdp "https://chatgpt.com" &
//   qjs --std -m parts/cdp/project-inventory.mjs \
//     --url "https://chatgpt.com/" \
//     --outDir /tmp/hq_project_inventory

import * as std from "./qjs-compat/std.mjs";
import { extractConversationId, extractProjectId, openOrCreateChatGptTarget, scrollToBottomExpr } from "./chatgpt/index.mjs";
import { isFreshIr, loadIr, materializeInventoryIr, projectInventoryFromIr, saveIr } from "./chatgpt/ir.mjs";
import { requireCdp } from "./connect.mjs";
import { joinPath, mkdirp } from "./fs.mjs";
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
    "usage: qjs --std -m project-inventory.mjs [--url <https://chatgpt.com/>] [--outDir <dir>] [--limitProjects 50] [--limitUnprojected 40] [--limitProjected 40] [--baseScrollRounds 6] [--projectScrollRounds 10] [--scrollDelayMs 250] [--debug] [--addr 127.0.0.1] [--port 9222] [--waitMs 800] [--timeoutMs 60000]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      url: "https://chatgpt.com/",
      outDir: null,
      limitProjects: 50,
      limitUnprojected: 40,
      limitProjected: 40,
      baseScrollRounds: 6,
      projectScrollRounds: 10,
      scrollDelayMs: 250,
      debug: false,
      waitMs: 800,
      timeoutMs: 60000,
      irPath: null,
      preferIr: false,
      refresh: false,
      maxAgeSec: 0,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: {},
      outDir: {},
      limitProjects: { parse: (raw, current) => Number(raw) || current },
      limitUnprojected: { parse: (raw, current) => Number(raw) || current },
      limitProjected: { parse: (raw, current) => Number(raw) || current },
      baseScrollRounds: { parse: (raw, current) => Number(raw) || current },
      projectScrollRounds: { parse: (raw, current) => Number(raw) || current },
      scrollDelayMs: { parse: (raw, current) => Number(raw) || current },
      debug: { type: "boolean" },
      waitMs: { parse: (raw, current) => Number(raw) || current },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
      irPath: {},
      preferIr: { type: "boolean" },
      refresh: { type: "boolean" },
      maxAgeSec: { parse: (raw, current) => Number(raw) || current },
    },
    onError: "null",
    finalize: (out) => {
      out.limitProjects = Math.max(1, Math.min(200, Math.floor(out.limitProjects || 50)));
      out.limitUnprojected = Math.max(1, Math.min(200, Math.floor(out.limitUnprojected || 40)));
      out.limitProjected = Math.max(1, Math.min(400, Math.floor(out.limitProjected || 40)));
      out.baseScrollRounds = Math.max(0, Math.min(60, Math.floor(out.baseScrollRounds || 0)));
      out.projectScrollRounds = Math.max(0, Math.min(120, Math.floor(out.projectScrollRounds || 0)));
      out.scrollDelayMs = Math.max(0, Math.min(5000, Math.floor(out.scrollDelayMs || 0)));
      out.waitMs = Math.max(0, Math.floor(out.waitMs || 0));
      out.timeoutMs = Math.max(1000, Math.floor(out.timeoutMs || 0));
      if (!out.url) out.url = "https://chatgpt.com/";
      return out;
    },
  });
}
function ensureDir(path) {
  if (!path) return;
  mkdirp(path);
}

function writeOptional(path, data) {
  if (!path) return;
  std.writeFile(path, data);
}

function normalizeAbsUrl(href) {
  const h = String(href || "");
  if (!h) return h;
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("/")) return "https://chatgpt.com" + h;
  return h;
}

function ensureSidebarOpenExpr() {
  return `(() => {
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const close = document.querySelector('button[data-testid="close-sidebar-button"]');
    if (close && isVisible(close)) return { ok: true, already_open: true };
    const open = document.querySelector('button[aria-label="Open sidebar"],button[aria-label="サイドバーを開く"],button[aria-label="Open navigation"],button[aria-label="Open"]');
    if (!open || !isVisible(open)) return { ok: false, reason: 'open_sidebar_button_not_found' };
    try { open.click(); } catch (_) {}
    return { ok: true, already_open: false };
  })()`;
}

function ensureProjectChatsTabExpr() {
  return `(() => {
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const tabs = Array.from(document.querySelectorAll('button[role="tab"]')).filter(isVisible);
    const chats = tabs.find((b) => String(b.innerText || '').trim() === 'Chats') || null;
    const sources = tabs.find((b) => String(b.innerText || '').trim() === 'Sources') || null;
    if (!chats) return { ok: false, reason: 'chats_tab_not_found', has_sources: !!sources };
    const selected = String(chats.getAttribute('aria-selected') || '') === 'true';
    if (!selected) {
      try { chats.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      try { chats.click(); } catch (_) {}
    }
    return { ok: true, selected_before: selected, has_sources: !!sources };
  })()`;
}

function listProjectsAndUnprojectedExpr(limitProjects, limitUnprojected) {
  const lp = Math.max(1, Math.min(200, Number(limitProjects) || 50));
  const lu = Math.max(1, Math.min(200, Number(limitUnprojected) || 40));
  return `(() => {
    const limitProjects = ${lp};
    const limitUnprojected = ${lu};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const norm = (s) => String(s || '').trim();

    const nav = document.querySelector('nav') || document.body;
    const links = Array.from(nav.querySelectorAll('a[href]')).filter(isVisible);

    const projects = [];
    const projSeen = new Set();
    const unproj = [];
    const threadSeen = new Set();

    for (const a of links) {
      const href = String(a.getAttribute('href') || '');
      const text = norm(a.innerText || a.textContent);
      if (!href) continue;

      // Projects
      if (href.includes('/g/g-p-') && href.includes('/project')) {
        const m = href.match(/\\/g\\/g-p-([^/]+)/);
        const pid = m ? String(m[1] || '') : '';
        if (pid && !projSeen.has(pid) && text) {
          projSeen.add(pid);
          projects.push({ project_id: pid, name: text.slice(0, 120), href });
          if (projects.length >= limitProjects) {
            // keep scanning for unprojected threads
          }
        }
        continue;
      }

      // Unprojected threads
      if (href.startsWith('/c/') && !href.includes('/g/g-p-')) {
        const m = href.match(/\\/c\\/([0-9a-fA-F-]{16,})/);
        const tid = m ? String(m[1] || '') : '';
        if (tid && !threadSeen.has(tid) && text) {
          threadSeen.add(tid);
          // The link often includes multiple lines; keep first non-empty line.
          const lines = text.split('\\n').map((s) => norm(s)).filter((s) => s.length);
          const title = lines.length ? lines[0] : text;
          unproj.push({ thread_id: tid, title: title.slice(0, 160), href });
          if (unproj.length >= limitUnprojected) {
            // continue; allow projects scan to finish
          }
        }
      }
    }

    return {
      ok: true,
      href: location.href,
      title: document.title,
      projects: projects.slice(0, limitProjects),
      unprojected_threads: unproj.slice(0, limitUnprojected),
    };
  })()`;
}

function listProjectedThreadsExpr(projectId, limitProjected) {
  const pid = JSON.stringify(String(projectId || ""));
  const lim = Math.max(1, Math.min(400, Number(limitProjected) || 40));
  return `(() => {
    const projectId = ${pid};
    const limit = ${lim};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const norm = (s) => String(s || '').trim();

    // Project chat links are sometimes rendered in the sidebar (nav) rather than main.
    // We restrict by URL pattern '/g/g-p-<projectId>/c/<thread>' so scanning the whole
    // document is still safe.
    const links = Array.from(document.querySelectorAll('a[href]')).filter(isVisible);
    const out = [];
    const seen = new Set();

    for (const a of links) {
      const href = String(a.getAttribute('href') || '');
      if (!href) continue;
      // Restrict to project chat links.
      if (projectId && !href.includes('/g/g-p-' + projectId + '/c/')) continue;

      const m = href.match(/\\/c\\/([0-9a-fA-F-]{16,})/);
      const tid = m ? String(m[1] || '') : '';
      if (!tid || seen.has(tid)) continue;

      const text = norm(a.innerText || a.textContent);
      if (!text) continue;
      const lines = text.split('\\n').map((s) => norm(s)).filter((s) => s.length);
      const title = lines.length ? lines[0] : text;
      const date = lines.length >= 2 ? lines[lines.length - 1] : '';

      seen.add(tid);
      out.push({ thread_id: tid, title: title.slice(0, 160), date: date.slice(0, 60), href });
      if (out.length >= limit) break;
    }

    return { ok: true, project_id: projectId, threads: out };
  })()`;
}

function mergeByThreadId(rows, more) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  const seen = new Set(out.map((r) => String(r && r.thread_id || "")).filter((x) => x));
  for (const r of (Array.isArray(more) ? more : [])) {
    if (!r) continue;
    const tid = String(r.thread_id || "");
    if (!tid || seen.has(tid)) continue;
    seen.add(tid);
    out.push(r);
  }
  return out;
}

function mdEscape(s) {
  return String(s || "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderMarkdown(inv) {
  const lines = [];
  lines.push("PROJECT_INVENTORY");
  lines.push("");
  lines.push(`CDP: ${inv.addr}:${inv.port}`);
  lines.push(`Timestamp (UTC): ${inv.ts_utc}`);
  lines.push("");

  lines.push("PROJECTS");
  lines.push("| name | project_id | url |");
  lines.push("|---|---|---|");
  for (const p of inv.projects) {
    lines.push(`| ${mdEscape(p.name)} | ${mdEscape(p.project_id)} | ${mdEscape(p.url)} |`);
  }
  lines.push("");

  lines.push("THREADS_UNPROJECTED");
  lines.push("| idx | title | thread_id | url |");
  lines.push("|---:|---|---|---|");
  for (let i = 0; i < inv.unprojected_threads.length; i++) {
    const t = inv.unprojected_threads[i];
    lines.push(`| ${i + 1} | ${mdEscape(t.title)} | ${mdEscape(t.thread_id)} | ${mdEscape(t.url)} |`);
  }
  lines.push("");

  for (const p of inv.projects) {
    const key = p.project_id;
    const rows = inv.projected_threads[key] || [];
    lines.push(`THREADS_PROJECTED: ${p.name} (${p.project_id})`);
    lines.push("| idx | title | thread_id | date | url |");
    lines.push("|---:|---|---|---|---|");
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i];
      lines.push(`| ${i + 1} | ${mdEscape(t.title)} | ${mdEscape(t.thread_id)} | ${mdEscape(t.date || "")} | ${mdEscape(t.url)} |`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function main(args) {
  if (args.outDir) ensureDir(args.outDir);

  if (args.irPath && args.preferIr && !args.refresh) {
    try {
      const existing = loadIr(args.irPath);
      if (existing && isFreshIr(existing, { maxAgeSec: args.maxAgeSec })) {
        const inv = projectInventoryFromIr(existing);
        const md = renderMarkdown(inv);
        std.out.puts(md);
        std.out.flush();
        if (args.outDir) {
          writeOptional(joinPath(args.outDir, "PROJECT_INVENTORY.md"), md);
          writeOptional(joinPath(args.outDir, "PROJECT_INVENTORY.json"), JSON.stringify(inv, null, 2) + "\n");
        }
        return 0;
      }
    } catch (_) {}
  }

  const conn = requireCdp(args.addr, args.port);

  const { target: baseTarget } = openOrCreateChatGptTarget(conn, args.url, { purpose: "project-inventory base", checkSession: false });
  const base = mkCaller(baseTarget.webSocketDebuggerUrl);
  try { base.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  // Ensure sidebar is expanded so Projects/Chats are in DOM.
  base.evalValue(ensureSidebarOpenExpr(), { timeoutMs: 60000 });
  sleepMs(250);

  let baseListingDetails = null;
  let baseListing = null;
  let projects = [];
  let unprojected = [];
  let prevCounts = { p: 0, u: 0 };
  for (let round = 0; round <= args.baseScrollRounds; round++) {
    baseListingDetails = base.evalDetailed(listProjectsAndUnprojectedExpr(args.limitProjects, args.limitUnprojected), { timeoutMs: 60000 });
    baseListing = baseListingDetails.hasValue ? baseListingDetails.value : null;
    projects = (baseListing && baseListing.ok && Array.isArray(baseListing.projects)) ? baseListing.projects : [];
    unprojected = (baseListing && baseListing.ok && Array.isArray(baseListing.unprojected_threads)) ? baseListing.unprojected_threads : [];

    const reached = (projects.length >= args.limitProjects) && (unprojected.length >= args.limitUnprojected);
    const stuck = (projects.length === prevCounts.p) && (unprojected.length === prevCounts.u);
    prevCounts = { p: projects.length, u: unprojected.length };
    if (reached || stuck || round === args.baseScrollRounds) break;

    // Sidebar/chat history can be virtualized; scroll nav down to load more.
    try { base.evalValue(scrollToBottomExpr('nav'), { timeoutMs: 60000 }); } catch {}
    sleepMs(Math.max(0, args.scrollDelayMs));
  }

  const projectedByProjectId = {};
  const projectedDebugByProjectId = {};
  for (const p of projects) {
    const pid = p && p.project_id ? String(p.project_id) : "";
    if (!pid) continue;
    const url = normalizeAbsUrl(p.href);
    const { target: t } = openOrCreateChatGptTarget(conn, url, { purpose: "project-inventory project", checkSession: false });
    const page = mkCaller(t.webSocketDebuggerUrl);
    try { page.call("Page.bringToFront", {}); } catch {}
    sleepMs(Math.max(400, args.waitMs));

    // Some project tabs are left on "Sources" or another view; reselect Chats first.
    try {
      page.evalValue(ensureProjectChatsTabExpr(), { timeoutMs: 60000 });
      sleepMs(Math.max(600, args.waitMs));
    } catch {}

    // Project chat lists can be virtualized; scroll main to accumulate.
    let listingDetails = null;
    let listing = null;
    let threads = [];
    let prevLen = 0;
    for (let round = 0; round <= args.projectScrollRounds; round++) {
      listingDetails = page.evalDetailed(listProjectedThreadsExpr(pid, args.limitProjected), { timeoutMs: 60000 });
      listing = listingDetails.hasValue ? listingDetails.value : null;
      const more = (listing && listing.ok && Array.isArray(listing.threads)) ? listing.threads : [];
      threads = mergeByThreadId(threads, more);

      const reached = threads.length >= args.limitProjected;
      const stuck = threads.length === prevLen;
      prevLen = threads.length;
      if (reached || stuck || round === args.projectScrollRounds) break;

      try { page.evalValue(scrollToBottomExpr('main'), { timeoutMs: 60000 }); } catch {}
      sleepMs(Math.max(0, args.scrollDelayMs));
    }
    projectedByProjectId[pid] = threads.map((r) => ({
      title: r.title,
      thread_id: r.thread_id,
      date: r.date || "",
      url: normalizeAbsUrl(r.href),
    }));

    if (args.debug) {
      projectedDebugByProjectId[pid] = {
        has_value: !!(listingDetails && listingDetails.hasValue),
        remote_type: (listingDetails && listingDetails.remoteObject) ? listingDetails.remoteObject.type : null,
        remote_subtype: (listingDetails && listingDetails.remoteObject) ? (listingDetails.remoteObject.subtype || null) : null,
        exception: (listingDetails && listingDetails.exceptionDetails)
          ? {
            text: String(listingDetails.exceptionDetails.text || ""),
            lineNumber: listingDetails.exceptionDetails.lineNumber,
            columnNumber: listingDetails.exceptionDetails.columnNumber,
            description: listingDetails.exceptionDetails.exception ? String(listingDetails.exceptionDetails.exception.description || "") : "",
          }
          : null,
      };
    }
  }

  const inv = {
    ts_utc: new Date().toISOString(),
    addr: args.addr,
    port: args.port,
    base: {
      url: args.url,
      target: { id: baseTarget.id, title: baseTarget.title, url: baseTarget.url },
      listing: baseListing,
      debug: args.debug
        ? {
          has_value: !!(baseListingDetails && baseListingDetails.hasValue),
          remote_type: (baseListingDetails && baseListingDetails.remoteObject) ? baseListingDetails.remoteObject.type : null,
          remote_subtype: (baseListingDetails && baseListingDetails.remoteObject) ? (baseListingDetails.remoteObject.subtype || null) : null,
          exception: (baseListingDetails && baseListingDetails.exceptionDetails)
            ? {
              text: String(baseListingDetails.exceptionDetails.text || ""),
              lineNumber: baseListingDetails.exceptionDetails.lineNumber,
              columnNumber: baseListingDetails.exceptionDetails.columnNumber,
              description: baseListingDetails.exceptionDetails.exception ? String(baseListingDetails.exceptionDetails.exception.description || "") : "",
            }
            : null,
        }
        : undefined,
    },
    projects: projects.map((p) => ({
      name: String(p.name || ""),
      project_id: String(p.project_id || ""),
      url: normalizeAbsUrl(p.href),
    })),
    unprojected_threads: unprojected.map((t) => ({
      title: String(t.title || ""),
      thread_id: String(t.thread_id || ""),
      url: normalizeAbsUrl(t.href),
    })),
    projected_threads: projectedByProjectId,
    projected_debug: args.debug ? projectedDebugByProjectId : undefined,
  };

  const md = renderMarkdown(inv);
  std.out.puts(md);
  std.out.flush();

  if (args.outDir) {
    writeOptional(joinPath(args.outDir, "PROJECT_INVENTORY.md"), md);
    writeOptional(joinPath(args.outDir, "PROJECT_INVENTORY.json"), JSON.stringify(inv, null, 2) + "\n");
  }
  if (args.irPath) {
    saveIr(args.irPath, materializeInventoryIr(inv));
  }

  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
