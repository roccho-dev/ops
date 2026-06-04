// Recover a named artifact set from a ChatGPT thread.
//
// This handles the case where a response names files in a markdown table, but
// ChatGPT does not expose them as real downloadable artifact chips.

import * as os from "./qjs-compat/os.mjs";
import * as std from "./qjs-compat/std.mjs";
import zip from "./qjs-compat/zip.mjs";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

import { extractConversationId, listPageTargets, previewTargets } from "./chatgpt/index.mjs";
import { requireCdp } from "./connect.mjs";
import { buildDownloadedNameRegex, copyFile, joinPath, listDir, mkdirp, tryStat } from "./fs.mjs";
import { basename, fileSha256, fileSize, pathExists, runCapture, writeJson } from "./host-git-ops.mjs";
import { cdpCall, getDefaultAddr, getDefaultPort, mkCaller, parseArgs, run, sleepMs } from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-recover-artifact-set.mjs --url <thread-url> --outDir <dir> --name <file> [--name <file> ...] [--addr 127.0.0.1] [--port <n>] [--id <targetId>] [--downloadsDir <dir> ...] [--sourceZip <zip>] [--noMaterialize] [--json]\n",
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
      names: [],
      downloadsDirs: [],
      sourceZip: null,
      materialize: true,
      timeoutMs: 120000,
      pollMs: 250,
      json: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: {},
      id: {},
      outDir: {},
      names: { name: "--name", multiple: true },
      downloadsDirs: { name: "--downloadsDir", multiple: true },
      sourceZip: {},
      materialize: { name: "--noMaterialize", type: "boolean", value: false },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
      pollMs: { parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => {
      if (!out.url || !out.outDir || !Array.isArray(out.names) || out.names.length === 0) return null;
      out.downloadsDirs = normalizeDownloadDirs(out.downloadsDirs);
      return out;
    },
  });
}

function unique(items) {
  const out = [];
  const seen = Object.create(null);
  for (const item of items || []) {
    const value = String(item || "").replace(/\/+$/, "");
    if (!value || seen[value]) continue;
    seen[value] = true;
    out.push(value);
  }
  return out;
}

function isDir(path) {
  const st = tryStat(path);
  return !!(st && (st.mode & 0o040000));
}

function normalizeDownloadDirs(input) {
  const dirs = [];
  for (const dir of input || []) dirs.push(dir);
  const home = String(std.getenv("HOME") || "");
  if (home) dirs.push(`${home}/Downloads`);

  // WSL convenience: ChatGPT browser downloads are often in Windows Downloads.
  if (isDir("/mnt/c/Users")) {
    for (const user of listDir("/mnt/c/Users")) {
      if (!user || user === "." || user === "..") continue;
      const base = `/mnt/c/Users/${user}/Downloads`;
      if (isDir(base)) {
        dirs.push(base);
        if (isDir(`${base}/chrome`)) dirs.push(`${base}/chrome`);
      }
    }
  }
  return unique(dirs).filter(isDir);
}

function pickTarget(targets, args) {
  const pages = listPageTargets(targets);
  if (args.id) {
    const exact = pages.find((page) => String(page.id || "") === String(args.id));
    if (!exact) throw new Error(`target not found by --id: ${args.id}`);
    return exact;
  }

  const url = String(args.url || "");
  let candidates = pages.filter((page) => String(page.url || "") === url);
  if (candidates.length === 0) candidates = pages.filter((page) => String(page.url || "").startsWith(url));
  if (candidates.length === 0) {
    const cid = extractConversationId(url);
    if (cid) candidates = pages.filter((page) => String(page.url || "").includes(cid));
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => String(b.title || "").length - String(a.title || "").length);
    return candidates[0];
  }

  throw new Error(`no matching ChatGPT target found:\n${JSON.stringify(previewTargets(pages), null, 2)}`);
}

function exactLocalMatches(name, dirs) {
  const rx = buildDownloadedNameRegex(name);
  const rows = [];
  for (const dir of dirs || []) {
    let names = [];
    try { names = listDir(dir); } catch { continue; }
    for (const entry of names) {
      if (!entry || entry === "." || entry === ".." || !rx.test(entry)) continue;
      const path = joinPath(dir, entry);
      const st = tryStat(path);
      if (!st || (st.mode & 0o040000)) continue;
      rows.push({
        name: entry,
        requestedName: name,
        path,
        size: Number(st.size) || 0,
        mtime: Number(st.mtime) || 0,
      });
    }
  }
  rows.sort((a, b) => (b.mtime - a.mtime) || (b.size - a.size));
  return rows;
}

