import * as std from "./qjs-compat/std.mjs";
import { requireCdp } from "./connect.mjs";
import { getDefaultAddr, getDefaultPort, mkCaller, parseArgs, run, sleepMs } from "./lib.mjs";
import { assertProjectThreadUrlMatchesProject, extractConversationId, extractProjectId, keyTap, mouseClick, openOrCreateChatGptTarget, requireChatGptTarget } from "./chatgpt/index.mjs";
import { waitForDomModelExpr } from "./hq-dom-model.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-create-project-thread.mjs --projectUrl <.../project> (--text <s> | --text-file <path>) [--id <targetId>] [--outPath <file>] [--addr 127.0.0.1] [--port 9222] [--waitMs 800] [--timeoutMs 180000] [--requireDomPro] [--noRequireDomPro] [--domWaitMs 8000] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      projectUrl: null,
      id: null,
      text: null,
      textFile: null,
      outPath: null,
      waitMs: 800,
      timeoutMs: 180000,
      requireDomPro: true,
      domWaitMs: 8000,
      json: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      projectUrl: { required: true, names: ["--projectUrl", "--project-url"] },
      id: {},
      text: {},
      textFile: { names: ["--textFile", "--text-file"] },
      outPath: { names: ["--outPath", "--out-path"] },
      waitMs: { parse: (raw, current) => Number(raw) || current, names: ["--waitMs", "--wait-ms"] },
      timeoutMs: { parse: (raw, current) => Number(raw) || current, names: ["--timeoutMs", "--timeout-ms"] },
      requireDomPro: { type: "boolean" },
      noRequireDomPro: { type: "boolean", names: ["--noRequireDomPro", "--no-require-dom-pro"] },
      domWaitMs: { parse: (raw, current) => Number(raw) || current, names: ["--domWaitMs", "--dom-wait-ms"] },
      json: { type: "boolean" },
    },
    onError: "null",
    finalize: (out) => {
      if (!!out.text === !!out.textFile) return null;
      if (out.noRequireDomPro) out.requireDomPro = false;
      return out;
    },
  });
}

function locateComposerExpr() {
  return `(() => {
    const pick = (...sels) => {
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el) return el;
        } catch (_) {}
      }
      return null;
    };
    const isVisible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const info = (el) => {
      if (!el) return null;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      const r = el.getBoundingClientRect();
      return {
        id: String(el.id || ''),
        tag: String(el.tagName || ''),
        aria: String(el.getAttribute('aria-label') || ''),
        testid: String(el.getAttribute('data-testid') || ''),
        role: String(el.getAttribute('role') || ''),
        disabled: !!el.disabled,
        contentEditable: !!el.isContentEditable,
        visible: isVisible(el),
        center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    };
    const promptCandidates = [
      '[role="textbox"][contenteditable="true"]',
      'form [contenteditable="true"]',
      '[role="textbox"]',
      '#prompt-textarea',
      "textarea[data-testid='prompt-textarea']",
      'form textarea',
    ];
    let prompt = null;
    for (const s of promptCandidates) {
      try {
        const found = Array.from(document.querySelectorAll(s)).filter(isVisible);
        if (found.length) {
          prompt = found[found.length - 1];
          break;
        }
      } catch (_) {}
    }
    if (!prompt) prompt = pick('#prompt-textarea', "textarea[data-testid='prompt-textarea']", 'form textarea', 'form [contenteditable="true"]', '[role="textbox"][contenteditable="true"]', '[role="textbox"]');
    const root = prompt && prompt.closest ? (prompt.closest('form') || prompt.closest('main') || prompt.parentElement) : document;
    const send = pick("button[data-testid='send-button']", '#composer-submit-button', 'button[type="submit"]') || (root && root.querySelector ? root.querySelector('button[type="submit"]') : null);
    const stop = pick("button[data-testid='stop-button']", "button[aria-label='Stop generating']", "button[aria-label='Stop']", "button[aria-label='停止']");
    return {
      ok: !!prompt,
      href: String(location.href || ''),
      title: String(document.title || ''),
      readyState: String(document.readyState || ''),
      prompt: info(prompt),
      send: info(send),
      stop: info(stop),
    };
  })()`;
}

function waitForComposerExpr(timeoutMs) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  const locateFn = locateComposerExpr().replace(/\(\)\s*$/, "");
  return `(() => new Promise((resolve) => {
    const timeoutMs = ${ms};
    const locate = ${locateFn};
    const first = locate();
    if (first && first.ok && first.prompt) return resolve({ ...first, waited_ms: 0 });
    const start = Date.now();
    const timer = setInterval(() => {
      const now = locate();
      if (now && now.ok && now.prompt) {
        clearInterval(timer);
        resolve({ ...now, waited_ms: Date.now() - start });
      }
    }, 250);
    setTimeout(() => {
      clearInterval(timer);
      const last = locate();
      resolve({ ...(last || {}), waited_ms: Date.now() - start, timed_out: !(last && last.ok && last.prompt) });
    }, timeoutMs);
  }))()`;
}

