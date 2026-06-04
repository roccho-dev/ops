// Collect file-chip artifacts from a Project Source created via "Add to project sources".
//
// What this does
// - Open the Project's Sources page
// - Scan the newest Sources entries
// - For each entry, open it and check whether it contains a marker string
// - When found, download the requested file chips from that promoted turn
//
// Runtime: quickjs-ng (qjs) with --std
//
// Example
//   nix shell .#chromium-cdp-tools
//   qjs --std -m parts/cdp/project-sources-collect-files.mjs \
//     --projectUrl "https://chatgpt.com/g/g-p-<project>/project" \
//     --needle "SOURCE_ID: worktree-foo-001" \
//     --outDir /tmp/hq_sources_collect \
//     --name PATCH.diff \
//     --name repo.bundle \
//     --port 9223

import * as std from "./core/std.mjs";
import { locateFileChipExpr, mouseClick, navigateChatGptTarget, openOrCreateChatGptTarget, scrollToBottomExpr } from "./domain/chatgpt/index.mjs";
import { fetchResolvedDownloadTargets } from "./domain/chatgpt/download-fetch.mjs";
import { resolveNamedDownloadTargetsWithPolicy } from "./domain/chatgpt/download-resolve.mjs";
import {
  isFreshIr,
  loadIr,
  materializeDownloadResolveIr,
  projectDownloadResolveFromIr,
  saveIr,
} from "./domain/chatgpt/ir.mjs";
import { DOWNLOAD_POLICY, buildDownloadFetchPolicy, buildDownloadResolvePolicy } from "./domain/chatgpt/policies/download.mjs";
import { requireCdp } from "./core/connect.mjs";
import { buildDownloadedNameRegex, copyFile, joinPath, listMatchingFiles, mkdirp, tryStat } from "./core/io.mjs";
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
    "usage: qjs --std -m project-sources-collect-files.mjs --projectUrl <.../project> --needle <s> --outDir <dir> [--name <file> ... | --all | --findOnly] [--limit 25] [--downloadsDir <dir>] [--force] [--addr 127.0.0.1] [--port 9222] [--waitMs 800] [--timeoutMs 240000] [--pollMs 200] [--waitForMaterialize] [--irPath <path>] [--preferIr] [--refresh] [--maxAgeSec <n>] [--resolveOnly] [--stats]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      projectUrl: null,
      needle: null,
      outDir: null,
      downloadsDir: null,
      names: [],
      all: false,
      findOnly: false,
      reuseExisting: true,
      limit: 25,
      waitMs: 800,
      timeoutMs: 240000,
      pollMs: DOWNLOAD_POLICY.fetch.filePollMs,
      waitForMaterialize: DOWNLOAD_POLICY.resolve.allowMaterializePolling,
      irPath: null,
      preferIr: false,
      refresh: false,
      maxAgeSec: 0,
      resolveOnly: false,
      stats: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      projectUrl: {},
      needle: {},
      outDir: {},
      downloadsDir: {},
      names: { name: "--name", multiple: true },
      all: { type: "boolean" },
      findOnly: { type: "boolean" },
      reuseExisting: { name: "--force", type: "boolean", value: false },
      limit: { parse: (raw, current) => Number(raw) || current },
      waitMs: { parse: (raw, current) => Number(raw) || current },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
      pollMs: { parse: (raw, current) => Number(raw) || current },
      waitForMaterialize: { type: "boolean" },
      irPath: {},
      preferIr: { type: "boolean" },
      refresh: { type: "boolean" },
      maxAgeSec: { parse: (raw, current) => Number(raw) || current },
      resolveOnly: { type: "boolean" },
      stats: { type: "boolean" },
    },
    onError: "null",
    finalize: (out) => {
      if (!out.downloadsDir) {
        const home = String(std.getenv("HOME") || "");
        out.downloadsDir = home ? `${home}/Downloads` : "./Downloads";
      }
      if (!out.outDir) return null;
      if (!out.projectUrl && !out.irPath) return null;
      if (!out.needle && !out.irPath) return null;
      if (!out.findOnly && !out.all && (!out.names || out.names.length === 0) && !out.irPath) return null;
      return out;
    },
  });
}
function ensureDir(path) {
  mkdirp(path);
}

