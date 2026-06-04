// Project Sources roundtrip smoke (CDP/qjs)
//
// What this does
// - Upload a local text file into a ChatGPT Project's Sources (project-level context)
// - Ask a *different* thread in the same project to read the file and return a token
// - Download the same file from the Project Sources page (click row -> browser download)
//
// Runtime
// - quickjs-ng (qjs) with --std
//
// Example
//   nix shell .#chromium-cdp-tools
//   export HQ_CHROME_ADDR=127.0.0.1 HQ_CHROME_PORT=9222
//   qjs --std -m parts/cdp/project-sources-roundtrip.mjs \
//     --projectUrl "https://chatgpt.com/g/g-p-<project>/project" \
//     --threadUrl  "https://chatgpt.com/g/g-p-<project>/c/<thread>" \
//     --file /home/nixos/tmp/hq_project_cross_thread_probe.txt \
//     --outDir /tmp/hq_project_roundtrip

import * as std from "./qjs-compat/std.mjs";
import { SELECTORS, extractConversationId, extractProjectId, keyTap, mouseClick, openOrCreateChatGptTarget } from "./chatgpt/index.mjs";
import { requireCdp } from "./connect.mjs";
import { buildDownloadedNameRegex, copyFile, joinPath, listMatchingFiles, mkdirp, tryStat } from "./fs.mjs";
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
    "usage: qjs --std -m project-sources-roundtrip.mjs --projectUrl <.../project> --threadUrl <.../c/...> --file <path> --outDir <dir> [--downloadsDir <dir>] [--addr 127.0.0.1] [--port 9222] [--waitMs 600] [--timeoutMs 180000] [--pollMs 200] [--expectToken <token>]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      projectUrl: null,
      threadUrl: null,
      file: null,
      outDir: null,
      downloadsDir: null,
      waitMs: 600,
      timeoutMs: 180000,
      pollMs: 200,
      expectToken: null,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      projectUrl: { required: true },
      threadUrl: { required: true },
      file: { required: true },
      outDir: { required: true },
      downloadsDir: {},
      waitMs: { parse: (raw, current) => Number(raw) || current },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
      pollMs: { parse: (raw, current) => Number(raw) || current },
      expectToken: {},
    },
    onError: "null",
    finalize: (out) => {
      if (!out.downloadsDir) {
        const home = String(std.getenv("HOME") || "");
        out.downloadsDir = home ? `${home}/Downloads` : "./Downloads";
      }
      return out;
    },
  });
}
function ensureDir(path) {
  mkdirp(path);
}

