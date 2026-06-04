// HQ helper: print thread status table and (optionally) collect worker artifacts.
// Runtime: quickjs-ng (qjs) with `--std`.
//
// This script is designed to guide LLM agents/operators to report:
// - Always paste the THREADS_STATUS table into your user-facing report.
// - Model confirmation is mandatory in worker answers.

import {
  cdpEvaluate,
  getDefaultAddr,
  getDefaultPort,
  parseArgs,
  run,
  sleepMs,
} from "./lib.mjs";

import * as std from "./qjs-compat/std.mjs";
import * as os from "./qjs-compat/os.mjs";
import { waitForDomModelExpr } from "./hq-dom-model.mjs";
import { SELECTORS, extractConversationId, openOrCreateChatGptTarget } from "./chatgpt/index.mjs";
import { requireCdp } from "./connect.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m hq-threads.mjs [--threadsFile <path>] [--outDir <path>] [--statusOnly] [--requireModelConfirmation] [--requireDomPro] [--addr 127.0.0.1] [--port 9222] [--waitMs 1500]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      threadsFile: null,
      outDir: null,
      waitMs: 1500,
      statusOnly: false,
      requireModelConfirmation: false,
      requireDomPro: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      threadsFile: {},
      outDir: {},
      waitMs: { parse: (raw, current) => Number(raw) || current },
      statusOnly: { type: "boolean" },
      requireModelConfirmation: { type: "boolean" },
      requireDomPro: { type: "boolean" },
    },
    onError: "null",
    finalize: (out) => {
      if (!out.outDir && !out.statusOnly) return null;
      return out;
    },
  });
}
function dirname(path) {
  const p = String(path || "");
  const i = p.lastIndexOf("/");
  if (i <= 0) return ".";
  return p.slice(0, i);
}