function waitForDownload(name, dirs, baseline, timeoutMs, pollMs) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const seen = baseline || Object.create(null);
  while (Date.now() <= deadline) {
    for (const row of exactLocalMatches(name, dirs)) {
      if (String(row.name || "").endsWith(".crdownload")) continue;
      const key = `${row.path}:${row.size}:${row.mtime}`;
      if (!seen[key]) return row;
    }
    sleepMs(Math.max(1, pollMs));
  }
  return null;
}

function baselineFor(name, dirs) {
  const seen = Object.create(null);
  for (const row of exactLocalMatches(name, dirs)) {
    seen[`${row.path}:${row.size}:${row.mtime}`] = true;
  }
  return seen;
}

function scanThreadExpr(names) {
  const namesJson = JSON.stringify(names || []);
  return `(async () => {
    const names = ${namesJson};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const attr = (el, name) => el ? String(el.getAttribute(name) || "") : "";
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const classify = (el) => {
      const link = el.closest ? el.closest("a[href]") : null;
      const href = attr(link || el, "href");
      const download = attr(link || el, "download");
      const aria = attr(el, "aria-label");
      const cls = String(el.className || "");
      if (href.includes("sandbox:/") || download) return "downloadable";
      if (link && href) return "link";
      if (el.tagName === "BUTTON" && cls.includes("behavior-btn") && !aria && !href && !download) return "inline_reference";
      if (el.tagName === "BUTTON") return "file_chip_candidate";
      return "text_reference";
    };
    const scanNow = () => {
      const candidates = Array.from(document.querySelectorAll("button,a,[role=button],span,td"));
      const byName = {};
      for (const name of names) {
        byName[name] = candidates
          .filter((el) => {
            const text = norm(el.innerText || el.textContent);
            return text === name ||
              norm(attr(el, "aria-label")) === name ||
              norm(attr(el, "title")) === name ||
              attr(el, "href").includes(name) ||
              attr(el, "download").includes(name);
          })
          .slice(0, 20)
          .map((el) => ({
            tag: el.tagName,
            kind: classify(el),
            text: norm(el.innerText || el.textContent).slice(0, 400),
            aria: norm(attr(el, "aria-label")).slice(0, 240),
            href: attr(el.closest ? el.closest("a[href]") : null, "href") || attr(el, "href"),
            download: attr(el.closest ? el.closest("a[href]") : null, "download") || attr(el, "download"),
            className: String(el.className || "").slice(0, 180),
            rect: rectOf(el),
          }));
      }
      return byName;
    };

    const root = document.querySelector("[data-scroll-root]") || document.scrollingElement || document.documentElement;
    const max = Math.max(0, (root.scrollHeight || 0) - (root.clientHeight || 0));
    const originalTop = Number(root.scrollTop || window.scrollY || 0);
    const steps = [];
    for (let y = max; y >= 0; y -= 1200) {
      root.scrollTop = y;
      await sleep(450);
      const byName = scanNow();
      const hitCounts = Object.fromEntries(Object.entries(byName).map(([name, rows]) => [name, rows.length]));
      steps.push({ top: Math.round(root.scrollTop || 0), hitCounts });
      if (Object.values(hitCounts).some((count) => count > 0)) {
        return {
          ok: true,
          href: location.href,
          title: document.title,
          root: { tag: root.tagName, maxScroll: max, foundTop: Math.round(root.scrollTop || 0), originalTop },
          byName,
          steps,
        };
      }
    }
    root.scrollTop = originalTop;
    return {
      ok: false,
      href: location.href,
      title: document.title,
      root: { tag: root.tagName, maxScroll: max, originalTop },
      byName: scanNow(),
      steps,
    };
  })()`;
}

function clickExactByNameExpr(name) {
  const nameJson = JSON.stringify(String(name || ""));
  return `(() => {
    const name = ${nameJson};
    const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll("a[href],button,[role=button]"));
    const el = candidates.find((node) =>
      norm(node.innerText || node.textContent) === name ||
      norm(node.getAttribute("aria-label")) === name ||
      norm(node.getAttribute("title")) === name ||
      String(node.getAttribute("href") || "").includes(name) ||
      String(node.getAttribute("download") || "").includes(name)
    );
    if (!el) return { ok: false, reason: "not_found" };
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
    const r = el.getBoundingClientRect();
    try { el.click(); } catch (error) { return { ok: false, reason: "click_failed", error: String(error), rect: { x: r.x, y: r.y, w: r.width, h: r.height } }; }
    return {
      ok: true,
      tag: el.tagName,
      text: norm(el.innerText || el.textContent),
      aria: norm(el.getAttribute("aria-label")),
      href: String(el.getAttribute("href") || ""),
      download: String(el.getAttribute("download") || ""),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  })()`;
}

