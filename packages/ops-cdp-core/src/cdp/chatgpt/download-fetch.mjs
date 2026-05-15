import * as std from "qjs:std";
import { clickSandboxLinkExpr, locateDownloadArtifactExpr, locateFileChipExpr } from "./artifacts.mjs";
import { mouseClick } from "./input.mjs";
import { buildDownloadedNameRegex, copyFile, joinPath, listMatchingFiles, moveFile, tryStat } from "../fs.mjs";
import { runToString, sleepMs } from "../lib.mjs";

function shellQuote(value) {
  return "'" + String(value || "").replace(/'/g, "'\\''") + "'";
}

function sandboxPathFromHref(href) {
  const value = String(href || "");
  if (!value.startsWith("sandbox:")) return "";
  return value.slice("sandbox:".length);
}

function installSandboxFetchCaptureExpr(name, sandboxHref) {
  const nameJson = JSON.stringify(String(name || ""));
  const hrefJson = JSON.stringify(String(sandboxHref || ""));
  return `(() => {
    const targetName = ${nameJson};
    const targetHref = ${hrefJson};
    const targetPath = targetHref.startsWith('sandbox:') ? targetHref.slice('sandbox:'.length) : targetHref;
    const original = window.__hq_fetch_artifact_orig_fetch || window.__hq_orig_fetch || window.fetch;
    window.__hq_fetch_artifact_orig_fetch = original;
    window.__hq_artifact_cache = window.__hq_artifact_cache || {};
    window.__hq_artifact_last_headers = null;
    window.fetch = async function(input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : String(input && input.url || input); } catch (e) { url = String(input); }
      const isTarget = url.includes('/interpreter/download') &&
        decodeURIComponent(url).includes(targetPath);
      if (isTarget) {
        const headers = {};
        try {
          const h = new Headers((init && init.headers) || (input && input.headers) || undefined);
          for (const [k, v] of h.entries()) headers[k] = v;
        } catch (_) {}
        window.__hq_artifact_last_headers = { url, headers, capturedAt: new Date().toISOString() };
      }
      const res = await original.apply(this, arguments);
      if (isTarget) {
        try {
          const clone = res.clone();
          const headers = {};
          for (const [k, v] of clone.headers.entries()) headers[k] = v;
          const ab = await clone.arrayBuffer();
          const bytes = new Uint8Array(ab);
          const chunkSize = 24576;
          let base64 = '';
          for (let i = 0; i < bytes.length; i += chunkSize) {
            let s = '';
            const chunk = bytes.slice(i, i + chunkSize);
            for (let j = 0; j < chunk.length; j++) s += String.fromCharCode(chunk[j]);
            base64 += btoa(s);
          }
          window.__hq_artifact_cache[targetName] = {
            ok: clone.ok,
            status: clone.status,
            statusText: clone.statusText,
            headers,
            len: bytes.length,
            firstHex: Array.from(bytes.slice(0, 16)).map((x) => x.toString(16).padStart(2, '0')).join(''),
            base64,
            url,
            capturedAt: new Date().toISOString(),
          };
        } catch (error) {
          window.__hq_artifact_cache[targetName] = { ok: false, error: String(error && error.stack || error), url };
        }
      }
      return res;
    };
    return { ok: true, targetName, targetPath };
  })()`;
}

function readSandboxFetchCaptureExpr(name) {
  const nameJson = JSON.stringify(String(name || ""));
  return `(async () => {
    const targetName = ${nameJson};
    const zipLike = (row) => row && row.firstHex && String(row.firstHex).startsWith('504b') && Number(row.len) > 0;
    const cached = (window.__hq_artifact_cache || {})[targetName];
    if (zipLike(cached)) return { ...cached, source: 'captured_response' };

    const source = window.__hq_artifact_last_headers;
    if (!source || !source.url || !source.headers) {
      return { ok: false, reason: 'sandbox_fetch_not_captured', cached };
    }

    const headers = { ...source.headers };
    const r = await window.__hq_fetch_artifact_orig_fetch(source.url, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    const respHeaders = {};
    for (const [k, v] of r.headers.entries()) respHeaders[k] = v;
    const ab = await r.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const firstHex = Array.from(bytes.slice(0, 16)).map((x) => x.toString(16).padStart(2, '0')).join('');
    let firstText = '';
    for (let i = 0; i < Math.min(bytes.length, 80); i++) firstText += String.fromCharCode(bytes[i]);
    const attempt = {
      status: r.status,
      ok: r.ok,
      len: bytes.length,
      contentType: respHeaders['content-type'] || '',
      firstHex,
      firstText,
    };
    if (firstHex.startsWith('504b') && bytes.length > 0) {
      const chunkSize = 24576;
      let base64 = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        let s = '';
        const chunk = bytes.slice(i, i + chunkSize);
        for (let j = 0; j < chunk.length; j++) s += String.fromCharCode(chunk[j]);
        base64 += btoa(s);
      }
      return {
        ok: true,
        status: r.status,
        headers: respHeaders,
        len: bytes.length,
        firstHex,
        base64,
        url: source.url,
        attempt,
        capturedAt: new Date().toISOString(),
      };
    }
    return { ok: false, reason: 'sandbox_interpreter_retry', attempt, url: source.url };
  })()`;
}

function writeBase64File(base64, dest) {
  const tmp = `${dest}.base64.${Date.now()}.${Math.floor(Math.random() * 1000000)}`;
  std.writeFile(tmp, String(base64 || ""));
  try {
    runToString(`base64 -d ${shellQuote(tmp)} > ${shellQuote(dest)}`);
  } finally {
    try { runToString(["rm", "-f", tmp]); } catch {}
  }
}

function clickResolvedTarget(call, evalByValue, target, afterClickMs) {
  const row = target || {};
  const locator = row.locator || {};
  const name = String(row.name || "");
  const kind = String(locator.kind || "");
  if (kind === "sandbox_link" && locator.href) {
    const clicked = evalByValue(clickSandboxLinkExpr(locator.href), 60000);
    if (!clicked || clicked.ok !== true) {
      throw new Error(`sandbox link click failed: ${JSON.stringify(clicked)}`);
    }
    sleepMs(afterClickMs);
    return;
  }

  let loc = evalByValue(locateDownloadArtifactExpr(name), 60000);
  if ((!loc || !loc.ok) && kind === "chip") {
    loc = evalByValue(locateFileChipExpr(name), 60000);
  }
  if (!loc || !loc.ok) {
    throw new Error(`download target not found in page: ${name}`);
  }

  mouseClick(call, loc.x, loc.y);
  sleepMs(afterClickMs);
}

function defaultBrowserDownloadsDir() {
  const home = String(std.getenv("HOME") || "");
  return home ? `${home}/Downloads` : "";
}

function uniqNonEmpty(values) {
  const out = [];
  const seen = new Set();
  for (const value of (Array.isArray(values) ? values : [])) {
    const path = String(value || "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function buildWatchDirs(options) {
  const explicit = [];
  if (Array.isArray(options.downloadsDirs)) explicit.push(...options.downloadsDirs);
  if (options.downloadsDir) explicit.push(options.downloadsDir);
  const fallback = defaultBrowserDownloadsDir();
  return uniqNonEmpty([...explicit, fallback]);
}

function listMatchingFilesFromDirs(dirs, nameRegex) {
  const out = [];
  for (const dir of uniqNonEmpty(dirs)) {
    try {
      const rows = listMatchingFiles(dir, nameRegex);
      for (const row of rows) out.push({ ...row, dir });
    } catch {
      // ignore unreadable/missing dirs so fallback watch dirs stay cheap
    }
  }
  out.sort((a, b) => (b.mtime - a.mtime) || (b.size - a.size));
  return out;
}

function baselineKey(file) {
  return `${String(file && file.dir || "")}//${String(file && file.name || "")}`;
}

function waitForDownloadedFile(watchDirs, name, baselineSet, startMs, timeoutMs, pollMs) {
  const nameRegex = buildDownloadedNameRegex(name);
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let newestAny = null;
  while (Date.now() < deadline) {
    const allNew = listMatchingFilesFromDirs(watchDirs, /.*/)
      .filter((f) => !baselineSet.has(baselineKey(f)))
      .filter((f) => f.mtime >= startMs - 1000)
      .filter((f) => !String(f.name).endsWith(".crdownload"));
    const cands = allNew.filter((f) => nameRegex.test(String(f.name || "")));
    if (!newestAny && allNew.length > 0) newestAny = allNew[0];

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
        return pick;
      }
    }

    sleepMs(pollMs);
  }

  if (!newestAny) return null;
  const st1 = tryStat(newestAny.path);
  sleepMs(200);
  const st2 = tryStat(newestAny.path);
  if (st1 && st2 && Number(st1.size) === Number(st2.size)) return newestAny;
  return null;
}

export function fetchResolvedDownloadTargets(call, evalByValue, targets, opts) {
  const options = opts || {};
  const outDir = String(options.outDir || "");
  const downloadsDir = String(options.downloadsDir || "");
  const watchDirs = buildWatchDirs(options);
  const mode = String(options.mode || "copy");
  const reuseExisting = options.reuseExisting === true;
  const evalByValueAsync = typeof options.evalByValueAsync === "function" ? options.evalByValueAsync : null;
  const timeoutMs = Number(options.timeoutMs) || 120000;
  const pollMs = Number(options.pollMs) || 200;
  const afterClickMs = Number(options.afterClickMs) || 200;

  const results = [];
  for (const target of (Array.isArray(targets) ? targets : [])) {
    const row = {
      name: String(target && target.name || ""),
      ok: false,
      locator: target && target.locator ? target.locator : null,
      watch_dirs: watchDirs,
    };
    try {
      const nameRegex = buildDownloadedNameRegex(row.name);
      const existing = listMatchingFilesFromDirs(watchDirs, nameRegex);
      if (reuseExisting && existing.length > 0) {
        const pick = existing.find((x) => x.name === row.name) || existing[0];
        const dest = joinPath(outDir, row.name);
        if (mode === "move") moveFile(pick.path, dest);
        else copyFile(pick.path, dest);
        row.ok = true;
        row.reused_existing = true;
        row.downloads_src = pick.path;
        row.out_path = dest;
        row.bytes = pick.size;
        results.push(row);
        continue;
      }

      const baselineSet = new Set(listMatchingFilesFromDirs(watchDirs, /.*/).map((x) => baselineKey(x)));
      const startMs = Date.now();
      const locator = target && target.locator ? target.locator : {};
      const sandboxHref = String(locator.href || "");
      const hasSandboxFallback = sandboxHref.startsWith("sandbox:");
      if (hasSandboxFallback) {
        const installed = evalByValue(installSandboxFetchCaptureExpr(row.name, sandboxHref), 60000);
        row.sandbox_href = sandboxHref;
        row.sandbox_path = sandboxPathFromHref(sandboxHref);
        row.sandbox_fetch_capture = installed && installed.ok === true ? "installed" : "install_failed";
      }
      clickResolvedTarget(call, evalByValue, target, afterClickMs);
      const downloaded = waitForDownloadedFile(watchDirs, row.name, baselineSet, startMs, timeoutMs, pollMs);
      if (!downloaded) {
        if (hasSandboxFallback) {
          const captureExpr = readSandboxFetchCaptureExpr(row.name);
          const attempts = [];
          const maxAttempts = Math.max(2, Math.ceil(timeoutMs / Math.max(1, pollMs * 4)));
          const delayMs = Math.max(250, pollMs * 4);
          let captured = null;
          for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
            captured = evalByValueAsync
              ? evalByValueAsync(captureExpr, Math.min(10000, timeoutMs + 1000))
              : evalByValue(captureExpr, Math.min(10000, timeoutMs + 1000));
            const attempt = captured && captured.attempt ? { ...captured.attempt, attempt: attemptNo } : null;
            if (attempt) attempts.push(attempt);
            if (captured && captured.ok === true && captured.base64) break;
            if (attemptNo < maxAttempts) sleepMs(delayMs);
          }
          row.sandbox_fetch = captured ? {
            ok: captured.ok === true,
            status: captured.status || null,
            len: Number(captured.len) || 0,
            firstHex: String(captured.firstHex || ""),
            reason: String(captured.reason || ""),
            attempts,
            url: String(captured.url || ""),
          } : { ok: false, reason: "no_capture_result" };
          if (captured && captured.ok === true && captured.base64) {
            const dest = joinPath(outDir, row.name);
            writeBase64File(captured.base64, dest);
            const st = tryStat(dest);
            row.ok = true;
            row.out_path = dest;
            row.bytes = st ? Number(st.size) || Number(captured.len) || 0 : Number(captured.len) || 0;
            row.downloads_src = "cdp_sandbox_interpreter_fetch";
            results.push(row);
            continue;
          }
        }
        row.error = String(target && target.locator && target.locator.kind || "") === "sandbox_link"
          ? "sandbox_link_download_failed"
          : "download_timeout";
        results.push(row);
        continue;
      }

      const actualName = String(downloaded.name || row.name);
      const dest = joinPath(outDir, actualName);
      if (mode === "move") moveFile(downloaded.path, dest);
      else copyFile(downloaded.path, dest);

      row.ok = true;
      row.actual_name = actualName;
      row.filename_mismatch = actualName !== row.name;
      row.downloads_src = downloaded.path;
      row.out_path = dest;
      row.bytes = downloaded.size;
    } catch (e) {
      row.error = String(e && e.message ? e.message : e);
    }
    results.push(row);
  }
  return results;
}