function namesFromTargets(targets) {
  return (Array.isArray(targets) ? targets : [])
    .map((row) => String(row && row.name || ""))
    .filter((name) => name.length > 0);
}

function projectMatchingIr(args) {
  if (!args.irPath || !args.preferIr || args.refresh) return null;
  try {
    const existing = loadIr(args.irPath);
    if (!existing || !isFreshIr(existing, { maxAgeSec: args.maxAgeSec })) return null;
    const projected = projectDownloadResolveFromIr(existing);
    const requestedProjectUrl = String(args.projectUrl || "");
    const requestedNeedle = String(args.needle || "");
    if (requestedProjectUrl && String(projected.projectUrl || "") !== requestedProjectUrl) return null;
    if (requestedNeedle && String(projected.needle || "") !== requestedNeedle) return null;
    const requestedNames = (Array.isArray(args.names) ? args.names : [])
      .map((name) => String(name || ""))
      .filter((name) => name.length > 0);
    let filteredTargets = Array.isArray(projected.targets) ? projected.targets.slice() : [];
    if (requestedNames.length > 0) {
      const targetNames = new Set(namesFromTargets(filteredTargets));
      if (!requestedNames.every((name) => targetNames.has(name))) return null;
      filteredTargets = filteredTargets.filter((row) => requestedNames.includes(String(row && row.name || "")));
    }
    return {
      ...projected,
      targets: filteredTargets,
    };
  } catch {
    return null;
  }
}

function hydrateArgsFromIr(args, projected) {
  const next = { ...args };
  next.projectUrl = next.projectUrl || String(projected && projected.projectUrl || "");
  next.needle = next.needle || String(projected && projected.needle || "");
  if (!Array.isArray(next.names) || next.names.length === 0) {
    next.names = namesFromTargets(projected && projected.targets);
  }
  return next;
}

function canReuseExistingDownloads(downloadsDir, targets) {
  return (Array.isArray(targets) ? targets : []).every((target) => {
    const name = String(target && target.name || "");
    if (!name) return false;
    return listMatchingFiles(downloadsDir, buildDownloadedNameRegex(name)).length > 0;
  });
}

function normalizeProjectSourcesUrl(projectUrl) {
  const u = String(projectUrl || "");
  if (!u) return u;
  if (u.includes("tab=sources")) return u;
  if (u.includes("?")) return u + "&tab=sources";
  return u + "?tab=sources";
}

function listSourcesEntriesExpr(limit) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 25));
  return `(() => {
    const limit = ${lim};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const yearRx = /\\b(19|20)\\d{2}\\b/;
    const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
    const out = [];
    for (const b of btns) {
      const t = String(b.innerText || '').trim();
      if (!t) continue;
      if (!yearRx.test(t)) continue;
      // Exclude obvious non-rows.
      if (t === 'Newest' || t === 'All' || t === 'Add sources') continue;
      const r = b.getBoundingClientRect();
      if (r.width < 120 || r.height < 28) continue;
      // Require "cursor" hint if present.
      const cls = String(b.className || '');
      if (cls && !cls.includes('cursor')) continue;
      const lines = t.split('\\n').map((s) => String(s || '').trim()).filter((s) => s.length);
      const label = lines.length ? lines[0] : t;
      const date = lines.length >= 2 ? lines[lines.length - 1] : '';

       // Click target: the label span (more reliable than button center).
       let clickX = r.left + Math.min(96, Math.max(24, r.width * 0.25));
       let clickY = r.top + r.height / 2;
       try {
         const kids = Array.from(b.querySelectorAll('span,div,p')).filter(isVisible);
         for (const el of kids) {
           const txt = String(el.innerText || '').trim();
           if (txt !== label) continue;
           const kr = el.getBoundingClientRect();
           if (kr.width < 10 || kr.height < 10) continue;
           clickX = kr.left + kr.width / 2;
           clickY = kr.top + kr.height / 2;
           break;
         }
       } catch (_) {
         // ignore
       }

      out.push({
        label,
        date,
        text: t,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        click_x: clickX,
        click_y: clickY,
        w: r.width,
        h: r.height,
      });
    }
    out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return { ok: true, entry_count: out.length, entries: out.slice(0, limit) };
  })()`;
}