function callEval(caller, expression, opts) {
  return caller.evalValue(expression, opts || { timeoutMs: 30000 });
}

function copyIntoOutDir(src, outDir, requestedName, sourceKind) {
  mkdirp(outDir);
  const dest = joinPath(outDir, requestedName || basename(src));
  copyFile(src, dest);
  return {
    name: requestedName || basename(src),
    ok: true,
    source: sourceKind,
    path: dest,
    sourcePath: src,
    size: fileSize(dest),
    sha256: fileSha256(dest),
  };
}

function tmpPath(prefix) {
  return `/tmp/${prefix}_${os.getpid()}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function materializeFromZip(sourceZip, outDir, names) {
  // 脱python: python zipfile を node 純正 zip(qjs-compat/zip.mjs)で置換。
  mkdirSync(outDir, { recursive: true });
  const allEntries = zip.entries(sourceZip);
  const entryNames = allEntries.map((e) => e.name);
  let manifest = {};
  if (entryNames.includes("result.manifest.json")) {
    manifest = JSON.parse(zip.readEntry(sourceZip, "result.manifest.json").toString("utf8"));
  }
  const packages = Array.isArray(manifest.packages) ? manifest.packages.map(String) : [];

  for (const name of names) {
    const outPath = joinPath(outDir, name);
    if (basename(sourceZip) === name) {
      if (!pathExists(outPath)) copyFileSync(sourceZip, outPath);
      continue;
    }
    if (name.endsWith(".acceptance-report.json")) {
      const entry = "spec/package-graph/acceptance-report.json";
      if (!entryNames.includes(entry)) continue;
      writeFileSync(outPath, zip.readEntry(sourceZip, entry));
      continue;
    }
    if (name.endsWith(".spec-package-set.zip")) {
      if (!packages.length) continue;
      const includePrefixes = ["spec/package-graph/", ...packages.map((p) => `spec/packages/${p}/`)];
      const includeExact = new Set(["result.manifest.json", "README.package-spec-v0.3.0.md"]);
      const items = [];
      for (const e of [...entryNames].sort()) {
        const eNorm = e.replace(/\\/g, "/");
        if (includeExact.has(eNorm) || includePrefixes.some((p) => eNorm.startsWith(p))) {
          const meta = allEntries.find((x) => x.name === e);
          items.push({ name: eNorm, data: zip.readEntry(sourceZip, e), externalAttr: meta ? meta.externalAttr : 0 });
        }
      }
      zip.writeZip(outPath, items);
    }
  }

  {
    const rows = [];
    for (const name of names) {
      const path = joinPath(outDir, name);
      if (!pathExists(path)) continue;
      let source = "materialized";
      if (name.endsWith(".acceptance-report.json")) source = "materialized_acceptance_report";
      else if (name.endsWith(".spec-package-set.zip")) source = "materialized_package_set";
      else if (basename(sourceZip) === name) source = "source_zip_copy";
      rows.push({ name, ok: true, source, path, size: fileSize(path), sha256: fileSha256(path) });
    }
    const checksumNames = names.filter((name) => name.endsWith(".checksums.json"));
    for (const name of checksumNames) {
      const path = joinPath(outDir, name);
      const payload = {
        kind: "artifactSetRecovery.checksums.v1",
        source: "materialized-from-integrated-zip",
        sourceZip: basename(sourceZip),
        files: Object.fromEntries(rows.filter((row) => !row.name.endsWith(".checksums.json")).map((row) => [row.name, row.sha256])),
      };
      writeJson(path, payload);
      rows.push({ name, ok: true, source: "materialized_checksums", path, size: fileSize(path), sha256: fileSha256(path) });
    }
    return rows;
  }
}

function writeMarkdownReport(path, result) {
  const lines = [];
  lines.push("# ChatGPT artifact set recovery");
  lines.push("");
  lines.push(`- url: \`${result.url}\``);
  lines.push(`- target: \`${result.target && result.target.id || ""}\``);
  lines.push(`- outDir: \`${result.outDir}\``);
  lines.push(`- sourceZip: \`${result.sourceZip || ""}\``);
  lines.push("");
  lines.push("| name | state | source | path | sha256 |");
  lines.push("|---|---|---|---|---|");
  for (const row of result.results || []) {
    lines.push(`| \`${row.name || ""}\` | ${row.ok ? "ok" : "missing"} | ${row.source || ""} | \`${row.path || ""}\` | \`${row.sha256 || ""}\` |`);
  }
  lines.push("");
  lines.push("## CDP classification");
  lines.push("");
  lines.push("| name | kind | count |");
  lines.push("|---|---|---:|");
  for (const row of result.cdpClassification || []) {
    lines.push(`| \`${row.name}\` | ${row.kinds.join(", ") || "not_found"} | ${row.count} |`);
  }
  std.writeFile(path, lines.join("\n") + "\n");
}

