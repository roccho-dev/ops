// Upload a local file into an existing ChatGPT thread composer via CDP.
//
// What this does
// - Open or reuse a ChatGPT thread tab
// - Locate the composer-owned file input
// - Attach a local file path via DOM.setFileInputFiles
// - Optionally send a user message so the upload becomes a thread turn
//
// Runtime: quickjs-ng (qjs) with --std

import * as std from "./core/std.mjs";
import * as os from "./core/os.mjs";
import { SELECTORS, keyTap, mouseClick, requireChatGptTarget } from "./domain/chatgpt/index.mjs";
import { requireCdp } from "./core/connect.mjs";
import {
  cdpCall,
  cdpEvaluate,
  getDefaultAddr,
  getDefaultPort,
  parseArgs,
  run,
  runToString,
  sleepMs,
} from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m upload-chatgpt-file.mjs --url <thread-url> --file <path> [--text <s> | --text-file <path>] [--id <targetId>] [--outPath <file>] [--addr 127.0.0.1] [--port 9222] [--waitMs 800] [--timeoutMs 180000]\n",
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
      file: null,
      text: null,
      textFile: null,
      outPath: null,
      waitMs: 800,
      timeoutMs: 180000,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      url: { required: true },
      id: {},
      file: { required: true },
      text: {},
      textFile: { name: "--text-file" },
      outPath: {},
      waitMs: { parse: (raw, current) => Number(raw) || current },
      timeoutMs: { parse: (raw, current) => Number(raw) || current },
    },
    onError: "null",
    finalize: (out) => {
      if (out.text && out.textFile) return null;
      return out;
    },
  });
}
function locateComposerExpr() {
  const promptSelectors = JSON.stringify([
    '#prompt-textarea',
    'textarea#prompt-textarea',
    "textarea[data-testid='prompt-textarea']",
    'form textarea',
    'form [contenteditable="true"]',
  ]);
  const sendSelector = JSON.stringify(SELECTORS.send);
  const stopSelectors = JSON.stringify([
    SELECTORS.stop,
    'button[aria-label="Stop streaming"]',
  ]);
  const plusSelector = JSON.stringify('button[data-testid="composer-plus-btn"]');
  return `(() => {
    const q = (s, root) => {
      try { return (root || document).querySelector(s); } catch { return null; }
    };
    const pick = (...sels) => {
      for (const s of sels) {
        const el = q(s);
        if (el) return el;
      }
      return null;
    };
    const info = (el) => {
      if (!el) return null;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      const r = el.getBoundingClientRect();
      const tag = String(el.tagName || '');
      const aria = String(el.getAttribute('aria-label') || '');
      const testid = String(el.getAttribute('data-testid') || '');
      const role = String(el.getAttribute('role') || '');
      const id = String(el.id || '');
      const disabled = !!el.disabled;
      let valueLen = 0;
      try {
        if (tag === 'TEXTAREA' || tag === 'INPUT') valueLen = String(el.value || '').length;
        else valueLen = String(el.innerText || '').length;
      } catch {}
      return {
        tag, id, aria, testid, role, disabled, valueLen,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        center: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        contentEditable: !!el.isContentEditable,
      };
    };
    const prompt = pick(...${promptSelectors});
    const send = pick(${sendSelector}) || (prompt && prompt.closest && prompt.closest('form') ? prompt.closest('form').querySelector('button[type="submit"]') : null);
    const stop = pick(...${stopSelectors});
    const plus = pick(${plusSelector});
    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      prompt: info(prompt),
      send: info(send),
      stop: info(stop),
      plus: info(plus),
      ok: !!prompt,
    };
  })()`;
}

function markFileInputExpr(marker) {
  const mk = JSON.stringify(String(marker || ""));
  return `(() => {
    const marker = ${mk};
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    for (const i of inputs) {
      try { i.removeAttribute('data-hq-file-upload-target'); } catch {}
    }
    const preferred = inputs.find((i) => String(i.getAttribute('accept') || '') === '') || (inputs.length ? inputs[0] : null);
    if (!preferred) return { ok: false, reason: 'file_input_not_found', count: inputs.length };
    try { preferred.setAttribute('data-hq-file-upload-target', marker); } catch (_) {}
    const r = preferred.getBoundingClientRect();
    return {
      ok: true,
      count: inputs.length,
      accept: String(preferred.getAttribute('accept') || ''),
      multiple: !!preferred.multiple,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  })()`;
}

