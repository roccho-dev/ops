// Delete one exact-title file from ChatGPT Project Sources via CDP.

import {
  cdpCall,
  cdpEvaluate,
  cdpList,
  cdpNew,
  cdpVersion,
  getDefaultAddr,
  getDefaultPort,
  sleepMs,
} from "./lib.mjs";
import {
  pickProjectSourcesTarget,
  projectSourcesHrefMatches,
  projectSourcesUrl,
  waitForProjectSourcesUrlExpr,
} from "./chatgpt/project-sources.mjs";
import { listProjectSources, waitForProjectSourcesLoadedExpr } from "./chatgpt/project-source-listing.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-project-source-delete.mjs --projectUrl <.../project> --title <exact filename> --reason <text> --allow-remove [--dryRun] [--id <targetId>] [--outPath <file>] [--addr 127.0.0.1] [--port 9222] [--timeoutMs 60000]\n",
  );
  std.err.flush();
}

function parseArgs(argv) {
  const out = {
    addr: getDefaultAddr(),
    port: getDefaultPort(),
    projectUrl: null,
    id: null,
    title: null,
    reason: null,
    allowRemove: false,
    dryRun: false,
    outPath: null,
    timeoutMs: 60000,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--addr" && i + 1 < argv.length) out.addr = argv[++i];
    else if (a === "--port" && i + 1 < argv.length) out.port = Number(argv[++i]) || out.port;
    else if ((a === "--projectUrl" || a === "--project-url") && i + 1 < argv.length) out.projectUrl = argv[++i];
    else if (a === "--id" && i + 1 < argv.length) out.id = argv[++i];
    else if (a === "--title" && i + 1 < argv.length) out.title = argv[++i];
    else if (a === "--reason" && i + 1 < argv.length) out.reason = argv[++i];
    else if (a === "--allow-remove" || a === "--allowRemove") out.allowRemove = true;
    else if (a === "--dry-run" || a === "--dryRun") out.dryRun = true;
    else if ((a === "--outPath" || a === "--out-path") && i + 1 < argv.length) out.outPath = argv[++i];
    else if ((a === "--timeoutMs" || a === "--timeout-ms") && i + 1 < argv.length) out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    else if (a === "-h" || a === "--help") return null;
    else return null;
  }
  if (!out.projectUrl || !out.title) return null;
  return out;
}

function readHref(wsUrl) {
  try {
    const resp = cdpEvaluate(wsUrl, "(() => String(location.href || ''))()", { timeoutMs: 10000 });
    return resp && resp.result && resp.result.result ? String(resp.result.result.value || "") : "";
  } catch (_) {
    return "";
  }
}

function clickSourceActionsExpr(title) {
  const ttl = JSON.stringify(String(title || ""));
  return `(() => {
    const title = ${ttl};
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const normalizeLines = (text) => String(text || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const titleForButton = (button) => {
      let cur = button;
      for (let depth = 0; depth < 12 && cur; depth++) {
        const lines = normalizeLines(cur.innerText || cur.textContent || '');
        const sourceKindIndex = lines.findIndex((line) =>
          line === 'File' ||
          line.startsWith('File ·') ||
          line === 'Document' ||
          line.startsWith('Document ·') ||
          line === 'Zip Archive' ||
          line.startsWith('Zip Archive ·')
        );
        if (sourceKindIndex > 0 && sourceKindIndex <= 3) return lines[sourceKindIndex - 1] || '';
        cur = cur.parentElement;
      }
      return '';
    };
    const hits = [];
    const buttons = Array.from(document.querySelectorAll('button[aria-label="Source actions"]')).filter(isVisible);
    for (const button of buttons) {
      const foundTitle = titleForButton(button);
      if (foundTitle === title) hits.push(button);
    }
    if (hits.length === 0) return { ok: false, reason: 'source-title-not-found', title, matchCount: 0 };
    if (hits.length > 1) return { ok: false, reason: 'multiple-source-title-matches', title, matchCount: hits.length };
    const button = hits[0];
    try { button.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    const rect = button.getBoundingClientRect();
    try { button.click(); } catch (_) {}
    return {
      ok: true,
      title,
      matchCount: 1,
      sourceActions: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height },
    };
  })()`;
}

function clickMenuItemExpr(label) {
  const lbl = JSON.stringify(String(label || ""));
  return `(() => {
    const label = ${lbl};
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item], button'));
    const hit = items.find((el) => isVisible(el) && String(el.innerText || el.textContent || '').trim() === label) || null;
    if (!hit) {
      return {
        ok: false,
        reason: 'menu-item-not-found',
        label,
        visibleItems: items.filter(isVisible).map((el) => String(el.innerText || el.textContent || '').trim()).filter(Boolean).slice(0, 20),
      };
    }
    const rect = hit.getBoundingClientRect();
    try { hit.click(); } catch (_) {}
    return { ok: true, label, menuItem: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height } };
  })()`;
}