function waitForProjectThreadExpr(projectId, initialHref, timeoutMs) {
  const pid = JSON.stringify(String(projectId || ""));
  const startHref = JSON.stringify(String(initialHref || ""));
  const ms = Math.max(0, Number(timeoutMs) || 0);
  return `(() => new Promise((resolve) => {
    const projectId = ${pid};
    const initialHref = ${startHref};
    const sameProjectThread = () => {
      const href = String(location.href || '');
      if (href === initialHref) return null;
      if (!href.includes('/c/')) return null;
      if (projectId && !href.includes('/g/g-p-' + projectId)) return null;
      return {
        href,
        title: String(document.title || ''),
        conversationId: ((href.match(/\\/c\\/([0-9a-fA-F-]{16,})/) || [])[1] || null),
      };
    };
    const ready = sameProjectThread();
    if (ready) return resolve({ ok: true, waited_ms: 0, ...ready });
    const start = Date.now();
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      resolve(payload);
    };
    const mo = new MutationObserver(() => {
      const hit = sameProjectThread();
      if (hit) finish({ ok: true, waited_ms: Date.now() - start, ...hit });
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => {
      const hit = sameProjectThread();
      finish(hit ? { ok: true, waited_ms: Date.now() - start, ...hit } : { ok: false, waited_ms: Date.now() - start, href: String(location.href || ''), title: String(document.title || ''), conversationId: null });
    }, ${ms});
  }))()`;
}

function createThread(args) {
  const promptText = args.textFile ? String(std.loadFile(args.textFile) || "") : String(args.text || "");
  if (!promptText.length) throw new Error("prompt text is empty");

  const conn = requireCdp(args.addr, args.port);
  const opened = args.id
    ? requireChatGptTarget(conn, { url: args.projectUrl, id: args.id }, { purpose: "create-project-thread", checkSession: false })
    : openOrCreateChatGptTarget(conn, args.projectUrl, { purpose: "create-project-thread", checkSession: false });
  const projectId = extractProjectId(opened.finalUrl || (opened.target && opened.target.url) || args.projectUrl);
  const thread = mkCaller(opened.wsUrl);

  try { thread.call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const before = thread.evalValue(waitForComposerExpr(Math.min(args.timeoutMs, 60000)), { awaitPromise: true, timeoutMs: Math.min(args.timeoutMs, 60000) + 10000 });
  if (!before || !before.ok || !before.prompt) {
    throw new Error(`project composer not found: href=${before && before.href ? before.href : ""}`);
  }
  if (before.stop) {
    throw new Error("project page is generating; wait until idle and retry");
  }
  let domModelPreflight = null;
  try {
    domModelPreflight = thread.evalValue(waitForDomModelExpr(args.domWaitMs), { awaitPromise: true, timeoutMs: Math.max(60000, args.domWaitMs + 10000) });
  } catch (_) {
    domModelPreflight = null;
  }
  if (args.requireDomPro) {
    const ok = !!(domModelPreflight && domModelPreflight.extended_pro_model === true);
    if (!ok) {
      throw new Error(`dom_model_not_extended_pro: ${JSON.stringify(domModelPreflight)}`);
    }
  }

  mouseClick(thread.call, before.prompt.center.x, before.prompt.center.y);
  sleepMs(50);
  try {
    keyTap(thread.call, "a", "KeyA", 65, 2);
    keyTap(thread.call, "Backspace", "Backspace", 8, 0);
  } catch (_) {}

  const chunkSize = 800;
  for (let i = 0; i < promptText.length; i += chunkSize) {
    thread.call("Input.insertText", { text: promptText.slice(i, i + chunkSize) });
  }

  const typed = thread.evalValue(locateComposerExpr(), { timeoutMs: 60000 });
  if (!typed || !typed.send || typed.send.disabled) {
    throw new Error("send button not available after typing");
  }

  mouseClick(thread.call, typed.send.center.x, typed.send.center.y);
  const created = thread.evalValue(
    waitForProjectThreadExpr(projectId, before.href || (opened.finalUrl || args.projectUrl), args.timeoutMs),
    { awaitPromise: true, timeoutMs: args.timeoutMs + 10000 },
  );

  const result = {
    ok: !!(created && created.ok && created.href),
    addr: args.addr,
    port: args.port,
    projectUrl: args.projectUrl,
    requestedTargetId: args.id || null,
    targetId: String((opened.target && opened.target.id) || ""),
    projectId: projectId || null,
    before,
    dom_model_preflight: domModelPreflight,
    afterType: typed,
    created,
    threadUrl: created && created.ok ? String(created.href || "") : null,
    conversationId: created && created.ok ? (created.conversationId || extractConversationId(created.href || "")) : null,
  };
  result.project_url_check = result.threadUrl
    ? assertProjectThreadUrlMatchesProject(result.threadUrl, args.projectUrl, "created thread")
    : null;

  if (args.outPath) {
    std.writeFile(args.outPath, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}

function main(args) {
  const result = createThread(args);
  if (args.json) {
    std.out.puts(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.threadUrl) std.out.puts(`threadUrl: ${result.threadUrl}\n`);
    if (result.conversationId) std.out.puts(`conversationId: ${result.conversationId}\n`);
  }
  return result.ok ? 0 : 1;
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