function pageContainsNeedleExpr(needle) {
  const n = JSON.stringify(String(needle || ""));
  return `(() => {
    const needle = ${n};
    if (!needle) return { ok: false, has: false, has_role: false, has_body: false };
    const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"],[data-message-author-role="user"]'));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i];
      const txt = String(el && (el.textContent || el.innerText || '') || '');
      if (txt.includes(needle)) return { ok: true, has: true, has_role: true, has_body: true };
    }
    const body = document.body ? String(document.body.innerText || '') : '';
    const hasBody = !!(body && body.includes(needle));
    return { ok: true, has: false, has_role: false, has_body: hasBody };
  })()`;
}

function waitForNeedle(project, needle, timeoutMs, pollMs) {
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  const poll = Math.max(50, Number(pollMs) || 200);
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    // Ensure the promoted turn is actually materialized (Chat UI is virtualized).
    try { project.evalValue(scrollToBottomExpr(), { timeoutMs: 60000 }); } catch {}
    sleepMs(250);
    last = project.evalValue(pageContainsNeedleExpr(needle), { timeoutMs: 60000 });
    // Avoid SPA stale-content false positives: require a match inside a role turn.
    if (last && last.ok && last.has_role) return { ok: true, timed_out: false, last };
    sleepMs(poll);
  }
  return { ok: false, timed_out: true, last };
}

