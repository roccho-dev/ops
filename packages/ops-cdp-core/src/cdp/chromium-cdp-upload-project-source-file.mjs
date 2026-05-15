// Upload a local file into ChatGPT Project Sources via CDP.
//
// Unlike chromium-cdp-upload-project-source-text.mjs, this path is for binary
// files too. It sets the Project Sources file input from a host path, so zip
// archives remain real files instead of DataTransfer text fallback payloads.

import {
  cdpCall,
  cdpEvaluate,
  cdpList,
  cdpNew,
  cdpVersion,
  getDefaultAddr,
  getDefaultPort,
  runToString,
  sleepMs,
} from "./lib.mjs";
import { pickProjectSourcesTarget, projectSourcesHrefMatches, projectSourcesUrl, waitForProjectSourcesUrlExpr, waitForProjectSourceVisibleExpr } from "./chatgpt/project-sources.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-upload-project-source-file.mjs --projectUrl <.../project> --file <path> [--id <targetId>] [--outPath <file>] [--addr 127.0.0.1] [--port 9222] [--waitMs 3000] [--timeoutMs 180000]\n",
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

function readHref(wsUrl) {
  try {
    const resp = cdpEvaluate(wsUrl, "(() => String(location.href || ''))()", { timeoutMs: 10000 });
    return resp && resp.result && resp.result.result ? String(resp.result.result.value || "") : "";
  } catch (_) {
    return "";
  }
}

function uploadViaFileChooser(wsUrl, filePath, timeoutMs) {
  const selector = 'input[type="file"]:not(#upload-files):not(#upload-photos):not(#upload-camera)';
  const raw = runToString([
    "cdp-bridge",
    "filechooser",
    "--ws", String(wsUrl),
    "--selector", selector,
    "--file", String(filePath),
    "--timeout-ms", String(timeoutMs || 120000),
  ]);
  return { selector, raw: raw.trim(), parsed: JSON.parse(raw) };
}

function uploadViaDirectFileInput(wsUrl, filePath, timeoutMs) {
  const selector = 'input[type="file"]:not(#upload-files):not(#upload-photos):not(#upload-camera)';
  const raw = runToString([
    "cdp-bridge",
    "filechooser",
    "--ws", String(wsUrl),
    "--selector", selector,
    "--file", String(filePath),
    "--click-mode", "direct",
    "--timeout-ms", String(timeoutMs || 120000),
  ]);
  return { selector, mode: "direct_dom_set_file_input_files", raw: raw.trim(), parsed: JSON.parse(raw) };
}

function uploadProjectSourceFile(wsUrl, filePath, timeoutMs) {
  const attempts = [];
  try {
    const direct = uploadViaDirectFileInput(wsUrl, filePath, timeoutMs);
    return { ok: true, selectedMode: "direct", attempts: [{ mode: "direct", ok: true, result: direct }] };
  } catch (e) {
    attempts.push({ mode: "direct", ok: false, error: String(e && e.message ? e.message : e).slice(0, 2000) });
  }

  try {
    const mouse = uploadViaFileChooser(wsUrl, filePath, timeoutMs);
    return { ok: true, selectedMode: "mouse_filechooser", attempts: attempts.concat([{ mode: "mouse_filechooser", ok: true, result: mouse }]) };
  } catch (e) {
    attempts.push({ mode: "mouse_filechooser", ok: false, error: String(e && e.message ? e.message : e).slice(0, 2000) });
  }

  return { ok: false, selectedMode: null, attempts };
}

function confirmUploadAnywayIfPresent(wsUrl, timeoutMs) {
  const deadline = Date.now() + Math.min(Number(timeoutMs) || 0, 15000);
  let last = null;
  while (true) {
    const resp = cdpCall(wsUrl, {
      id: 91,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const body = String(document.body && document.body.innerText || '');
          const buttons = Array.from(document.querySelectorAll('button,[role="button"]'));
          const button = buttons.find((b) => String(b.innerText || b.textContent || '').trim() === 'Upload anyway');
          if (!button) return { ok: true, clicked: false, modalPresent: body.includes('Upload anyway') || body.includes('File already exists') };
          try { button.click(); } catch (_) {}
          return { ok: true, clicked: true, modalPresent: true };
        })()`,
        returnByValue: true,
        awaitPromise: false,
        userGesture: true,
      },
    }, 30000);
    last = resp && resp.result && resp.result.result ? resp.result.result.value : null;
    if (last && last.clicked) return last;
    if (!last || !last.modalPresent) return last || { ok: true, clicked: false, modalPresent: false };
    if (Date.now() >= deadline) return last;
    sleepMs(500);
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
  try { cdpEvaluate(wsUrl, "(() => { try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); } catch (_) {} return true; })()", { timeoutMs: 30000 }); } catch (_) {}
  sleepMs(args.waitMs);

  const fileName = basename(args.file);
  const upload = uploadProjectSourceFile(wsUrl, args.file, args.timeoutMs);
  const duplicateConfirm = confirmUploadAnywayIfPresent(wsUrl, args.timeoutMs);
  const visible = cdpEvaluate(wsUrl, waitForProjectSourceVisibleExpr(fileName, args.timeoutMs), {
    awaitPromise: true,
    returnByValue: true,
    timeoutMs: args.timeoutMs + 10000,
  });
  const visibleValue = visible && visible.result && visible.result.result ? visible.result.result.value : null;
  const result = {
    ok: !!(upload && upload.ok && visibleValue && visibleValue.ok),
    projectUrl: args.projectUrl,
    sourcesUrl: url,
    target: { id: target.id, url: target.url, title: target.title },
    file: { path: args.file, name: fileName },
    upload,
    duplicateConfirm,
    visible: visibleValue,
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
