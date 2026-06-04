// Send a message in an existing ChatGPT tab via CDP (no jq/node).
//
// Typical flow:
//   nix shell .#chromium-cdp-tools
//   chromium-cdp "https://chatgpt.com" &
//   # Login manually, open the target thread URL in that browser.
//   export HQ_CHROME_ADDR=127.0.0.1 HQ_CHROME_PORT=9222
//   qjs --std -m parts/cdp/send-chatgpt.mjs \
//     --url "https://chatgpt.com/c/<thread>" --text-file /tmp/handoff.txt

import {
  cdpCall,
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
import { SELECTORS, assertProjectThreadUrlMatchesProject, keyTap, mouseClick, requireChatGptTarget } from "./domain/chatgpt/index.mjs";
import { requireCdp } from "./core/connect.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m send-chatgpt.mjs --url <thread-url> (--text <s> | --text-file <path>) [--projectUrl <.../project>] [--prepend <s>] [--append <s>] [--outDir <dir>] [--dryRun] [--allowGenerating] [--requireDomPro] [--domWaitMs 8000] [--send-confirm-ms 5000] [--addr 127.0.0.1] [--port 9222] [--wait-ms 0] [--id <targetId>]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      url: null,
      projectUrl: null,
      id: null,
      waitMs: 0,
      text: null,
      textFile: null,
      prepend: "",
      append: "",
      outDir: null,
      dryRun: false,
      allowGenerating: false,
      requireDomPro: false,
      domWaitMs: 8000,
      sendConfirmMs: 5000,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: { required: true },
      projectUrl: { names: ["--projectUrl", "--project-url"] },
      id: {},
      waitMs: { name: "--wait-ms", parse: (raw, current) => Number(raw) || current },
      text: {},
      textFile: { name: "--text-file" },
      prepend: {},
      append: {},
      outDir: {},
      dryRun: { type: "boolean" },
      allowGenerating: { type: "boolean" },
      requireDomPro: { type: "boolean" },
      domWaitMs: { parse: (raw, current) => Number(raw) || current },
      sendConfirmMs: { name: "--send-confirm-ms", parse: (raw, current) => Number(raw) || current },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => {
      if (!out.text && !out.textFile) return null;
      if (out.text && out.textFile) return null;
      return out;
    },
  });
}
function ensureDir(path) {
  if (!path) return;
  try {
    os.mkdir(path, 0o755);
  } catch {
    // ignore if exists
  }
}

function locateComposerExpr() {
  const promptSelectors = JSON.stringify([
    "#prompt-textarea",
    "textarea#prompt-textarea",
    "textarea[data-testid='prompt-textarea']",
    "form textarea",
    "form [contenteditable='true']",
  ]);
  const sendSelector = JSON.stringify(SELECTORS.send);
  const stopSelectors = JSON.stringify([
    SELECTORS.stop,
    'button[aria-label="Stop streaming"]',
  ]);
  return `(() => {
    const out = {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
    };

    const pick = (...sels) => {
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el) return el;
        } catch {}
      }
      return null;
    };

    const info = (el) => {
      if (!el) return null;
      try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
      const r = el.getBoundingClientRect();
      const tag = String(el.tagName || "");
      const aria = String(el.getAttribute("aria-label") || "");
      const testid = String(el.getAttribute("data-testid") || "");
      const role = String(el.getAttribute("role") || "");
      const id = String(el.id || "");
      const disabled = !!el.disabled;
      const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      let valueLen = 0;
      try {
        if (tag === "TEXTAREA" || tag === "INPUT") valueLen = String(el.value || "").length;
        else valueLen = String(el.innerText || "").length;
      } catch {}
      return { tag, id, aria, testid, role, disabled, valueLen, rect, center, contentEditable: !!el.isContentEditable };
    };

    const prompt = pick(...${promptSelectors});

    const send =
      pick(${sendSelector}) ||
      (prompt && prompt.closest && prompt.closest("form")
        ? prompt.closest("form").querySelector("button[type='submit']")
        : null);

    const stop = pick(...${stopSelectors});

    out.prompt = info(prompt);
    out.send = info(send);
    out.stop = info(stop);
    out.ok = !!out.prompt;
    if (!out.ok) out.reason = "prompt_not_found";
    return out;
  })()`;
}

function promptLenExpr() {
  return `(() => {
    const el = document.querySelector("#prompt-textarea") || document.querySelector("textarea[data-testid='prompt-textarea']") || document.querySelector("form textarea") || document.querySelector("form [contenteditable='true']");
    if (!el) return { ok: false, reason: "prompt_not_found" };
    const tag = String(el.tagName || "");
    let value = "";
    if (tag === "TEXTAREA" || tag === "INPUT") value = String(el.value || "");
    else value = String(el.innerText || "");
    return { ok: true, len: value.length };
  })()`;
}