function basename(path) {
  const p = String(path || "");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function normalizeProjectSourcesUrl(projectUrl) {
  const u = String(projectUrl || "");
  if (!u) return u;
  if (u.includes("tab=sources")) return u;
  if (u.includes("?")) return u + "&tab=sources";
  return u + "?tab=sources";
}

function extractTokenFromText(text) {
  const t = String(text || "");
  const m = t.match(/^\s*TOKEN\s*:\s*(.+)\s*$/m);
  if (!m) return null;
  const tok = String(m[1] || "").trim();
  return tok || null;
}

function locateTabsExpr() {
  return `(() => {
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const tabs = Array.from(document.querySelectorAll('button[role="tab"]')).filter(isVisible);
    const get = (label) => {
      const el = tabs.find((b) => String(b.innerText || '').trim() === label) || null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        label,
        selected: String(el.getAttribute('aria-selected') || '') === 'true',
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
      };
    };
    return { href: (location && location.href) ? location.href : '', chats: get('Chats'), sources: get('Sources') };
  })()`;
}

function waitTabSelectedExpr(label, timeoutMs) {
  const lbl = JSON.stringify(String(label || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const label = ${lbl};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const selected = () => {
      const tabs = Array.from(document.querySelectorAll('button[role="tab"]')).filter(isVisible);
      const el = tabs.find((b) => String(b.innerText || '').trim() === label) || null;
      return !!el && String(el.getAttribute('aria-selected') || '') === 'true';
    };
    if (selected()) return resolve(true);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      resolve(!!v);
    };
    const mo = new MutationObserver(() => { if (selected()) finish(true); });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish(selected()), ${ms});
  }))()`;
}

function attachSourceFileExpr(fileName, fileText, timeoutMs) {
  const nameJson = JSON.stringify(String(fileName || ""));
  const textJson = JSON.stringify(String(fileText || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const fileName = ${nameJson};
    const fileText = ${textJson};
    const timeoutMs = ${ms};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const pickInput = () => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      for (const i of inputs) {
        const host = i.parentElement;
        const hostText = host ? String(host.innerText || host.textContent || '') : '';
        const r = i.getBoundingClientRect();
        if (hostText.includes('Give ChatGPT more context') && r.width >= 1 && r.height >= 1) return i;
      }
      const cand = inputs
        .filter((i) => String(i.accept || '') === '')
        .filter((i) => { const r = i.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; });
      return cand.length ? cand[cand.length - 1] : (inputs.length ? inputs[inputs.length - 1] : null);
    };
    const assign = () => {
      const input = pickInput();
      if (!input) return { ok: false, reason: 'file_input_not_found' };
      try { input.value = ''; } catch (_) {}
      const dt = new DataTransfer();
      dt.items.add(new File([fileText], fileName, { type: 'text/plain' }));
      try { input.files = dt.files; } catch (e) { return { ok: false, reason: 'assign_failed', error: String(e) }; }
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
      const names = input.files ? Array.from(input.files).map((f) => String(f && f.name ? f.name : '')) : [];
      const r = input.getBoundingClientRect();
      return { ok: true, names, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    };
    const pageHasName = () => {
      const t = document.body ? String(document.body.innerText || '') : '';
      return t.includes(fileName);
    };
    const start = Date.now();
    const res = assign();
    if (!res.ok) return resolve({ ok: false, stage: 'attach', ...res });
    if (pageHasName()) return resolve({ ok: true, stage: 'present', ...res, waited_ms: 0 });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      resolve(v);
    };
    const mo = new MutationObserver(() => {
      if (pageHasName()) finish({ ok: true, stage: 'present', ...res, waited_ms: Date.now() - start });
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => {
      finish({ ok: pageHasName(), stage: pageHasName() ? 'present' : 'timeout', ...res, waited_ms: Date.now() - start });
    }, timeoutMs);
  }))()`;
}

function locateComposerExpr() {
  return `(() => {
    const pick = (...sels) => {
      for (const s of sels) {
        try { const el = document.querySelector(s); if (el) return el; } catch (_) {}
      }
      return null;
    };
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const info = (el) => {
      if (!el) return null;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      const r = el.getBoundingClientRect();
      const tag = String(el.tagName || '');
      return {
        tag,
        id: String(el.id || ''),
        aria: String(el.getAttribute('aria-label') || ''),
        testid: String(el.getAttribute('data-testid') || ''),
        role: String(el.getAttribute('role') || ''),
        disabled: !!el.disabled,
        contentEditable: !!el.isContentEditable,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        visible: isVisible(el),
      };
    };
    const prompt = pick('#prompt-textarea', "textarea[data-testid='prompt-textarea']", 'form textarea', 'form [contenteditable="true"]', '[role="textbox"][contenteditable="true"]');
    const root = prompt && prompt.closest ? (prompt.closest('form') || prompt.closest('main') || prompt.parentElement) : document;
    const send = pick("button[data-testid='send-button']", '#composer-submit-button', 'button[type="submit"]') || (root && root.querySelector ? root.querySelector('button[type="submit"]') : null);
    const stop = pick("button[data-testid='stop-button']", "button[aria-label='Stop generating']", "button[aria-label='Stop']", "button[aria-label='停止']");
    return {
      href: (location && location.href) ? location.href : '',
      title: (document && document.title) ? document.title : '',
      readyState: (document && document.readyState) ? document.readyState : '',
      ok: !!prompt,
      prompt: info(prompt),
      send: info(send),
      stop: info(stop),
    };
  })()`;
}

