// Upload a local text file into ChatGPT Project Sources via DataTransfer.
//
// This is intentionally text-only. Use it for manifests, rules, and small
// repository snapshots when host-path binary upload is not available.

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
import { pickProjectSourcesTarget, projectSourcesHrefMatches, projectSourcesUrl, waitForProjectSourcesUrlExpr } from "./chatgpt/project-sources.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-upload-project-source-text.mjs --projectUrl <.../project> --file <path> [--id <targetId>] [--outPath <file>] [--addr 127.0.0.1] [--port 9222] [--waitMs 3000] [--timeoutMs 180000]\n",
  );
  std.err.flush();
}

function parseArgs(argv) {
  const out = {
    addr: getDefaultAddr(),
    port: getDefaultPort(),
    projectUrl: null,
    id: null,
    file: null,
    outPath: null,
    waitMs: 3000,
    timeoutMs: 180000,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--addr" && i + 1 < argv.length) out.addr = argv[++i];
    else if (a === "--port" && i + 1 < argv.length) out.port = Number(argv[++i]) || out.port;
    else if ((a === "--projectUrl" || a === "--project-url") && i + 1 < argv.length) out.projectUrl = argv[++i];
    else if (a === "--id" && i + 1 < argv.length) out.id = argv[++i];
    else if (a === "--file" && i + 1 < argv.length) out.file = argv[++i];
    else if ((a === "--outPath" || a === "--out-path") && i + 1 < argv.length) out.outPath = argv[++i];
    else if ((a === "--waitMs" || a === "--wait-ms") && i + 1 < argv.length) out.waitMs = Number(argv[++i]) || out.waitMs;
    else if ((a === "--timeoutMs" || a === "--timeout-ms") && i + 1 < argv.length) out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    else if (a === "-h" || a === "--help") return null;
    else return null;
  }
  if (!out.projectUrl || !out.file) return null;
  return out;
}

function basename(path) {
  const p = String(path || "");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function uploadTextExpr(fileName, fileText, timeoutMs) {
  const nameJson = JSON.stringify(String(fileName || ""));
  const textJson = JSON.stringify(String(fileText || ""));
  const ms = Math.max(0, Number(timeoutMs) || 0);
  return `(() => new Promise((resolve) => {
    const fileName = ${nameJson};
    const fileText = ${textJson};
    const timeoutMs = ${ms};
    const pickInput = () => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const visible = inputs.filter((i) => {
        const r = i.getBoundingClientRect();
        return String(i.accept || '') === '' && r.width >= 1 && r.height >= 1;
      });
      return visible.length ? visible[visible.length - 1] : (inputs.find((i) => String(i.accept || '') === '') || inputs[0] || null);
    };
    const scan = () => {
      const text = String(document.body && document.body.innerText || '');
      return { ok: text.includes(fileName), href: location.href, textTail: text.slice(-2000) };
    };
    const start = Date.now();
    let done = false;
    let uploaded = false;
    let mo = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      resolve({ ...v, waited_ms: Date.now() - start });
    };
    const tryUpload = () => {
      if (uploaded || done) return;
      const input = pickInput();
      if (!input) return;
      uploaded = true;
      try { input.value = ''; } catch (_) {}
      const dt = new DataTransfer();
      dt.items.add(new File([fileText], fileName, { type: 'text/plain' }));
      try { input.files = dt.files; } catch (e) { return finish({ ok: false, reason: 'assign_failed', error: String(e), href: location.href }); }
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
      const now = scan();
      if (now.ok) finish(now);
    };
    const first = scan();
    if (first.ok) return resolve({ ...first, waited_ms: 0 });
    mo = new MutationObserver(() => {
      tryUpload();
      const now = scan();
      if (now.ok) finish(now);
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    tryUpload();
    const timer = setInterval(tryUpload, 250);
    setTimeout(() => {
      clearInterval(timer);
      const last = scan();
      finish(uploaded ? last : { ok: false, reason: 'file_input_not_found', href: location.href });
    }, timeoutMs);
  }))()`;
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
  if (!currentHref || currentHref === "about:blank" || !currentHref.includes("/project")) {
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
  try { cdpEvaluate(wsUrl, "(() => { try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); } catch (_) {} return true; })()", { timeoutMs: 30000 }); } catch (_) {}
  sleepMs(args.waitMs);

  const fileName = basename(args.file);
  const fileText = String(std.loadFile(args.file) || "");
  if (!fileText.length) throw new Error(`cannot read text file: ${args.file}`);
  const upload = cdpEvaluate(wsUrl, uploadTextExpr(fileName, fileText, args.timeoutMs), {
    awaitPromise: true,
    returnByValue: true,
    timeoutMs: args.timeoutMs + 10000,
  });
  const value = upload && upload.result && upload.result.result ? upload.result.result.value : null;
  const result = {
    ok: !!(value && value.ok),
    projectUrl: args.projectUrl,
    sourcesUrl: url,
    target: { id: target.id, url: target.url, title: target.title },
    file: { path: args.file, name: fileName },
    upload: value,
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