function main(args) {
  let text = args.textFile ? String(std.loadFile(args.textFile) || "") : String(args.text || "");
  if (args.prepend) text = String(args.prepend) + text;
  if (args.append) text = text + String(args.append);
  if (!text.length) {
    throw new Error("text is empty");
  }
  const projectUrlCheck = args.projectUrl
    ? assertProjectThreadUrlMatchesProject(args.url, args.projectUrl, "--url")
    : null;

  if (args.outDir) ensureDir(args.outDir);

  const conn = requireCdp(args.addr, args.port);
  const { target, wsUrl } = requireChatGptTarget(conn, { url: args.url, id: args.id }, { purpose: "send-chatgpt" });

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
    return resp?.result?.result?.value;
  };

  const evalPromiseByValue = (expression, timeoutMs) => {
    const resp = cdpEvaluate(wsUrl, expression, {
      id: nextId++,
      returnByValue: true,
      awaitPromise: true,
      timeoutMs: timeoutMs || 60000,
    });
    return resp?.result?.result?.value;
  };

  // Bring to front and give the user-configurable initial settle time.
  try {
    call("Page.bringToFront", {});
  } catch {
    // ignore
  }
  sleepMs(args.waitMs);

  const before = evalByValue(locateComposerExpr(), 60000);
  if (!before || !before.ok) {
    std.out.puts(JSON.stringify({ target: { id: target.id, url: target.url, title: target.title }, before }, null, 2) + "\n");
    std.out.flush();
    throw new Error("prompt not found; open the thread in Chromium (logged in) and retry");
  }
  if (before.stop && !args.allowGenerating) {
    throw new Error("page is generating; wait until idle (no stop button) and retry");
  }

  // DOM model preflight (optional gate).
  let domModelPreflight = null;
  try {
    domModelPreflight = evalPromiseByValue(waitForDomModelExpr(args.domWaitMs), 60000);
  } catch {
    domModelPreflight = null;
  }

  const preflightRecord = {
    ts_utc: new Date().toISOString(),
    url: String(args.url || ""),
    projectUrl: String(args.projectUrl || ""),
    project_url_check: projectUrlCheck,
    target: { id: target.id, url: target.url, title: target.title },
    dom_model: domModelPreflight,
    require_dom_pro: !!args.requireDomPro,
    allow_generating: !!args.allowGenerating,
    text_len: text.length,
  };

  if (args.outDir) {
    std.writeFile(`${args.outDir}/DOM_MODEL_PRE_SEND.json`, JSON.stringify(preflightRecord, null, 2) + "\n");
  }

  if (args.requireDomPro) {
    const ok = !!(domModelPreflight && domModelPreflight.extended_pro_model === true);
    if (!ok) {
      const out = {
        ok: false,
        reason: "dom_model_not_extended_pro",
        target: { id: target.id, url: target.url, title: target.title },
        before,
        project_url_check: projectUrlCheck,
        dom_model_preflight: domModelPreflight,
      };
      if (args.outDir) std.writeFile(`${args.outDir}/SEND_META.json`, JSON.stringify(out, null, 2) + "\n");
      std.out.puts(JSON.stringify(out, null, 2) + "\n");
      std.out.flush();
      return 4;
    }
  }

  if (args.dryRun) {
    const out = {
      ok: true,
      dry_run: true,
      target: { id: target.id, url: target.url, title: target.title },
      before,
      project_url_check: projectUrlCheck,
      dom_model_preflight: domModelPreflight,
      allow_generating: !!args.allowGenerating,
      text_len: text.length,
    };
    if (args.outDir) std.writeFile(`${args.outDir}/SEND_META.json`, JSON.stringify(out, null, 2) + "\n");
    std.out.puts(JSON.stringify(out, null, 2) + "\n");
    std.out.flush();
    return 0;
  }

  // Focus prompt via a real click.
  mouseClick(call, before.prompt.center.x, before.prompt.center.y);
  sleepMs(50);

  // Best-effort clear: Ctrl+A then Backspace.
  // Modifiers bitfield: Alt=1, Ctrl=2, Meta=4, Shift=8.
  try {
    keyTap(call, "a", "KeyA", 65, 2);
    keyTap(call, "Backspace", "Backspace", 8, 0);
  } catch {
    // ignore
  }

  // Type text in chunks to avoid huge argv payloads.
  const chunkSize = 800;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    call("Input.insertText", { text: chunk });
  }

  // Re-locate send button after typing (DOM may update).
  const afterType = evalByValue(locateComposerExpr(), 60000);

  let sendHow = "unknown";
  if (afterType && afterType.send && !afterType.send.disabled) {
    mouseClick(call, afterType.send.center.x, afterType.send.center.y);
    sendHow = "click_send";
  } else {
    // Fallback: press Enter.
    keyTap(call, "Enter", "Enter", 13, 0);
    sendHow = "enter";
  }

  // Confirmation: a real send clears the composer. Typing into a busy
  // composer can look successful in the UI, so do not report ok until clear.
  let after = null;
  const confirmDeadline = Date.now() + Math.max(0, Number(args.sendConfirmMs) || 0);
  do {
    sleepMs(200);
    after = evalByValue(promptLenExpr(), 30000);
    if (after && after.ok && after.len === 0) break;
  } while (Date.now() < confirmDeadline);

  const out = {
    ok: !!(after && after.ok && after.len === 0),
    reason: after && after.ok && after.len === 0 ? null : "send_not_confirmed_prompt_not_cleared",
    target: { id: target.id, url: target.url, title: target.title },
    before,
    project_url_check: projectUrlCheck,
    dom_model_preflight: domModelPreflight,
    allow_generating: !!args.allowGenerating,
    afterType,
    send: { how: sendHow },
    after,
  };
  if (args.outDir) std.writeFile(`${args.outDir}/SEND_META.json`, JSON.stringify(out, null, 2) + "\n");
  std.out.puts(JSON.stringify(out, null, 2) + "\n");
  std.out.flush();
  return out.ok ? 0 : 5;
}

run(scriptArgs, { usage, buildArgs, main });
