// Download ChatGPT file-chip artifacts via CDP (no jq/node).
//
// Why this exists
// - ChatGPT "file chips" (e.g. qjs_orchestrator_project.zip) are often rendered
//   as <button> elements without a direct <a download> link.
// - ChatGPT sandbox-generated files can also appear as sandbox:/mnt/data/... links.
// - In practice, clicking the chip/link triggers a browser download into the
//   browser's configured downloads directory, but CDP Browser.downloadProgress
//   events may not fire reliably.
// - This script makes downloads reproducible by:
//     (1) finding + clicking the chip or sandbox link in the target tab
//     (2) watching the filesystem for the new file to appear
//     (3) copying/moving it into an output directory with a stable name

import * as std from "./qjs-compat/std.mjs";
import {
  extractConversationId,
  listPageTargets,
  locateDownloadArtifactExpr,
  previewTargets,
} from "./domain/chatgpt/index.mjs";
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
import { buildDownloadedNameRegex, listMatchingFiles, mkdirp } from "./core/io.mjs";
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
    "usage: qjs --std -m download-chatgpt-artifacts.mjs --url <thread-url> --outDir <dir> --name <file> [--name <file> ...] [--addr 127.0.0.1] [--port 9222] [--id <targetId>] [--downloadsDir <dir>] [--timeoutMs 120000] [--pollMs 200] [--waitMs 0] [--afterClickMs 200] [--waitForMaterialize] [--move] [--reuseExisting] [--force] [--irPath <path>] [--preferIr] [--refresh] [--maxAgeSec <n>] [--resolveOnly] [--stats]\n",
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
      outDir: null,
      downloadsDir: null,
      names: [],
      timeoutMs: 120000,
      pollMs: DOWNLOAD_POLICY.fetch.filePollMs,
      waitMs: 0,
      afterClickMs: DOWNLOAD_POLICY.fetch.afterClickMs,
      waitForMaterialize: DOWNLOAD_POLICY.resolve.allowMaterializePolling,
      mode: "copy",
      reuseExisting: false,
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
      url: {},
      id: {},
      outDir: {},
      downloadsDir: {},
      names: { name: "--name", multiple: true },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
      pollMs: { parse: (raw, current) => Number(raw) || current },
      waitMs: { parse: (raw, current) => Number(raw) || current },
      afterClickMs: { parse: (raw, current) => Number(raw) || current },
      waitForMaterialize: { type: "boolean" },
      mode: { name: "--move", type: "boolean", value: "move" },
      reuseExisting: { name: "--force", type: "boolean", value: false },
      reuseExistingFlag: { name: "--reuseExisting", type: "boolean", value: true },
      irPath: {},
      preferIr: { type: "boolean" },
      refresh: { type: "boolean" },
      maxAgeSec: { parse: (raw, current) => Number(raw) || current },
      resolveOnly: { type: "boolean" },
      stats: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => {
      if (!out.downloadsDir) {
        const home = String(std.getenv("HOME") || "");
        out.downloadsDir = home ? `${home}/Downloads` : "./Downloads";
      }
      // Note: fetch also watches the browser default download dir (~/Downloads) as a fallback
      // even when --downloadsDir points somewhere else.
      if (!out.outDir) return null;
      if (!out.url && !out.irPath) return null;
      if ((!out.names || out.names.length === 0) && !out.irPath) return null;
      if (out.reuseExistingFlag === true) out.reuseExisting = true;
      delete out.reuseExistingFlag;
      return out;
    },
  });
}

function artifactScoreMetaExpr() {
  return `(() => {
    const text = document.body ? String(document.body.innerText || '') : '';
    return { ok: true, text_len: text.length, ready: document.readyState };
  })()`;
}

