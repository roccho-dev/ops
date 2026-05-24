// List files currently visible in ChatGPT Project Sources.

import {
  cdpCall,
  cdpEvaluate,
  cdpList,
  cdpNew,
  cdpVersion,
  getDefaultAddr,
  getDefaultPort,
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
    "usage: qjs --std -m chromium-cdp-project-source-list.mjs --projectUrl <.../project> [--id <targetId>] [--outPath <file>] [--addr 127.0.0.1] [--port 9222] [--timeoutMs 60000]\n",
  );
  std.err.flush();
}

function parseArgs(argv) {
  const out = {
    addr: getDefaultAddr(),
    port: getDefaultPort(),
    projectUrl: null,
    id: null,
    outPath: null,
    timeoutMs: 60000,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--addr" && i + 1 < argv.length) out.addr = argv[++i];
    else if (a === "--port" && i + 1 < argv.length) out.port = Number(argv[++i]) || out.port;
    else if ((a === "--projectUrl" || a === "--project-url") && i + 1 < argv.length) out.projectUrl = argv[++i];
    else if (a === "--id" && i + 1 < argv.length) out.id = argv[++i];
    else if ((a === "--outPath" || a === "--out-path") && i + 1 < argv.length) out.outPath = argv[++i];
    else if ((a === "--timeoutMs" || a === "--timeout-ms") && i + 1 < argv.length) out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    else if (a === "-h" || a === "--help") return null;
    else return null;
  }
  if (!out.projectUrl) return null;
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
  const list = listProjectSources(wsUrl, args.timeoutMs) || { ok: false, count: 0, sources: [] };
  const result = {
    ok: !!list.ok,
    projectUrl: args.projectUrl,
    sourcesUrl: url,
    target: { id: target.id, url: target.url, title: target.title },
    ...list,
  };
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