function waitForFileVisibleExpr(fileName, timeoutMs) {
  const name = JSON.stringify(String(fileName || ""));
  const ms = Number(timeoutMs) || 0;
  return `(() => new Promise((resolve) => {
    const fileName = ${name};
    const timeoutMs = ${ms};
    const pageHasName = () => {
      const t = document.body ? String(document.body.innerText || '') : '';
      return t.includes(fileName);
    };
    if (pageHasName()) return resolve({ ok: true, waited_ms: 0 });
    let done = false;
    const start = Date.now();
    const finish = (v) => {
      if (done) return;
      done = true;
      try { mo.disconnect(); } catch (_) {}
      resolve(v);
    };
    const mo = new MutationObserver(() => {
      if (pageHasName()) finish({ ok: true, waited_ms: Date.now() - start });
    });
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (_) {}
    setTimeout(() => finish({ ok: pageHasName(), waited_ms: Date.now() - start }), timeoutMs);
  }))()`;
}

function attachTextFileExpr(fileName, fileText) {
  const name = JSON.stringify(String(fileName || ""));
  const text = JSON.stringify(String(fileText || ""));
  return `(() => {
    const fileName = ${name};
    const fileText = ${text};
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const input = inputs.find((i) => String(i.getAttribute('accept') || '') === '') || (inputs.length ? inputs[0] : null);
    if (!input) return { ok: false, reason: 'file_input_not_found', count: inputs.length };
    try { input.value = ''; } catch (_) {}
    const dt = new DataTransfer();
    dt.items.add(new File([fileText], fileName, { type: 'text/plain' }));
    try { input.files = dt.files; } catch (e) { return { ok: false, reason: 'assign_failed', error: String(e) }; }
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    const names = input.files ? Array.from(input.files).map((f) => String(f && f.name ? f.name : '')) : [];
    return { ok: true, names };
  })()`;
}