function waitForAssistantIdleContainingExpr(token, timeoutMs) {
  const tok = JSON.stringify(String(token || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const token = ${tok};
    const stopSel = 'button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop"],button[aria-label="停止"]';
    const assistantSel = '[data-message-author-role="assistant"],[data-testid*="assistant"],[data-role="assistant"]';
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const scrollToBottom = () => {
      try { (document.scrollingElement || document.documentElement || document.body).scrollTop = 1e9; } catch (_) {}
      try { window.scrollTo(0, document.body.scrollHeight); } catch (_) {}
      try {
        const candidates = Array.from(document.querySelectorAll('main, body, [data-testid*="scroll" i], [class*="scroll" i]'))
          .filter((el) => el && el.scrollHeight && el.clientHeight && el.scrollHeight > el.clientHeight + 8);
        candidates.sort((a,b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
        const el = candidates[0] || null;
        if (el) el.scrollTop = el.scrollHeight;
      } catch (_) {}
    };
    const snapshot = (reason, timedOut) => {
      const stop = !!document.querySelector(stopSel);
      const assistants = Array.from(document.querySelectorAll(assistantSel)).filter(isVisible);
      const last = assistants.length ? assistants[assistants.length - 1] : null;
      const text = last ? String(last.innerText || last.textContent || '') : '';
      const tailMax = 4096;
      const tail = text.length > tailMax ? text.slice(text.length - tailMax) : text;
      return {
        ok: !timedOut,
        timed_out: !!timedOut,
        reason,
        generating: stop,
        assistant_count: assistants.length,
        has_token: token ? text.includes(token) : false,
        last_assistant_tail: tail,
      };
    };
    const done = () => {
      const s = snapshot('check', false);
      return (!s.generating) && s.has_token;
    };
    scrollToBottom();
    if (done()) return resolve(snapshot('already_idle_with_token', false));
    let finished = false;
    const finish = (timedOut) => {
      if (finished) return;
      finished = true;
      try { mo.disconnect(); } catch (_) {}
      scrollToBottom();
      resolve(snapshot(timedOut ? 'timeout' : 'idle_with_token', timedOut));
    };
    const mo = new MutationObserver(() => {
      scrollToBottom();
      if (done()) finish(false);
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish(true), ${ms});
  }))()`;
}

function locateSourceRowExpr(fileName) {
  const nameJson = JSON.stringify(String(fileName || ""));
  return `(() => {
    const name = ${nameJson};
    const isVisible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const cands = Array.from(document.querySelectorAll('span,div,p,a,button')).filter(isVisible);
    const hits = [];
    for (const el of cands) {
      const t = String(el.innerText || '').trim();
      if (!t) continue;
      if (t !== name && !t.includes(name)) continue;
      const cs = getComputedStyle(el);
      const cursor = cs ? String(cs.cursor || '') : '';
      const r = el.getBoundingClientRect();
      hits.push({
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        cursor,
        len: t.length,
        exact: t === name,
      });
    }
    if (!hits.length) return { ok: false, reason: 'row_not_found', hit_count: 0 };
    // Prefer exact match + cursor pointer + small-ish area.
    hits.sort((a, b) => {
      const ap = (a.exact ? 0 : 10) + (a.cursor === 'pointer' ? 0 : 5) + (a.w * a.h);
      const bp = (b.exact ? 0 : 10) + (b.cursor === 'pointer' ? 0 : 5) + (b.w * b.h);
      return ap - bp;
    });
    const pick = hits[0];
    return { ok: true, pick, hit_count: hits.length };
  })()`;
}

function roundtrip(conn, args) {
  ensureDir(args.outDir);
  ensureDir(args.downloadsDir);

  const fileText = String(std.loadFile(args.file) || "");
  if (!fileText.length) throw new Error(`cannot read --file (empty?): ${args.file}`);
  const fileName = basename(args.file);

  const expectedToken = args.expectToken || extractTokenFromText(fileText);
  if (!expectedToken) {
    throw new Error("expected token not found; pass --expectToken or add 'TOKEN: ...' line to the file");
  }

  // Open / ensure project Sources tab.
  const projectSourcesUrl = normalizeProjectSourcesUrl(args.projectUrl);
  const { target: projectTarget } = openOrCreateChatGptTarget(conn, projectSourcesUrl, { purpose: "project-sources-roundtrip project", checkSession: false });
  const projectWs = projectTarget.webSocketDebuggerUrl;
  const project = mkCaller(projectWs);

  try { project.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const tabs0 = project.evalValue(locateTabsExpr(), { timeoutMs: 60000 });
  if (!tabs0 || !tabs0.sources) throw new Error("cannot locate project tabs");
  if (!tabs0.sources.selected) {
    mouseClick(project.call, tabs0.sources.x, tabs0.sources.y);
    const ok = project.evalValue(waitTabSelectedExpr("Sources", 15000), { awaitPromise: true, timeoutMs: 20000 });
    if (!ok) throw new Error("failed to switch to Sources tab");
  }

  const uploadRes = project.evalValue(attachSourceFileExpr(fileName, fileText, args.timeoutMs), {
    awaitPromise: true,
    timeoutMs: args.timeoutMs + 10000,
  });

  // Verify from another thread.
  const { target: threadTarget } = openOrCreateChatGptTarget(conn, args.threadUrl, { purpose: "project-sources-roundtrip thread", checkSession: false });
  const threadWs = threadTarget.webSocketDebuggerUrl;
  const thread = mkCaller(threadWs);
  try { thread.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const before = thread.evalValue(locateComposerExpr(), { timeoutMs: 60000 });
  if (!before || !before.ok) throw new Error("thread composer not found; open the thread in Chromium (logged in) and retry");
  if (before.stop) throw new Error("thread is generating; wait until idle and retry");

  const prompt =
    "Project Sources smoke.\n\n" +
    `Read the Project source file named \"${fileName}\" and reply with exactly the TOKEN value (just the token, no extra words).`;

  // Focus prompt.
  mouseClick(thread.call, before.prompt.center.x, before.prompt.center.y);
  sleepMs(50);
  // Clear prompt: Ctrl+A then Backspace.
  try {
    keyTap(thread.call, "a", "KeyA", 65, 2);
    keyTap(thread.call, "Backspace", "Backspace", 8, 0);
  } catch {
    // ignore
  }
  // Type.
  const chunkSize = 800;
  for (let i = 0; i < prompt.length; i += chunkSize) {
    thread.call("Input.insertText", { text: prompt.slice(i, i + chunkSize) });
  }
  const afterType = thread.evalValue(locateComposerExpr(), { timeoutMs: 60000 });
  if (!afterType || !afterType.send || afterType.send.disabled) throw new Error("send button not available after typing");
  mouseClick(thread.call, afterType.send.center.x, afterType.send.center.y);

  const waited = thread.evalValue(waitForAssistantIdleContainingExpr(expectedToken, args.timeoutMs), {
    awaitPromise: true,
    timeoutMs: args.timeoutMs + 10000,
  });

  // Download from Project Sources page.
  try { project.call("Page.bringToFront", {}); } catch {}
  sleepMs(300);
  const row = project.evalValue(locateSourceRowExpr(fileName), { timeoutMs: 60000 });
  const download = { ok: false, reason: "not_started" };
  if (row && row.ok && row.pick) {
    const nameRx = buildDownloadedNameRegex(fileName);
    const baseline = listMatchingFiles(args.downloadsDir, nameRx);
    const baselineSet = new Set(baseline.map((x) => x.name));
    const startMs = Date.now();

    mouseClick(project.call, row.pick.x, row.pick.y);
    sleepMs(200);

    const deadline = Date.now() + Math.max(1000, Number(args.timeoutMs) || 0);
    let got = null;
    while (Date.now() < deadline) {
      const cands = listMatchingFiles(args.downloadsDir, nameRx)
        .filter((f) => !baselineSet.has(f.name))
        .filter((f) => f.mtime >= startMs - 1000)
        .filter((f) => !String(f.name).endsWith(".crdownload"));

      if (cands.length > 0) {
        const pick = cands[0];
        if (tryStat(pick.path + ".crdownload")) {
          sleepMs(args.pollMs);
          continue;
        }
        const st1 = tryStat(pick.path);
        sleepMs(200);
        const st2 = tryStat(pick.path);
        if (st1 && st2 && Number(st1.size) === Number(st2.size)) {
          got = pick;
          break;
        }
      }
      sleepMs(args.pollMs);
    }

    if (got) {
      const dest = joinPath(args.outDir, got.name);
      copyFile(got.path, dest);
      download.ok = true;
      download.reason = "downloaded";
      download.downloads_src = got.path;
      download.out_path = dest;
      download.bytes = got.size;
    } else {
      download.ok = false;
      download.reason = "download_timeout";
    }
  } else {
    download.ok = false;
    download.reason = "row_not_found";
  }

  const thread_ok = !!(waited && waited.ok && waited.has_token && waited.generating === false);
  const ok = !!(uploadRes && uploadRes.ok && thread_ok && download.ok);

  return {
    ok,
    projectUrl: args.projectUrl,
    projectSourcesUrl,
    threadUrl: args.threadUrl,
    file: args.file,
    file_name: fileName,
    expected_token: expectedToken,
    upload: uploadRes,
    thread: {
      before,
      afterType,
      waited,
    },
    download,
  };
}

export function main(args) {
  const conn = requireCdp(args.addr, args.port);
  const res = roundtrip(conn, args);
  std.out.puts(JSON.stringify(res, null, 2) + "\n");
  std.out.flush();
  return res && res.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