function maybeClickConfirmRemoveExpr() {
  return `(() => {
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const labels = ['Remove', 'Delete'];
    const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
    const hit = buttons.find((el) => labels.includes(String(el.innerText || el.textContent || '').trim())) || null;
    if (!hit) return { ok: true, clicked: false };
    const modalish = String(document.body && document.body.innerText || '').includes('Are you sure') ||
      String(document.body && document.body.innerText || '').includes('remove') ||
      String(document.body && document.body.innerText || '').includes('Remove');
    if (!modalish) return { ok: true, clicked: false };
    try { hit.click(); } catch (_) {}
    return { ok: true, clicked: true, label: String(hit.innerText || hit.textContent || '').trim() };
  })()`;
}

function countTitle(list, title) {
  const sources = list && Array.isArray(list.sources) ? list.sources : [];
  return sources.filter((row) => row && row.title === title).length;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    usage();
    return 2;
  }
  cdpVersion(args.addr, args.port);
  const url = projectSourcesUrl(args.projectUrl);
  const target = pickProjectSourcesTarget(cdpList(args.addr, args.port), args, url) || cdpNew(args.addr, args.port, url);
  const wsUrl = target.webSocketDebuggerUrl;
  const currentHref = readHref(wsUrl);
  if (!currentHref || currentHref === "about:blank" || !currentHref.includes("/project") || !currentHref.includes("tab=sources")) {
    cdpCall(wsUrl, { id: 21, method: "Page.navigate", params: { url } }, 30000);
  }
  const nav = cdpEvaluate(wsUrl, waitForProjectSourcesUrlExpr(url, Math.min(args.timeoutMs, 60000)), {
    awaitPromise: true,
    returnByValue: true,
    timeoutMs: Math.min(args.timeoutMs, 60000) + 10000,
  });
  const navValue = nav && nav.result && nav.result.result ? nav.result.result.value : null;
  if ((!navValue || !navValue.ok) && !projectSourcesHrefMatches(readHref(wsUrl) || currentHref, url)) {
    throw new Error(`project sources page did not load: href=${navValue && navValue.href ? navValue.href : currentHref || ""}`);
  }
  cdpEvaluate(wsUrl, waitForProjectSourcesLoadedExpr(Math.min(args.timeoutMs, 60000)), {
    awaitPromise: true,
    returnByValue: true,
    timeoutMs: Math.min(args.timeoutMs, 60000) + 10000,
  });

  const before = listProjectSources(wsUrl, args.timeoutMs) || { ok: false, count: 0, sources: [] };
  const beforeTitleCount = countTitle(before, args.title);
  const result = {
    ok: false,
    projectUrl: args.projectUrl,
    sourcesUrl: url,
    target: { id: target.id, url: target.url, title: target.title },
    title: args.title,
    reason: args.reason,
    dryRun: !!args.dryRun,
    allowRemove: !!args.allowRemove,
    semanticApproval: false,
    completionApproval: false,
    routeDecision: false,
    before,
    beforeTitleCount,
  };
  if (!args.reason) {
    result.status = "missing-reason";
    result.reasonRequired = true;
  } else if (beforeTitleCount === 0) {
    result.status = "source-title-not-found";
  } else if (beforeTitleCount > 1) {
    result.status = "multiple-source-title-matches";
  } else if (args.dryRun) {
    result.ok = true;
    result.status = "dry-run-ready";
  } else if (!args.allowRemove) {
    result.status = "remove-not-authorized";
    result.requiredFlag = "--allow-remove";
  } else {
    const openMenu = cdpEvaluate(wsUrl, clickSourceActionsExpr(args.title), {
      awaitPromise: false,
      returnByValue: true,
      timeoutMs: 30000,
      userGesture: true,
    });
    result.openMenu = openMenu && openMenu.result && openMenu.result.result ? openMenu.result.result.value : null;
    sleepMs(500);
    if (!result.openMenu || !result.openMenu.ok) {
      result.status = result.openMenu && result.openMenu.reason ? result.openMenu.reason : "source-actions-open-failed";
    } else {
      const clickRemove = cdpEvaluate(wsUrl, clickMenuItemExpr("Remove"), {
        awaitPromise: false,
        returnByValue: true,
        timeoutMs: 30000,
        userGesture: true,
      });
      result.clickRemove = clickRemove && clickRemove.result && clickRemove.result.result ? clickRemove.result.result.value : null;
      sleepMs(700);
      result.confirmRemove = cdpEvaluate(wsUrl, maybeClickConfirmRemoveExpr(), {
        awaitPromise: false,
        returnByValue: true,
        timeoutMs: 30000,
        userGesture: true,
      });
      sleepMs(1500);
      const after = listProjectSources(wsUrl, args.timeoutMs) || { ok: false, count: 0, sources: [] };
      const afterTitleCount = countTitle(after, args.title);
      result.after = after;
      result.afterTitleCount = afterTitleCount;
      result.ok = !!(result.clickRemove && result.clickRemove.ok && afterTitleCount < beforeTitleCount);
      result.status = result.ok ? "source-deleted" : "source-delete-not-verified";
    }
  }
  const out = JSON.stringify(result, null, 2) + "\n";
  if (args.outPath) std.writeFile(args.outPath, out);
  std.out.puts(out);
  std.out.flush();
  return result.ok ? 0 : 1;
}

try {
  std.exit(main(scriptArgs));
} catch (e) {
  std.err.puts(String(e && e.message ? e.message : e) + "\n");
  if (e && e.stack) std.err.puts(String(e.stack) + "\n");
  std.err.flush();
  std.exit(1);
}