function locateChipInNeedleTurnExpr(needle, name) {
  const n = JSON.stringify(String(needle || ""));
  const nm = JSON.stringify(String(name || ""));
  return `(() => {
    const needle = ${n};
    const name = ${nm};
    const norm = (s) => String(s || '').trim();
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    if (!needle || !name) return { ok: false, reason: 'missing_args' };

    const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"],[data-message-author-role="user"]'));
    let hit = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i];
      const txt = String(el && (el.textContent || el.innerText || '') || '');
      if (txt.includes(needle)) { hit = el; break; }
    }
    if (!hit) return { ok: false, reason: 'needle_turn_not_found' };
    const turn = hit.closest('[data-testid^="conversation-turn-"]');
    if (!turn) return { ok: false, reason: 'turn_container_not_found' };
    try { turn.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    const buttons = Array.from(turn.querySelectorAll('button')).filter(isVisible);
    let b =
      buttons.find((x) => norm(x.innerText) === name) ||
      buttons.find((x) => norm(x.getAttribute('aria-label')) === name) ||
      buttons.find((x) => norm(x.getAttribute('title')) === name) ||
      buttons.find((x) => norm(x.innerText).includes(name));
    if (!b) return { ok: false, reason: 'chip_not_found_in_turn' };
    try { b.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    const r = b.getBoundingClientRect();
    return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
}

function listAllFileChipsExpr() {
  return `(() => {
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const btns = Array.from(document.querySelectorAll('button')).filter(isVisible);
    const out = [];
    for (const b of btns) {
      const t = String(b.innerText || '').trim();
      if (!t) continue;
      if (t.length > 180) continue;
      if (!t.includes('.')) continue;
      const low = t.toLowerCase();
      if (!(low.endsWith('.txt') || low.endsWith('.diff') || low.endsWith('.patch') || low.endsWith('.zip') || low.endsWith('.json') || low.endsWith('.md'))) continue;
      out.push(t);
    }
    // Preserve visual order by DOM order; dedupe.
    const uniq = [];
    const seen = new Set();
    for (const s of out) {
      if (seen.has(s)) continue;
      seen.add(s);
      uniq.push(s);
    }
    return { ok: true, names: uniq };
  })()`;
}

function downloadOne(project, needle, fileName, downloadsDir, outDir, timeoutMs, pollMs, reuseExisting) {
  const name = String(fileName || "");
  const nameRx = buildDownloadedNameRegex(name);
  const existing = listMatchingFiles(downloadsDir, nameRx);

  if (reuseExisting && existing.length > 0) {
    const pick = existing.find((x) => x.name === name) || existing[0];
    const dest = joinPath(outDir, name);
    copyFile(pick.path, dest);
    return { name, ok: true, reused_existing: true, downloads_src: pick.path, out_path: dest, bytes: pick.size };
  }

  const baselineSet = new Set(existing.map((x) => x.name));

  // Downloads are often blocked from background tabs.
  try { project.call("Page.bringToFront", {}); } catch {}
  sleepMs(100);

  // Make sure the requested turn is actually rendered.
  try { project.evalValue(scrollToBottomExpr(), { timeoutMs: 60000 }); } catch {}
  sleepMs(250);
  try { project.evalValue(scrollToBottomExpr(), { timeoutMs: 60000 }); } catch {}
  sleepMs(250);

  let loc = null;
  if (needle) {
    loc = project.evalValue(locateChipInNeedleTurnExpr(needle, name), { timeoutMs: 60000 });
  }
  if (!loc || !loc.ok) {
    loc = project.evalValue(locateFileChipExpr(name), { timeoutMs: 60000 });
  }
  if (!loc || !loc.ok) {
    return { name, ok: false, error: "chip_not_found", locator: loc };
  }

  const startMs = Date.now();
  mouseClick(project.call, loc.x, loc.y);
  sleepMs(250);

  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let downloaded = null;
  while (Date.now() < deadline) {
    const cands = listMatchingFiles(downloadsDir, nameRx)
      .filter((f) => !baselineSet.has(f.name))
      .filter((f) => f.mtime >= startMs - 1000)
      .filter((f) => !String(f.name).endsWith(".crdownload"));
    if (cands.length > 0) {
      const pick = cands[0];
      if (tryStat(pick.path + ".crdownload")) {
        sleepMs(pollMs);
        continue;
      }
      const st1 = tryStat(pick.path);
      sleepMs(200);
      const st2 = tryStat(pick.path);
      if (st1 && st2 && Number(st1.size) === Number(st2.size)) {
        downloaded = pick;
        break;
      }
    }
    sleepMs(pollMs);
  }

  if (!downloaded) {
    // Debug: check for any in-progress crdownload sibling.
    const maybeCr = (() => {
      const cands = listMatchingFiles(downloadsDir, nameRx);
      const pick = cands.length ? cands[0] : null;
      if (!pick) return null;
      if (tryStat(pick.path + ".crdownload")) return pick.path + ".crdownload";
      return null;
    })();
    return {
      name,
      ok: false,
      error: "download_timeout",
      locator: loc,
      baseline_count: existing.length,
      baseline_names: existing.slice(0, 5).map((x) => x.name),
      saw_crdownload: maybeCr,
    };
  }

  const dest = joinPath(outDir, name);
  copyFile(downloaded.path, dest);
  return { name, ok: true, downloads_src: downloaded.path, out_path: dest, bytes: downloaded.size };
}

function gotoSources(project, wsUrl, sourcesUrl, timeoutMs) {
  const url = String(sourcesUrl || "");
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const href = project.evalValue("(() => location.href)()", { timeoutMs: 60000 });
    if (href && String(href).startsWith(url)) return { ok: true, href };
    const hist = project.call("Page.getNavigationHistory", {}, 60000);
    const entries = (hist && hist.result && hist.result.entries) ? hist.result.entries : [];
    let best = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e && e.url && String(e.url).startsWith(url)) { best = e; break; }
    }
    if (best && best.id) {
      project.call("Page.navigateToHistoryEntry", { entryId: best.id }, 60000);
      sleepMs(1200);
      continue;
    }
    navigateChatGptTarget(wsUrl, url, {
      timeoutMs: Math.min(Math.max(timeout, 5000), 60000),
      purpose: "project-sources-collect-files goto-sources",
    });
    sleepMs(1200);
  }
  return { ok: false, href: project.evalValue("(() => location.href)()", { timeoutMs: 60000 }) };
}

function main(args) {
  ensureDir(args.outDir);
  if (!args.findOnly) ensureDir(args.downloadsDir);

  const stats = {
    ir_hit: false,
    ir_written: false,
    cdp: {
      list_count: 0,
      call_count: 0,
      evaluate_count: 0,
      navigate_count: 0,
    },
    download: {
      resolve_attempts: 0,
      resolve_waited_ms: 0,
      resolve_polled: false,
    },
  };

  let cached = null;
  const projected = projectMatchingIr(args);
  if (projected) {
    args = hydrateArgsFromIr(args, projected);
    stats.ir_hit = true;
    cached = projected;
    if (args.resolveOnly) {
      const out = {
        ok: Array.isArray(projected.targets) ? projected.targets.every((t) => t && t.ok) : true,
        projectUrl: projected.projectUrl,
        sourceUrl: projected.sourceUrl,
        needle: projected.needle,
        chips: projected.chips || null,
        downloads: projected.targets || [],
      };
      if (args.stats) out.stats = stats;
      std.out.puts(JSON.stringify(out, null, 2) + "\n");
      std.out.flush();
      return out.ok ? 0 : 1;
    }
    if (!args.findOnly && args.reuseExisting && canReuseExistingDownloads(args.downloadsDir, projected.targets)) {
      const downloads = fetchResolvedDownloadTargets(
        () => { throw new Error("cdp_not_required_for_reused_download"); },
        () => { throw new Error("cdp_not_required_for_reused_download"); },
        projected.targets,
        {
          outDir: args.outDir,
          downloadsDir: args.downloadsDir,
          mode: "copy",
          reuseExisting: true,
          timeoutMs: args.timeoutMs,
          pollMs: args.pollMs,
          afterClickMs: 250,
        },
      );
      const ok = downloads.length > 0 && downloads.every((row) => row && row.ok);
      const result = {
        ok,
        addr: args.addr,
        port: args.port,
        projectUrl: projected.projectUrl,
        sourcesUrl: normalizeProjectSourcesUrl(projected.projectUrl),
        needle: projected.needle,
        target: projected.target || null,
        scan: projected.scan || null,
        requested: {
          all: !!args.all,
          findOnly: !!args.findOnly,
          names: args.names,
        },
        chips: projected.chips || null,
        downloadsDir: args.downloadsDir,
        outDir: args.outDir,
        downloads,
      };
      if (args.stats) result.stats = stats;
      std.out.puts(JSON.stringify(result, null, 2) + "\n");
      std.out.flush();
      return ok ? 0 : 1;
    }
  }

  if (!args.projectUrl) throw new Error("--projectUrl is required unless --irPath points to a fresh matching download IR");
  if (!args.needle) throw new Error("--needle is required unless --irPath points to a fresh matching download IR");
  if (!args.findOnly && !args.all && (!Array.isArray(args.names) || args.names.length === 0)) {
    throw new Error("--name is required unless --irPath points to a fresh matching download IR");
  }

  const conn = requireCdp(args.addr, args.port);
  stats.cdp.list_count += 1;
  const sourcesUrl = normalizeProjectSourcesUrl(args.projectUrl);
  const initialUrl = cached && cached.sourceUrl ? cached.sourceUrl : sourcesUrl;
  const { target } = openOrCreateChatGptTarget(conn, initialUrl, { purpose: "project-sources-collect-files", checkSession: false });
  const project = mkCaller(target.webSocketDebuggerUrl);
  try { project.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const resolvePolicy = buildDownloadResolvePolicy({
    waitForMaterialize: args.waitForMaterialize,
  });
  const fetchPolicy = buildDownloadFetchPolicy({
    pollMs: args.pollMs,
    afterClickMs: 250,
  });

  const tried = [];
  const triedKeys = new Set();
  let sourceUrl = cached && cached.sourceUrl ? String(cached.sourceUrl) : null;
  let found = !!sourceUrl;
  let chips = cached && cached.chips ? cached.chips : null;
  let downloadNames = Array.isArray(cached && cached.targets) ? cached.targets.map((t) => t.name) : [];
  let resolvedTargets = Array.isArray(cached && cached.targets) ? cached.targets : null;

  const scanStart = Date.now();
  if (!found) {
    gotoSources(project, target.webSocketDebuggerUrl, sourcesUrl, 60000);

    const scanDeadline = Date.now() + Math.max(0, Number(args.timeoutMs) || 0);
    while (Date.now() < scanDeadline) {
      gotoSources(project, target.webSocketDebuggerUrl, sourcesUrl, 60000);
      const listing = project.evalValue(listSourcesEntriesExpr(args.limit), { timeoutMs: 60000 });
      stats.cdp.evaluate_count += 1;
      const entries = listing && listing.entries ? listing.entries : [];
      if (!entries.length) {
        sleepMs(800);
        continue;
      }

      let pick = null;
      let pickKey = null;
      for (const e of entries) {
        if (!e || !e.x || !e.y) continue;
        const ky = (e && e.y !== undefined && e.y !== null) ? String(Math.round(Number(e.y) || 0)) : "0";
        const key = `${e.label}@@${e.date}@@${ky}`;
        if (triedKeys.has(key)) continue;
        pick = e;
        pickKey = key;
        break;
      }

      if (!pick) break;
      triedKeys.add(pickKey);

      const cx = (pick.click_x !== undefined && pick.click_x !== null) ? pick.click_x : pick.x;
      const cy = (pick.click_y !== undefined && pick.click_y !== null) ? pick.click_y : pick.y;
      mouseClick(project.call, cx, cy);
      stats.cdp.call_count += 3;
      sleepMs(Math.max(900, args.waitMs));

      const navStart = Date.now();
      let href = null;
      while (Date.now() - navStart < 20000) {
        href = project.evalValue("(() => location.href)()", { timeoutMs: 60000 });
        stats.cdp.evaluate_count += 1;
        if (href && !String(href).startsWith(sourcesUrl)) break;
        sleepMs(300);
      }

      if (href && !String(href).startsWith(sourcesUrl)) {
        try { project.call("Page.reload", { ignoreCache: true }, 60000); } catch {}
        stats.cdp.call_count += 1;
        sleepMs(2500);
      }

      const has = waitForNeedle(project, args.needle, 20000, args.pollMs);
      stats.cdp.evaluate_count += 1;
      const matched = !!(has && has.ok);
      tried.push({
        key: pickKey,
        label: pick.label,
        date: pick.date,
        opened_href: href,
        matched,
        needle_check: has,
      });

      if (matched && href) {
        sourceUrl = String(href);
        found = true;
        break;
      }

      gotoSources(project, target.webSocketDebuggerUrl, sourcesUrl, 60000);
      stats.cdp.navigate_count += 1;
      sleepMs(Math.max(600, args.waitMs));
    }
  }

  if (found && (args.all || args.findOnly) && !cached) {
    const chipsRes = project.evalValue(listAllFileChipsExpr(), { timeoutMs: 60000 });
    stats.cdp.evaluate_count += 1;
    downloadNames = (chipsRes && chipsRes.ok && Array.isArray(chipsRes.names)) ? chipsRes.names : [];
    chips = { ok: !!(chipsRes && chipsRes.ok), names: downloadNames };
  } else if (!cached) {
    downloadNames = (args.names || []).map((s) => String(s || "")).filter((s) => !!s);
  }

  if (found && !resolvedTargets) {
    navigateChatGptTarget(target.webSocketDebuggerUrl, sourceUrl, {
      timeoutMs: 60000,
      purpose: "project-sources-collect-files resolve-targets",
    });
    stats.cdp.navigate_count += 1;
    sleepMs(Math.max(1200, args.waitMs));
    try { project.call("Page.reload", { ignoreCache: true }, 60000); } catch {}
    stats.cdp.call_count += 1;
    sleepMs(2000);
    const resolved = resolveNamedDownloadTargetsWithPolicy(project.evalValue, downloadNames, {
      policy: resolvePolicy,
      allowFileChipFallback: true,
      scrollRootSelector: "main",
    });
    resolvedTargets = resolved.targets;
    stats.cdp.evaluate_count += Number(resolved.stats && resolved.stats.evaluate_count) || 0;
    stats.download.resolve_attempts = Number(resolved.stats && resolved.stats.attempts) || 0;
    stats.download.resolve_waited_ms = Number(resolved.stats && resolved.stats.waited_ms) || 0;
    stats.download.resolve_polled = resolved.stats ? resolved.stats.polled === true : false;
    if (args.irPath) {
      saveIr(args.irPath, materializeDownloadResolveIr({
        captured_at: new Date().toISOString(),
        url: sourceUrl,
        projectUrl: args.projectUrl,
        sourceUrl,
        needle: args.needle,
        targets: resolvedTargets,
        target: { id: target.id, title: target.title, url: target.url },
        source: { kind: "cdp-live", addr: args.addr, port: args.port, target_id: target.id, url: sourceUrl },
        chips,
        scan: {
          started_ms: scanStart,
          elapsed_ms: Date.now() - scanStart,
          limit: args.limit,
          tried,
          found,
          source_url: sourceUrl,
        },
        stats,
      }));
      stats.ir_written = true;
    }
  }

  if (args.resolveOnly) {
    const result = {
      ok: found && Array.isArray(resolvedTargets) && resolvedTargets.every((d) => d && d.ok),
      addr: args.addr,
      port: args.port,
      projectUrl: args.projectUrl,
      sourcesUrl,
      needle: args.needle,
      target: { id: target.id, title: target.title, url: target.url },
      scan: {
        started_ms: scanStart,
        elapsed_ms: Date.now() - scanStart,
        limit: args.limit,
        tried,
        found,
        source_url: sourceUrl,
      },
      chips,
      downloads: resolvedTargets || [],
    };
    if (args.stats) result.stats = stats;
    std.out.puts(JSON.stringify(result, null, 2) + "\n");
    std.out.flush();
    return result.ok ? 0 : 1;
  }

  const downloads = [];
  if (!args.findOnly && found && Array.isArray(resolvedTargets) && resolvedTargets.length > 0) {
    navigateChatGptTarget(target.webSocketDebuggerUrl, sourceUrl, {
      timeoutMs: 60000,
      purpose: "project-sources-collect-files reopen-source",
    });
    stats.cdp.navigate_count += 1;
    sleepMs(Math.max(1200, args.waitMs));
    try { project.call("Page.reload", { ignoreCache: true }, 60000); } catch {}
    stats.cdp.call_count += 1;
    sleepMs(2000);
    downloads.push(
      ...fetchResolvedDownloadTargets(project.call, project.evalValue, resolvedTargets, {
        outDir: args.outDir,
        downloadsDir: args.downloadsDir,
        mode: "copy",
        reuseExisting: args.reuseExisting,
        timeoutMs: args.timeoutMs,
        pollMs: fetchPolicy.filePollMs,
        afterClickMs: fetchPolicy.afterClickMs,
      }),
    );
  }

  const ok = args.findOnly
    ? found
    : (found && downloads.length > 0 && downloads.every((d) => d && d.ok));

  const result = {
    ok,
    addr: args.addr,
    port: args.port,
    projectUrl: args.projectUrl,
    sourcesUrl,
    needle: args.needle,
    target: { id: target.id, title: target.title, url: target.url },
    scan: {
      started_ms: scanStart,
      elapsed_ms: Date.now() - scanStart,
      limit: args.limit,
      tried,
      found,
      source_url: sourceUrl,
    },
    requested: {
      all: !!args.all,
      findOnly: !!args.findOnly,
      names: args.names,
    },
    chips,
    downloadsDir: args.findOnly ? null : args.downloadsDir,
    outDir: args.outDir,
    downloads,
  };
  if (args.stats) result.stats = stats;

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