function main(args) {
  mkdirp(args.outDir);

  const conn = requireCdp(args.addr, args.port);
  const target = pickTarget(conn.targets, args);
  const caller = mkCaller(target.webSocketDebuggerUrl);
  try { caller.call("Page.bringToFront", {}, 5000); } catch {}

  const scan = callEval(caller, scanThreadExpr(args.names), { awaitPromise: true, timeoutMs: args.timeoutMs }) || {};
  const byName = scan.byName || {};

  const resultsByName = Object.create(null);
  let sourceZip = args.sourceZip && pathExists(args.sourceZip) ? args.sourceZip : null;

  for (const name of args.names) {
    const local = exactLocalMatches(name, args.downloadsDirs)[0] || null;
    if (local) {
      const copied = copyIntoOutDir(local.path, args.outDir, name, "local_download");
      copied.actualName = local.name;
      resultsByName[name] = copied;
      if (!sourceZip && name.endsWith(".zip")) sourceZip = copied.path;
      continue;
    }

    const hits = Array.isArray(byName[name]) ? byName[name] : [];
    const downloadable = hits.find((hit) => hit.kind === "downloadable" || hit.kind === "file_chip_candidate");
    if (downloadable) {
      const baseline = baselineFor(name, args.downloadsDirs);
      try {
        cdpCall(target.webSocketDebuggerUrl, {
          id: 9001,
          method: "Page.setDownloadBehavior",
          params: { behavior: "allow", downloadPath: args.downloadsDirs[0] || args.outDir },
        }, 5000);
      } catch {}
      const click = callEval(caller, clickExactByNameExpr(name), { timeoutMs: 10000 }) || {};
      const downloaded = click.ok ? waitForDownload(name, args.downloadsDirs, baseline, args.timeoutMs, args.pollMs) : null;
      if (downloaded) {
        const copied = copyIntoOutDir(downloaded.path, args.outDir, name, "cdp_download");
        copied.actualName = downloaded.name;
        copied.click = click;
        resultsByName[name] = copied;
        if (!sourceZip && name.endsWith(".zip")) sourceZip = copied.path;
        continue;
      }
      resultsByName[name] = { name, ok: false, source: "cdp_download", error: click.ok ? "download_timeout" : (click.reason || "click_failed"), click };
      continue;
    }

    const inline = hits.length > 0;
    resultsByName[name] = {
      name,
      ok: false,
      source: inline ? "inline_reference" : "not_found",
      error: inline ? "name exists in thread text but is not a downloadable artifact" : "name not found in thread",
    };
  }

  if (args.materialize && sourceZip) {
    const missingNames = args.names.filter((name) => !(resultsByName[name] && resultsByName[name].ok));
    if (missingNames.length > 0) {
      for (const row of materializeFromZip(sourceZip, args.outDir, missingNames)) {
        resultsByName[row.name] = row;
      }
    }
  }

  const results = args.names.map((name) => resultsByName[name] || { name, ok: false, source: "not_found" });
  const cdpClassification = args.names.map((name) => {
    const hits = Array.isArray(byName[name]) ? byName[name] : [];
    const kinds = unique(hits.map((hit) => hit.kind || "unknown"));
    return { name, count: hits.length, kinds };
  });

  const out = {
    ok: results.every((row) => row && row.ok),
    url: args.url,
    outDir: args.outDir,
    downloadsDirs: args.downloadsDirs,
    target: { id: target.id, title: target.title, url: target.url },
    sourceZip,
    scan: {
      ok: scan.ok === true,
      root: scan.root || null,
      steps: scan.steps || [],
    },
    cdpClassification,
    results,
  };
  const reportJson = joinPath(args.outDir, "artifact-recovery-report.json");
  const reportMd = joinPath(args.outDir, "artifact-recovery-report.md");
  writeJson(reportJson, out);
  writeMarkdownReport(reportMd, out);
  out.reportJson = reportJson;
  out.reportMd = reportMd;

  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else {
    std.out.puts(`ok: ${out.ok ? "true" : "false"}\n`);
    std.out.puts(`report: ${reportMd}\n`);
    for (const row of results) {
      std.out.puts(`- ${row.ok ? "ok" : "missing"} ${row.name}: ${row.source || ""} ${row.path || row.error || ""}\n`);
    }
  }
  return out.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