function uploadViaFileChooser(wsUrl, filePath, timeoutMs) {
  const selector = '#upload-files';
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

function isLikelyBinaryFileName(fileName) {
  return /\.(zip|tar|tgz|gz|xz|bz2|7z|bundle|png|jpg|jpeg|webp|gif|pdf)$/i.test(String(fileName || ""));
}

function promptLenExpr() {
  return `(() => {
    const el = document.querySelector('#prompt-textarea') || document.querySelector('form textarea') || document.querySelector('form [contenteditable="true"]');
    if (!el) return { ok: false, reason: 'prompt_not_found' };
    const tag = String(el.tagName || '');
    const value = (tag === 'TEXTAREA' || tag === 'INPUT') ? String(el.value || '') : String(el.innerText || '');
    return { ok: true, len: value.length };
  })()`;
}

function markedInputObjectExpr(marker) {
  const selector = JSON.stringify(`input[data-hq-file-upload-target="${String(marker || "")}"]`);
  return `document.querySelector(${selector})`;
}

function main(args) {
  const filePath = String(args.file || "");
  const fileName = filePath.split("/").pop() || filePath;
  const text = args.textFile ? String(std.loadFile(args.textFile) || "") : String(args.text || "");

  const conn = requireCdp(args.addr, args.port);
  const { target, wsUrl } = requireChatGptTarget(conn, { url: args.url, id: args.id }, { purpose: "upload-chatgpt-file" });

  let nextId = 1;
  const call = (method, params, timeoutMs) => {
    const req = { id: nextId++, method, params: params || {} };
    return cdpCall(wsUrl, req, timeoutMs || 60000);
  };
  const evalByValue = (expression, timeoutMs, awaitPromise) => {
    const resp = cdpEvaluate(wsUrl, expression, {
      id: nextId++,
      returnByValue: true,
      awaitPromise: !!awaitPromise,
      timeoutMs: timeoutMs || 60000,
    });
    return resp && resp.result && resp.result.result ? resp.result.result.value : null;
  };

  try { call("Page.bringToFront", {}); } catch {}
  sleepMs(args.waitMs);

  const before = evalByValue(locateComposerExpr(), 60000, false);
  if (!before || !before.ok) throw new Error("thread composer not found");
  if (before.stop) throw new Error("thread is generating; wait until idle and retry");

  const marker = `hq-upload-${Date.now()}`;
  const marked = evalByValue(markFileInputExpr(marker), 60000, false);
  if (!marked || !marked.ok) throw new Error("failed to mark composer file input: " + JSON.stringify(marked));

  let upload = null;
  try {
    const chooser = uploadViaFileChooser(wsUrl, filePath, args.timeoutMs);
    if (chooser && chooser.parsed && chooser.parsed.ok) {
      upload = { ok: true, mode: "cdp_bridge_filechooser", ...chooser };
    }
  } catch (_) {}

  let nodeId = 0;
  if (!upload) {
  try {
    try { call("DOM.enable", {}, 60000); } catch (_) {}
    const obj = call("Runtime.evaluate", {
      expression: markedInputObjectExpr(marker),
      objectGroup: "hq-file-upload",
      includeCommandLineAPI: false,
      returnByValue: false,
    }, 60000);
    const objectId = obj && obj.result && obj.result.result ? obj.result.result.objectId : null;
    if (objectId) {
      const requested = call("DOM.requestNode", { objectId }, 60000);
      nodeId = requested && requested.result ? requested.result.nodeId : 0;
    }
  } catch (_) {}

  if (!nodeId) {
    const root = call("DOM.getDocument", { depth: -1 }, 60000);
    const rootId = root && root.result && root.result.root ? root.result.root.nodeId : 0;
    if (!rootId) throw new Error("DOM.getDocument returned no root node");

    let q = call("DOM.querySelector", { nodeId: rootId, selector: `input[data-hq-file-upload-target="${marker}"]` }, 60000);
    nodeId = q && q.result ? q.result.nodeId : 0;
    if (!nodeId) {
      q = call("DOM.querySelector", { nodeId: rootId, selector: 'input[type="file"][accept=""]' }, 60000);
      nodeId = q && q.result ? q.result.nodeId : 0;
    }
  }
  }
  if (!upload && nodeId) {
    call("DOM.setFileInputFiles", { nodeId, files: [filePath] }, 60000);
    upload = { ok: true, mode: "dom_setFileInputFiles", nodeId };
  } else if (!upload) {
    if (isLikelyBinaryFileName(fileName)) {
      throw new Error(`binary file requires cdp_bridge_filechooser; refusing text fallback: ${fileName}`);
    }
    const fileText = String(std.loadFile(filePath) || "");
    const fallback = evalByValue(attachTextFileExpr(fileName, fileText), 60000, false);
    if (!fallback || !fallback.ok) {
      throw new Error("could not attach file via DOM or text fallback: " + JSON.stringify(fallback));
    }
    upload = { ...fallback, mode: "datatransfer_text_fallback" };
  }

  let uploaded = null;
  try {
    uploaded = evalByValue(waitForFileVisibleExpr(fileName, args.timeoutMs), args.timeoutMs + 10000, true);
  } catch (e) {
    uploaded = { ok: null, reason: "visibility_probe_failed_after_attach", error: String(e) };
  }

  let send = null;
  let afterType = null;
  if (text.length) {
    mouseClick(call, before.prompt.center.x, before.prompt.center.y);
    sleepMs(50);
    try {
      keyTap(call, "a", "KeyA", 65, 2);
      keyTap(call, "Backspace", "Backspace", 8, 0);
    } catch {}
    const chunkSize = 800;
    for (let i = 0; i < text.length; i += chunkSize) {
      call("Input.insertText", { text: text.slice(i, i + chunkSize) }, 60000);
    }
    afterType = evalByValue(locateComposerExpr(), 60000, false);
    if (afterType && afterType.send && afterType.send.disabled) {
      const start = Date.now();
      let last = afterType;
      while (Date.now() - start < 15000) {
        sleepMs(500);
        last = evalByValue(locateComposerExpr(), 60000, false) || last;
        if (last && last.send && !last.send.disabled) {
          afterType = last;
          break;
        }
      }
    }
    if (afterType && afterType.send && !afterType.send.disabled) {
      mouseClick(call, afterType.send.center.x, afterType.send.center.y);
      send = { how: "click_send" };
    } else {
      keyTap(call, "Enter", "Enter", 13, 0);
      send = { how: "enter" };
    }
    sleepMs(500);
  }

  const after = evalByValue(promptLenExpr(), 30000, false);
  const result = {
    ok: true,
    target: { id: target.id, url: target.url, title: target.title },
    file: { path: filePath, name: fileName },
    before,
    mark: marked,
    attach: upload,
    upload: uploaded,
    afterType,
    send,
    after,
  };

  const out = JSON.stringify(result, null, 2) + "\n";
  if (args.outPath) std.writeFile(args.outPath, out);
  std.out.puts(out);
  std.out.flush();
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