function loadJsonOrNull(path) {
  try {
    const raw = String(std.loadFile(path) || "");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function loadThreadsConfig(argv0, overridePath) {
  const selfDir = dirname(argv0 || "");
  const repoRoot = `${selfDir}/../..`;
  const defaultThreadsFile = `${selfDir}/../hq.zig/templates/chatgpt/threads.json`;

  const chosen = overridePath || std.getenv("HQ_THREADS_FILE") || defaultThreadsFile;
  const cfg = loadJsonOrNull(chosen);

  if (cfg && cfg.threads && Array.isArray(cfg.threads)) {
    const playbookRel = (cfg.playbook && cfg.playbook.path) ? String(cfg.playbook.path) : "parts/hq.zig/docs/chatgpt_playbook.md";
    return {
      threadsFile: chosen,
      repoRoot,
      playbookRel,
      playbookPath: `${repoRoot}/${playbookRel}`,
      threads: cfg.threads,
      modelConfirmation: cfg.model_confirmation || null,
    };
  }

  // Fallback: embedded defaults.
  return {
    threadsFile: chosen,
    repoRoot,
    playbookRel: "parts/hq.zig/docs/chatgpt_playbook.md",
    playbookPath: `${repoRoot}/parts/hq.zig/docs/chatgpt_playbook.md`,
    threads: [
      { name: "BO_01", kind: "worker", purpose: "tests/SSOT", url: "https://chatgpt.com/c/69abc2a4-a0c4-83ab-987d-ee17d5a96473", expect: "Hybrid v2 critique (all sections) + MODEL_CONFIRMATION(Pro=YES)" },
      { name: "HQ_CDP_02", kind: "worker", purpose: "adapter/CDP", url: "https://chatgpt.com/c/69abc32d-a9a4-83a4-a665-a087ce994bc8", expect: "Hybrid v2 critique (all sections) + MODEL_CONFIRMATION(Pro=YES)" },
      { name: "HQ_SELFTEST_01", kind: "worker", purpose: "selftest", url: "https://chatgpt.com/c/69abc3a7-e49c-83a3-be94-bb04e3be3733", expect: "Hybrid v2 critique (all sections) + MODEL_CONFIRMATION(Pro=YES)" },
      { name: "CONSULT_JS", kind: "consult", purpose: "architecture", url: "https://chatgpt.com/c/69b119c8-1c00-83ab-8686-2ea90f6bdf7e", expect: "Hybrid v2 critique (all sections) + MODEL_CONFIRMATION(Pro=YES)" },
      { name: "CONSULT_ZIG", kind: "consult", purpose: "architecture", url: "https://chatgpt.com/c/69b119cb-bc78-83a5-b05c-25616f2ad603", expect: "Hybrid v2 critique (all sections) + MODEL_CONFIRMATION(Pro=YES)" },
    ],
    modelConfirmation: null,
  };
}

function ensureDir(path) {
  try {
    os.mkdir(path, 0o755);
  } catch (e) {
    // ignore if exists
  }
}

function openOrFind(conn, args, url) {
  const openedRes = openOrCreateChatGptTarget(conn, url, { purpose: "hq-threads", checkSession: false });
  const opened = openedRes.target;
  if (!openedRes.created) return opened;
  try {
    const resp = cdpEvaluate(opened.webSocketDebuggerUrl, waitForDomModelExpr(8000), {
      id: 101,
      returnByValue: true,
      awaitPromise: true,
      timeoutMs: 20000,
    });
    const v = resp && resp.result && resp.result.result ? resp.result.result.value : null;
    if (!v || !v.found || v.pro_model !== true) {
      const model = v ? String(v.model_text || v.model_aria || "") : "";
      std.err.puts(`DOM_MODEL_ALERT: non-Pro or unknown model after auto-open: ${String(url)} :: ${model}\n`);
      std.err.flush();
    }
  } catch {
    std.err.puts(`DOM_MODEL_ALERT: failed to confirm model via DOM after auto-open: ${String(url)}\n`);
    std.err.flush();
  }

  return opened;
}

function findMatchingTargets(pages, threadUrl) {
  const url = String(threadUrl || "");
  let cands = pages.filter((t) => String(t.url || "") === url);
  if (cands.length === 0) cands = pages.filter((t) => String(t.url || "").startsWith(url));
  if (cands.length === 0) {
    const cid = extractConversationId(url);
    if (cid) cands = pages.filter((t) => String(t.url || "").includes(cid));
  }
  return cands;
}

function threadStatusExpr() {
  // Small, non-scraping status probe.
  return "(() => {\n" +
    "  const stop = !!(\n" +
    "    document.querySelector('button[data-testid=\\\"stop-button\\\"]') ||\n" +
    "    document.querySelector('button[aria-label=\\\"Stop generating\\\"]') ||\n" +
    "    document.querySelector('button[aria-label=\\\"Stop\\\"]')\n" +
    "  );\n" +
    "  const assistants = Array.from(document.querySelectorAll('[data-message-author-role=\\\"assistant\\\"]'));\n" +
    "  const rtrim = (s) => String(s || '').replace(/[ \\t]+$/, '');\n" +
    "  let txt = '';\n" +
    "  for (let i = assistants.length - 1; i >= 0; i--) {\n" +
    "    const t = String((assistants[i] && (assistants[i].innerText || assistants[i].textContent || '')) || '');\n" +
    "    if (t && t.trim().length) { txt = t; break; }\n" +
    "  }\n" +
    "  const mcLine = (() => {\n" +
    "    const lines = String(txt || '').split('\\n');\n" +
    "    for (let i = lines.length - 1; i >= 0; i--) {\n" +
    "      const raw = rtrim(String(lines[i] || ''));\n" +
    "      if (!raw.trim().length) continue;\n" +
    "      if (/^MODEL_CONFIRMATION\\s*:/i.test(raw)) return raw;\n" +
    "    }\n" +
    "    return '';\n" +
    "  })();\n" +
    "  const line = mcLine;\n" +
    "  const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');\n" +
    "  const modelBtn = document.querySelector('button[data-testid=\\\"model-switcher-dropdown-button\\\"]') || document.querySelector('button[aria-label*=\\\"Model selector\\\" i]') || document.querySelector('button[aria-label*=\\\"current model\\\" i]');\n" +
    "  const modelText = modelBtn ? String(modelBtn.innerText || modelBtn.textContent || '') : '';\n" +
    "  const modelAria = modelBtn ? String(modelBtn.getAttribute('aria-label') || '') : '';\n" +
    "  const proModel = /\\bpro\\b/i.test(modelText) || /\\bpro\\b/i.test(modelAria);\n" +
    "  const profileBtn = document.querySelector('[data-testid=\\\"accounts-profile-button\\\"]');\n" +
    "  const profileText = profileBtn ? String(profileBtn.innerText || profileBtn.textContent || '') : '';\n" +
    "  const proPlan = /\\bpro\\b/i.test(profileText);\n" +
    "  const btns = Array.from(document.querySelectorAll('main button'));\n" +
    "  const hits = [];\n" +
    "  for (const b of btns) {\n" +
    "    const cands = [b.innerText, b.getAttribute('aria-label'), b.getAttribute('title')]\n" +
    "      .map((s) => String(s || '').trim()).filter(Boolean);\n" +
    "    for (const s of cands) {\n" +
    "      if (/\\.(zip|tar\\.gz|tgz|txt|md|html|tsv)$/i.test(s)) hits.push(s);\n" +
    "    }\n" +
    "  }\n" +
    "  const files = Array.from(new Set(hits));\n" +
    "  const verdict = (() => {\n" +
    "    const m = String(txt || '').match(/\\bVERDICT\\b\\s*[:=]\\s*(PASS|FAIL)\\b/i) || String(txt || '').match(/\\bVerdict\\b\\s*:\\s*(PASS|FAIL)\\b/i);\n" +
    "    return m ? String(m[1] || '').toUpperCase() : '';\n" +
    "  })();\n" +
    "  return {\n" +
    "    href: (location && location.href) ? location.href : '',\n" +
    "    title: (document && document.title) ? document.title : '',\n" +
    "    readyState: (document && document.readyState) ? document.readyState : '',\n" +
    "    generating: stop,\n" +
    "    assistant_count: assistants.length,\n" +
    "    model_confirmation_present: !!line,\n" +
    "    model_confirmation_line: line,\n" +
    "    file_count: files.length,\n" +
    "    file_names: files,\n" +
    "    verdict: verdict,\n" +
    "    dom_model_found: !!modelBtn,\n" +
    "    dom_model_text: norm(modelText || modelAria),\n" +
    "    dom_model_aria: norm(modelAria),\n" +
    "    dom_pro_model: proModel,\n" +
    "    dom_profile_text: norm(profileText),\n" +
    "    dom_pro_plan_badge: proPlan,\n" +
    "  };\n" +
    "})()";
}

function parseModelConfirmation(line) {
  const raw = String(line || "").trim();
  if (!raw) return { present: false, pro: null, model: null, placeholder: true, raw: "" };
  const m = raw.match(/MODEL_CONFIRMATION\s*:\s*Pro\s*=\s*([^|]+)\|\s*MODEL\s*=\s*(.*)$/i);
  if (!m) return { present: true, pro: null, model: null, placeholder: true, raw };
  const proRaw = String(m[1] || "").trim().toUpperCase();
  const model = String(m[2] || "").trim();
  const pro = proRaw === "YES" ? true : proRaw === "NO" ? false : null;
  const m2 = (model || "").toLowerCase();
  const placeholder = !model || m2 === "unknown" || m2.includes("unavailable") || m2 === "unconfirmed";
  return { present: true, pro, model: model || null, placeholder, raw };
}

function mdEscape(s) {
  return String(s || "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function writeOptional(path, data) {
  if (!path) return;
  std.writeFile(path, data);
}

function computeExpectedStatus(t, r) {
  if (!r || r.open !== true) return "NO(open=0)";
  if (r.generating === true) return "WAIT(gen=1)";

  const expect = String((t && t.expect) ? t.expect : "");
  const needVerdict = /PASS\s*\/\s*FAIL/i.test(expect);
  if (needVerdict) return r.verdict ? `OK(${r.verdict})` : "NO(no_verdict)";

  const needFiles = /artifact|attachment|file chip|file chips|bundle|\.zip|tar\.gz/i.test(expect);
  const needMc = /MODEL_CONFIRMATION/i.test(expect);
  const needPro = /Pro\s*=\s*YES/i.test(expect);

  const hasFiles = Array.isArray(r.file_names) && r.file_names.length > 0;
  const mcOk = !!(
    r.model_confirmation &&
    r.model_confirmation.present === true &&
    r.model_confirmation.pro === true &&
    r.model_confirmation.placeholder !== true
  );
  const domProOk = !!(
    r.dom_model &&
    r.dom_model.found === true &&
    r.dom_model.pro_model === true
  );

  const required = [];
  if (needFiles) required.push(["files", hasFiles]);
  if (needMc) required.push(["mc", mcOk]);
  if (needPro) required.push(["dom_pro", domProOk]);

  const missing = required.filter((x) => x[1] !== true).map((x) => x[0]);
  if (missing.length === 0) return "OK";

  const presentCount = required.length - missing.length;
  const tag = `missing:${missing.join(",")}`;
  return presentCount > 0 ? `PARTIAL(${tag})` : `NO(${tag})`;
}

function renderStatusMarkdown(status) {
  const lines = [];
  lines.push("THREADS_STATUS");
  lines.push("");
  lines.push("NOTE_FOR_AGENTS: Paste this table into your user report.");
  lines.push("Model confirmation is REQUIRED in worker answers: `MODEL_CONFIRMATION: Pro=YES|NO | MODEL=<label>`.");
  lines.push("Playbook: run `hq playbook` (or open the file below).");
  lines.push("");
  if (status.playbook_path) lines.push(`Playbook file: ${status.playbook_path}`);
  if (status.threads_file) lines.push(`Threads file: ${status.threads_file}`);
  lines.push(`CDP: ${status.addr}:${status.port}`);
  lines.push(`Timestamp (UTC): ${status.ts_utc}`);
  lines.push("");
  lines.push("| name | kind | purpose | responsibility | expect | as_expected | thread_id | open | targets | targetId | title | generating | files | model_confirmation | dom_model |");
  lines.push("|---|---|---|---|---|---|---|---:|---:|---|---|---:|---:|---|---|");
  for (const r of status.rows) {
    const mc = r.model_confirmation && r.model_confirmation.present
      ? (r.model_confirmation.pro === true ? `Pro=YES ${r.model_confirmation.model || ""}`
        : r.model_confirmation.pro === false ? `Pro=NO ${r.model_confirmation.model || ""}`
        : `present ${r.model_confirmation.model || ""}`).trim()
      : (r.open ? "missing" : "n/a");

    const dm = (r.dom_model && r.dom_model.found)
      ? (r.dom_model.pro_model === true ? `ProModel=YES ${r.dom_model.text || ""}`
        : r.dom_model.pro_model === false ? `ProModel=NO ${r.dom_model.text || ""}`
        : `present ${r.dom_model.text || ""}`).trim()
      : (r.open ? "missing" : "n/a");

    const filesN = (typeof r.file_count === "number") ? r.file_count : 0;
    lines.push(
      `| ${mdEscape(r.name)} | ${mdEscape(r.kind)} | ${mdEscape(r.purpose)} | ${mdEscape(r.responsibility || "")} | ${mdEscape(r.expect || "")} | ${mdEscape(r.as_expected || "")} | ${mdEscape(r.thread_id || "")} | ${r.open ? 1 : 0} | ${r.target_count} | ${mdEscape(r.target_id || "")} | ${mdEscape(r.title || "")} | ${r.generating ? 1 : 0} | ${filesN} | ${mdEscape(mc)} | ${mdEscape(dm)} |`,
    );
  }
  lines.push("");

  lines.push("THREAD_URLS");
  for (const r of status.rows) {
    lines.push(`${r.name}: ${r.url}`);
  }
  lines.push("");

  const bad = status.rows.filter((r) => {
    if (!r.open) return false;
    const needMc = /MODEL_CONFIRMATION/i.test(String(r.expect || ""));
    if (!needMc) return false;
    return (!r.model_confirmation || !r.model_confirmation.present || r.model_confirmation.pro !== true || r.model_confirmation.placeholder);
  });
  if (bad.length > 0) {
    lines.push("MODEL_CONFIRMATION_WARN");
    lines.push(bad.map((r) => r.name).join(", "));
    lines.push("");

    lines.push("NEXT");
    lines.push("- Ask the listed threads to post a NEW reply with: MODEL_CONFIRMATION: Pro=YES | MODEL=<exact UI label>");
    lines.push("- Then rerun this command with --requireModelConfirmation (exit!=0 if still missing).");
    lines.push("");
  }

  const domBad = status.rows.filter((r) => r.open && (!r.dom_model || !r.dom_model.found || r.dom_model.pro_model !== true));
  if (domBad.length > 0) {
    lines.push("DOM_MODEL_WARN");
    lines.push(domBad.map((r) => r.name).join(", "));
    lines.push("");

    lines.push("NEXT");
    lines.push("- Confirm the active model via DOM (model switcher) is a Pro model for the listed threads.");
    lines.push("- Then rerun this command with --requireDomPro (exit!=0 if still missing/non-Pro)." );
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function collectThreadStatus(conn, args, cfg) {
  const threads = cfg.threads;
  const targets = conn.targets;
  const pages = (targets || []).filter((t) => t && t.type === "page" && t.webSocketDebuggerUrl);

  const rows = [];
  for (const t of threads) {
    const matches = findMatchingTargets(pages, t.url);
    const chosen = matches.length > 0 ? matches[matches.length - 1] : null;
    let probe = null;
    if (chosen) {
      const resp = cdpEvaluate(chosen.webSocketDebuggerUrl, threadStatusExpr(), {
        id: 99,
        returnByValue: true,
        awaitPromise: false,
        timeoutMs: 15000,
      });
      probe = resp && resp.result && resp.result.result ? resp.result.result.value : null;
    }
    const mc = probe ? parseModelConfirmation(probe.model_confirmation_line) : { present: false, pro: null, model: null, raw: "" };
    const row = {
      name: t.name,
      kind: t.kind,
      purpose: t.purpose,
      responsibility: t.responsibility || "",
      expect: t.expect,
      url: t.url,
      thread_id: extractConversationId(t.url),
      open: !!chosen,
      target_count: matches.length,
      target_ids: matches.map((m) => m.id),
      target_id: chosen ? chosen.id : null,
      title: probe && probe.title ? probe.title : (chosen ? chosen.title : ""),
      generating: probe ? !!probe.generating : false,
      assistant_count: probe ? Number(probe.assistant_count || 0) : 0,
      model_confirmation: probe ? mc : null,
      model_confirmation_line: probe ? (probe.model_confirmation_line || "") : "",
      file_count: probe ? Number(probe.file_count || 0) : 0,
      file_names: probe && probe.file_names ? probe.file_names : [],
      verdict: probe && probe.verdict ? String(probe.verdict || "") : "",
      dom_model: probe ? {
        found: !!probe.dom_model_found,
        text: String(probe.dom_model_text || ""),
        aria: String(probe.dom_model_aria || ""),
        pro_model: probe.dom_pro_model === true ? true : probe.dom_pro_model === false ? false : null,
        profile_text: String(probe.dom_profile_text || ""),
        pro_plan_badge: probe.dom_pro_plan_badge === true ? true : probe.dom_pro_plan_badge === false ? false : null,
      } : null,
    };
    row.as_expected = computeExpectedStatus(t, row);
    rows.push(row);
  }

  return {
    ts_utc: new Date().toISOString(),
    addr: args.addr,
    port: args.port,
    model_confirmation_required: true,
    threads_file: cfg.threadsFile,
    playbook_path: cfg.playbookRel,
    rows,
  };
}

function extractLatestAfterMarkerExpr() {
  // Keep this expression JSON-safe (no backticks) and robust to missing markers.
  return "(() => new Promise((resolve) => {\n" +
    "  const marker = '追加指示(SSOT v2整合)';\n" +
    "  const wait = 1200;\n" +
    "  const scrollToBottom = () => {\n" +
    "    try {\n" +
    "      const root = document.scrollingElement || document.documentElement || document.body;\n" +
    "      if (root) root.scrollTop = root.scrollHeight;\n" +
    "    } catch (_) {}\n" +
    "    try {\n" +
    "      const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {\n" +
    "        const s = getComputedStyle(el);\n" +
    "        if (!s) return false;\n" +
    "        const oy = s.overflowY;\n" +
    "        if (oy !== 'auto' && oy !== 'scroll') return false;\n" +
    "        return el.scrollHeight > el.clientHeight + 8;\n" +
    "      });\n" +
    "      candidates.sort((a,b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));\n" +
    "      const el = candidates[0] || null;\n" +
    "      if (el) el.scrollTop = el.scrollHeight;\n" +
    "    } catch (_) {}\n" +
    "  };\n" +
    "\n" +
    "  const extract = () => {\n" +
    "    const text = document.body ? (document.body.innerText || '') : '';\n" +
    "    const pos = text.lastIndexOf(marker);\n" +
    "    const tail = (pos >= 0) ? text.slice(pos) : text;\n" +
    "\n" +
    "    const lines = tail.split('\\n');\n" +
    "    const isDiff = (l) => l.startsWith('diff --git a/');\n" +
    "\n" +
    "    let patch_i = -1;\n" +
    "    for (let i = 0; i < lines.length; i++) {\n" +
    "      if (isDiff(lines[i])) { patch_i = i; break; }\n" +
    "    }\n" +
    "\n" +
    "    let report_i = -1;\n" +
    "    for (let i = (patch_i >= 0 ? patch_i + 1 : 0); i < lines.length; i++) {\n" +
    "      if (lines[i].includes('TEST_REPORT_worker')) { report_i = i; break; }\n" +
    "    }\n" +
    "    if (report_i < 0) {\n" +
    "      for (let i = (patch_i >= 0 ? patch_i + 1 : 0); i < lines.length; i++) {\n" +
    "        if (lines[i].startsWith('TEST_REPORT')) { report_i = i; break; }\n" +
    "      }\n" +
    "    }\n" +
    "\n" +
    "    let checklist_i = -1;\n" +
    "    for (let i = (patch_i >= 0 ? patch_i - 1 : lines.length - 1); i >= 0; i--) {\n" +
    "      const t = (lines[i] || '').trim();\n" +
    "      if (t === 'CHECKLIST' || t.startsWith('CHECKLIST')) { checklist_i = i; break; }\n" +
    "    }\n" +
    "\n" +
    "    let patch = '';\n" +
    "    let report = '';\n" +
    "    let checklist = '';\n" +
    "\n" +
    "    if (patch_i >= 0) {\n" +
    "      const end = (report_i >= 0 && report_i > patch_i) ? report_i : lines.length;\n" +
    "      patch = lines.slice(patch_i, end).join('\\n').trimEnd() + '\\n';\n" +
    "    }\n" +
    "    if (report_i >= 0) {\n" +
    "      report = lines.slice(report_i).join('\\n').trimEnd() + '\\n';\n" +
    "    }\n" +
    "    if (checklist_i >= 0) {\n" +
    "      const end = (patch_i >= 0 && patch_i > checklist_i) ? patch_i : ((report_i >= 0 && report_i > checklist_i) ? report_i : lines.length);\n" +
    "      checklist = lines.slice(checklist_i, end).join('\\n').trimEnd() + '\\n';\n" +
    "    }\n" +
    "\n" +
    "    const files = [];\n" +
    "    try {\n" +
    "      const re = /^diff --git a\\/([^\\s]+) b\\/([^\\s]+)\\s*$/gm;\n" +
    "      let m;\n" +
    "      while ((m = re.exec(patch)) !== null) files.push(m[1]);\n" +
    "    } catch (_) {}\n" +
    "\n" +
    "    resolve({\n" +
    "      href: (location && location.href) ? location.href : '',\n" +
    "      title: (document && document.title) ? document.title : '',\n" +
    "      marker_found: pos >= 0,\n" +
    "      text_len: text.length,\n" +
    "      tail_len: tail.length,\n" +
    "      patch_len: patch.length,\n" +
    "      report_len: report.length,\n" +
    "      checklist_len: checklist.length,\n" +
    "      files: files,\n" +
    "      patch: patch,\n" +
    "      report: report,\n" +
    "      checklist: checklist,\n" +
    "    });\n" +
    "  };\n" +
    "\n" +
    "  scrollToBottom();\n" +
    "  setTimeout(() => { scrollToBottom(); extract(); }, wait);\n" +
    "}))()";
}

function collectOne(conn, args, name, url) {
  const target = openOrFind(conn, args, url);
  sleepMs(args.waitMs);

  const expr = extractLatestAfterMarkerExpr();
  const resp = cdpEvaluate(target.webSocketDebuggerUrl, expr, {
    id: 1,
    returnByValue: true,
    awaitPromise: true,
    timeoutMs: 60000,
  });

  const value = resp && resp.result && resp.result.result ? resp.result.result.value : null;
  const peekPath = `${args.outDir}/${name}_peek.json`;
  const checklistPath = `${args.outDir}/${name}_CHECKLIST.txt`;
  const patchPath = `${args.outDir}/${name}_PATCH.diff`;
  const reportPath = `${args.outDir}/${name}_TEST_REPORT_worker.txt`;

  std.writeFile(peekPath, JSON.stringify(value, null, 2) + "\n");
  std.writeFile(checklistPath, String((value && value.checklist) || ""));
  std.writeFile(patchPath, String((value && value.patch) || ""));
  std.writeFile(reportPath, String((value && value.report) || ""));

  std.out.puts(JSON.stringify({
    name,
    url,
    marker_found: value ? value.marker_found : false,
    patch_len: value ? value.patch_len : 0,
    report_len: value ? value.report_len : 0,
    checklist_len: value ? value.checklist_len : 0,
    file_count: value && value.files ? value.files.length : 0,
  }, null, 2) + "\n");
  std.out.flush();
}

export function main(args, argv) {
  if (args.outDir) ensureDir(args.outDir);
  const conn = requireCdp(args.addr, args.port);

  const cfg = loadThreadsConfig(argv && argv.length ? argv[0] : "", args.threadsFile);

  const status = collectThreadStatus(conn, args, cfg);
  const md = renderStatusMarkdown(status);
  std.out.puts(md);
  std.out.flush();
  if (args.outDir) {
    writeOptional(`${args.outDir}/THREADS_STATUS.md`, md);
    writeOptional(`${args.outDir}/THREADS_STATUS.json`, JSON.stringify(status, null, 2) + "\n");
  }

  if (args.requireModelConfirmation) {
    const bad = status.rows.filter((r) => r.open && (!r.model_confirmation || !r.model_confirmation.present || r.model_confirmation.pro !== true || r.model_confirmation.placeholder));
    if (bad.length > 0) return 3;
  }

  if (args.requireDomPro) {
    const bad = status.rows.filter((r) => r.open && (!r.dom_model || !r.dom_model.found || r.dom_model.pro_model !== true));
    if (bad.length > 0) return 4;
  }

  if (args.statusOnly) return 0;

  if (!args.outDir) {
    std.err.puts("Missing --outDir\n");
    std.err.flush();
    return 2;
  }

  for (const t of cfg.threads) {
    if (t.kind !== "worker") continue;
    collectOne(conn, args, t.name, t.url);
  }

  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