function pickTarget(targets, args) {
  const pages = listPageTargets(targets);

  const scoreByNames = (wsUrl) => {
    const names = Array.isArray(args.names) ? args.names.map((s) => String(s || "")) : [];
    let score = 0;
    let sandboxHits = 0;
    for (const name of names) {
      try {
        const resp = cdpEvaluate(wsUrl, locateDownloadArtifactExpr(name), {
          id: 1,
          returnByValue: true,
          awaitPromise: false,
          timeoutMs: 5000,
        });
        const value = resp && resp.result && resp.result.result ? resp.result.result.value : null;
        if (value && value.ok === true) {
          score += 1;
          if (String(value.kind || "") === "sandbox_link") sandboxHits += 1;
        }
      } catch {
        // ignore locator failures during target scoring
      }
    }

    let meta = { ok: false, text_len: 0, ready: null };
    try {
      const resp = cdpEvaluate(wsUrl, artifactScoreMetaExpr(), {
        id: 2,
        returnByValue: true,
        awaitPromise: false,
        timeoutMs: 5000,
      });
      const value = resp && resp.result && resp.result.result ? resp.result.result.value : null;
      if (value && typeof value === "object" && value.ok === true) meta = value;
    } catch {
      // ignore
    }

    return {
      ok: true,
      score,
      sandbox_hits: sandboxHits,
      text_len: Number(meta.text_len) || 0,
      ready: meta.ready || null,
    };
  };

  if (args.preferredId) {
    const t = pages.find((x) => String(x.id || "") === String(args.preferredId));
    if (t) return t;
  }

  if (args.id) {
    const t = pages.find((x) => String(x.id || "") === String(args.id));
    if (!t) throw new Error(`target not found by --id: ${args.id}`);
    return t;
  }

  const url = String(args.url || "");
  let cands = pages.filter((t) => String(t.url || "") === url);
  if (cands.length === 0) cands = pages.filter((t) => String(t.url || "").startsWith(url));
  if (cands.length === 0) {
    const cid = extractConversationId(url);
    if (cid) cands = pages.filter((t) => String(t.url || "").includes(cid));
  }

  if (cands.length === 1) return cands[0];

  if (cands.length >= 2) {
    const scored = cands.map((t) => ({ t, s: scoreByNames(t.webSocketDebuggerUrl) }));
    scored.sort(
      (a, b) =>
        (Number(b.s.score) - Number(a.s.score)) ||
        (Number(b.s.sandbox_hits) - Number(a.s.sandbox_hits)) ||
        (Number(b.s.text_len) - Number(a.s.text_len)),
    );
    return scored[0].t;
  }

  const preview = previewTargets(pages);
  throw new Error(
    `no matching page target found; open the thread in Chromium and retry:\n${JSON.stringify(preview, null, 2)}`,
  );
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
    const projectedUrl = String(projected.url || "");
    const requestedUrl = String(args.url || "");
    if (requestedUrl && projectedUrl && requestedUrl !== projectedUrl) return null;
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
  next.url = next.url || String(projected && projected.url || "");
  if (!next.preferredId && projected && projected.target && projected.target.id) {
    next.preferredId = String(projected.target.id);
  }
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

function main(args) {
  ensureDir(args.outDir);
  ensureDir(args.downloadsDir);

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

  const projected = projectMatchingIr(args);
  if (projected) {
    args = hydrateArgsFromIr(args, projected);
    stats.ir_hit = true;
    if (args.resolveOnly) {
      const out = {
        url: projected.url,
        outDir: args.outDir,
        downloadsDir: args.downloadsDir,
        target: projected.target,
        mode: args.mode,
        results: projected.targets,
      };
      if (args.stats) out.stats = stats;
      std.out.puts(JSON.stringify(out, null, 2) + "\n");
      std.out.flush();
      return projected.targets.every((row) => row && row.ok) ? 0 : 1;
    }
    if (args.reuseExisting && canReuseExistingDownloads(args.downloadsDir, projected.targets)) {
      const results = fetchResolvedDownloadTargets(
        () => { throw new Error("cdp_not_required_for_reused_download"); },
        () => { throw new Error("cdp_not_required_for_reused_download"); },
        projected.targets,
        {
          outDir: args.outDir,
          downloadsDir: args.downloadsDir,
          mode: args.mode,
          reuseExisting: true,
          timeoutMs: args.timeoutMs,
          pollMs: args.pollMs,
          afterClickMs: args.afterClickMs,
        },
      );
      const allOk = results.every((row) => row && row.ok);
      const out = {
        url: args.url,
        outDir: args.outDir,
        downloadsDir: args.downloadsDir,
        target: projected.target,
        mode: args.mode,
        results,
      };
      if (args.stats) out.stats = stats;
      std.out.puts(JSON.stringify(out, null, 2) + "\n");
      std.out.flush();
      return allOk ? 0 : 1;
    }
  }

  if (!args.url) throw new Error("--url is required unless --irPath points to a fresh matching download IR");
  if (!Array.isArray(args.names) || args.names.length === 0) {
    throw new Error("--name is required unless --irPath points to a fresh matching download IR");
  }

  const conn = requireCdp(args.addr, args.port);
  stats.cdp.list_count += 1;
  const target = pickTarget(conn.targets, args);
  const wsUrl = target.webSocketDebuggerUrl;

  let nextId = 1;
  const call = (method, params, timeoutMs) => {
    const req = { id: nextId++, method, params };
    return cdpCall(wsUrl, req, timeoutMs || 60000);
  };
  const evalByValue = (expression, timeoutMs) => {
    const resp = cdpEvaluate(wsUrl, expression, {
      id: nextId++,
      returnByValue: true,
      awaitPromise: false,
      timeoutMs: timeoutMs || 60000,
    });
    return resp && resp.result && resp.result.result ? resp.result.result.value : null;
  };
  const evalByValueAsync = (expression, timeoutMs) => {
    const resp = cdpEvaluate(wsUrl, expression, {
      id: nextId++,
      returnByValue: true,
      awaitPromise: true,
      timeoutMs: timeoutMs || 60000,
    });
    return resp && resp.result && resp.result.result ? resp.result.result.value : null;
  };
  try {
    call("Page.bringToFront", {});
  } catch {
    // ignore
  }
  sleepMs(args.waitMs);

  const resolvePolicy = buildDownloadResolvePolicy({
    waitForMaterialize: args.waitForMaterialize,
  });
  const fetchPolicy = buildDownloadFetchPolicy({
    pollMs: args.pollMs,
    afterClickMs: args.afterClickMs,
  });

  let resolvedTargets = null;
  if (projected) {
    resolvedTargets = projected.targets;
  }
  if (!resolvedTargets) {
    const resolved = resolveNamedDownloadTargetsWithPolicy(evalByValue, args.names, {
      policy: resolvePolicy,
    });
    resolvedTargets = resolved.targets;
    stats.cdp.evaluate_count += Number(resolved.stats && resolved.stats.evaluate_count) || 0;
    stats.download.resolve_attempts = Number(resolved.stats && resolved.stats.attempts) || 0;
    stats.download.resolve_waited_ms = Number(resolved.stats && resolved.stats.waited_ms) || 0;
    stats.download.resolve_polled = resolved.stats ? resolved.stats.polled === true : false;
    if (args.irPath) {
      saveIr(args.irPath, materializeDownloadResolveIr({
        captured_at: new Date().toISOString(),
        url: args.url,
        targets: resolvedTargets,
        target: { id: target.id, title: target.title, url: target.url },
        source: { kind: "cdp-live", addr: args.addr, port: args.port, target_id: target.id, url: args.url },
        stats,
      }));
      stats.ir_written = true;
    }
  }

  if (args.resolveOnly) {
    const out = {
      url: args.url,
      outDir: args.outDir,
      downloadsDir: args.downloadsDir,
      target: { id: target.id, title: target.title, url: target.url },
      mode: args.mode,
      results: resolvedTargets,
    };
    if (args.stats) out.stats = stats;
    std.out.puts(JSON.stringify(out, null, 2) + "\n");
    std.out.flush();
    return resolvedTargets.every((r) => r.ok) ? 0 : 1;
  }

  const results = fetchResolvedDownloadTargets(call, evalByValue, resolvedTargets, {
    outDir: args.outDir,
    downloadsDir: args.downloadsDir,
    mode: args.mode,
      reuseExisting: args.reuseExisting,
      timeoutMs: args.timeoutMs,
      pollMs: fetchPolicy.filePollMs,
      afterClickMs: fetchPolicy.afterClickMs,
      evalByValueAsync,
    });
  stats.cdp.call_count += results.length * 3;

  const allOk = results.every((r) => r.ok);
  const out = {
    url: args.url,
    outDir: args.outDir,
    downloadsDir: args.downloadsDir,
    target: { id: target.id, title: target.title, url: target.url },
    mode: args.mode,
    results,
  };
  if (args.stats) out.stats = stats;
  std.out.puts(JSON.stringify(out, null, 2) + "\n");
  std.out.flush();
  return allOk ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
