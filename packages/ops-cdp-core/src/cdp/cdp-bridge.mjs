#!/usr/bin/env node
// Minimal CDP bridge (node)。cdp-bridge.py の置換(脱python/zig)。
// コマンド契約は従来(zig/python)版と一致:
//   cdp-bridge version|wsurl|list [--addr 127.0.0.1] [--port 9222]
//   cdp-bridge new   [--addr] [--port] [--url about:blank]
//   cdp-bridge close [--addr] [--port] --id <targetId>
//   cdp-bridge call  --ws <ws://...> --req <json(id必須)> [--timeout-ms 30000]
//   cdp-bridge filechooser --ws <ws> --selector <css> --file <path> [...] [--click-mode direct|mouse|programmatic] [--timeout-ms]
// WebSocket は node 標準 global WebSocket を使用(手書き framing 不要)。
import { basename, resolve as pathResolve } from "node:path";

class BridgeError extends Error {}

function usage() {
  return (
    "cdp-bridge: minimal CDP helper (HTTP + WebSocket)\n\n" +
    "usage:\n" +
    "  cdp-bridge version [--addr 127.0.0.1] [--port 9222]\n" +
    "  cdp-bridge wsurl   [--addr 127.0.0.1] [--port 9222]\n" +
    "  cdp-bridge list    [--addr 127.0.0.1] [--port 9222]\n" +
    "  cdp-bridge new     [--addr 127.0.0.1] [--port 9222] [--url about:blank]\n" +
    "  cdp-bridge close   [--addr 127.0.0.1] [--port 9222] --id <targetId>\n" +
    "  cdp-bridge call    --ws <ws://...> --req <json> [--timeout-ms 30000]\n" +
    "  cdp-bridge filechooser --ws <ws://...> --selector <css> --file <path> [--file <path> ...] [--click-mode direct|mouse|programmatic] [--timeout-ms 30000]\n"
  );
}

function flagValue(argv, flag) {
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) return i + 1 < argv.length ? argv[i + 1] : null;
  return null;
}
function flagValues(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && i + 1 < argv.length) { out.push(argv[i + 1]); i++; }
  return out;
}
function parseAddrPort(argv) {
  let addr = "127.0.0.1", port = 9222;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--addr") { if (i + 1 >= argv.length) throw new BridgeError("missing value for --addr"); addr = argv[++i]; }
    else if (argv[i] === "--port") {
      if (i + 1 >= argv.length) throw new BridgeError("missing value for --port");
      port = Number.parseInt(argv[++i], 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new BridgeError(`invalid port`);
    }
  }
  return { addr, port };
}
function parseTimeoutMs(v) {
  if (v == null) return 30000;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0) throw new BridgeError(`invalid timeout: ${v}`);
  return n;
}

async function httpRequest(addr, port, method, path, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(timeoutMs, 1));
  try {
    const res = await fetch(`http://${addr}:${port}${path}`, { method, signal: ctrl.signal });
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// write_json_or_string 互換: {/[ で始まれば trim 済 raw を、そうでなければ JSON 文字列化。
function writeJsonOrString(text) {
  const stripped = text.trim();
  if (stripped.startsWith("{") || stripped.startsWith("[")) { process.stdout.write(stripped + "\n"); return; }
  process.stdout.write(JSON.stringify(text.replace(/[\r\n]+$/, "")) + "\n");
}

// --- WebSocket 接続(id/method で待つ) ---
class WsConn {
  constructor() { this.msgs = []; this._wake = null; }
  static async open(url, timeoutMs) {
    const c = new WsConn();
    c.ws = new WebSocket(url);
    c.ws.addEventListener("message", (ev) => {
      let parsed = null;
      try { parsed = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch { parsed = null; }
      c.msgs.push({ raw: typeof ev.data === "string" ? ev.data : ev.data.toString(), parsed, used: false });
      if (c._wake) { const w = c._wake; c._wake = null; w(); }
    });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new BridgeError("websocket handshake timeout")), Math.max(timeoutMs, 1));
      c.ws.addEventListener("open", () => { clearTimeout(to); res(); }, { once: true });
      c.ws.addEventListener("error", () => { clearTimeout(to); rej(new BridgeError("websocket handshake failed")); }, { once: true });
    });
    return c;
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async waitFor(pred, timeoutMs) {
    const deadline = timeoutMs > 0 ? performanceNow() + timeoutMs : Infinity;
    for (;;) {
      const m = this.msgs.find((x) => !x.used && x.parsed && pred(x.parsed));
      if (m) { m.used = true; return m.raw; }
      const remaining = deadline - performanceNow();
      if (timeoutMs > 0 && remaining <= 0) throw new BridgeError("timeout waiting for response");
      await new Promise((res) => {
        this._wake = res;
        if (timeoutMs > 0) setTimeout(() => { if (this._wake) { this._wake = null; res(); } }, Math.max(remaining, 1));
      });
    }
  }
  async sendAndWaitId(req, id, timeoutMs) { this.send(req); return this.waitFor((p) => p.id === id, timeoutMs); }
  async waitMethod(method, timeoutMs) { return this.waitFor((p) => p.method === method, timeoutMs); }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}
// Date.now 相当(monotonic 近似)。
function performanceNow() { return Number(process.hrtime.bigint() / 1000000n); }

async function wsCall(wsUrl, requestJson, timeoutMs) {
  let req;
  try { req = JSON.parse(requestJson); } catch { throw new BridgeError("invalid request JSON"); }
  if (typeof req !== "object" || req === null || !("id" in req)) throw new BridgeError("request JSON must be an object with id");
  const conn = await WsConn.open(wsUrl, timeoutMs);
  try {
    conn.ws.send(requestJson);
    return await conn.waitFor((p) => p.id === req.id, timeoutMs);
  } finally { conn.close(); }
}

// --- filechooser 用 JS 式(python と同一) ---
function buildCenterExpr(selector) {
  const sel = JSON.stringify(selector);
  return `(() => { const sel = ${sel}; const el = document.querySelector(sel); if (!el) return { ok: false, reason: 'not_found', selector: sel }; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {} const r = el.getBoundingClientRect(); return { ok: true, selector: sel, x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
}
function buildClickExpr(selector) {
  const sel = JSON.stringify(selector);
  return `(() => { const sel = ${sel}; const el = document.querySelector(sel); if (!el) return { ok: false, reason: 'not_found', selector: sel }; el.click(); return { ok: true, selector: sel, id: String(el.id || ''), tag: String(el.tagName || ''), type: String(el.type || '') }; })()`;
}
function buildVerifyExpr(filePaths) {
  const names = JSON.stringify(filePaths.map((p) => basename(p)));
  return `(() => { const names = ${names}; const inputs = Array.from(document.querySelectorAll('input[type=file]')); const picked = inputs.map((i) => { try { return { accept: String(i.accept||''), n: (i.files?i.files.length:0), names: i.files?Array.from(i.files).map((f)=>f.name):[] }; } catch (e) { return { accept: String(i.accept||''), n: 0, names: [] }; } }); const visible = names.map((name) => ({ name, ok: picked.some((x) => (x.names || []).includes(name)) || String(document.body && document.body.innerText || '').includes(name) })); const aria = Array.from(document.querySelectorAll('[aria-label]')).map((e)=>String(e.getAttribute('aria-label')||'')); const hasTile = names.some((name) => aria.includes(name)); return { href: location.href, title: document.title, visible, ok: visible.every((row) => row.ok), inputs: picked, has_aria_label_tile: hasTile }; })()`;
}
function buildDispatchFileChangeExpr(selector) {
  const sel = JSON.stringify(selector);
  return `(() => { const sel = ${sel}; const el = document.querySelector(sel); if (!el) return { ok: false, reason: 'not_found', selector: sel }; const before = { n: el.files ? el.files.length : 0, names: el.files ? Array.from(el.files).map((f) => f.name) : [] }; try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {} try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} return { ok: true, selector: sel, id: String(el.id || ''), tag: String(el.tagName || ''), type: String(el.type || ''), before }; })()`;
}
function buildAddSourcesButtonExpr() {
  return `(() => { const candidates = Array.from(document.querySelectorAll('button,[role="button"]')); const el = candidates.find((x) => String(x.innerText || x.textContent || '').trim() === 'Add sources'); if (!el) return { ok: false, reason: 'not_found' }; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {} const r = el.getBoundingClientRect(); return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: String(el.innerText || el.textContent || '') }; })()`;
}
function requireInt(v, field) { if (!Number.isInteger(v)) throw new BridgeError(`expected integer ${field}`); return v; }

async function dispatchMouseClick(conn, nextId, x, y, timeoutMs) {
  const events = [
    { type: "mouseMoved", x, y, button: "none", buttons: 0 },
    { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 },
    { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 },
  ];
  for (const params of events) { await conn.sendAndWaitId({ id: nextId, method: "Input.dispatchMouseEvent", params }, nextId, timeoutMs); nextId++; }
  return nextId;
}

async function wsDirectSetFileInput(conn, nextId, selector, filePaths, timeoutMs) {
  const doc = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "DOM.getDocument", params: { depth: 1, pierce: true } }, nextId, timeoutMs)); nextId++;
  const rootId = doc?.result?.root?.nodeId;
  if (!Number.isInteger(rootId)) throw new BridgeError("DOM.getDocument did not return root nodeId");
  const query = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "DOM.querySelector", params: { nodeId: rootId, selector } }, nextId, timeoutMs)); nextId++;
  const nodeId = query?.result?.nodeId;
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    const trigger = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Runtime.evaluate", params: { expression: buildAddSourcesButtonExpr(), returnByValue: true, awaitPromise: false, userGesture: false } }, nextId, timeoutMs)); nextId++;
    const tv = trigger?.result?.result?.value || {};
    if (!tv.ok) throw new BridgeError(`file input not found and Add sources button not found: ${selector}`);
    nextId = await dispatchMouseClick(conn, nextId, Number(tv.x || 0), Number(tv.y || 0), timeoutMs);
    const evt = JSON.parse(await conn.waitMethod("Page.fileChooserOpened", timeoutMs));
    const backendNodeId = requireInt(evt?.params?.backendNodeId, "backendNodeId");
    const setFiles = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "DOM.setFileInputFiles", params: { backendNodeId, files: filePaths } }, nextId, timeoutMs)); nextId++;
    return [nextId, { mode: "add_sources_button_filechooser", backendNodeId, document: doc, querySelector: query, addSourcesButton: trigger, fileChooserOpened: evt, setFileInputFiles: setFiles }];
  }
  let scrollObj;
  try { scrollObj = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "DOM.scrollIntoViewIfNeeded", params: { nodeId } }, nextId, timeoutMs)); }
  catch (e) { scrollObj = { ok: false, ignored_error: String(e) }; }
  nextId++;
  const setFiles = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "DOM.setFileInputFiles", params: { nodeId, files: filePaths } }, nextId, timeoutMs)); nextId++;
  const dispatch = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Runtime.evaluate", params: { expression: buildDispatchFileChangeExpr(selector), returnByValue: true, awaitPromise: false, userGesture: true } }, nextId, timeoutMs)); nextId++;
  return [nextId, { mode: "direct_file_input", nodeId, document: doc, querySelector: query, scrollIntoViewIfNeeded: scrollObj, setFileInputFiles: setFiles, dispatchInputChange: dispatch }];
}

async function wsFilechooser(wsUrl, selector, filePaths, timeoutMs, clickMode) {
  const conn = await WsConn.open(wsUrl, timeoutMs);
  let nextId = 1;
  try {
    const runtimeEnable = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Runtime.enable", params: {} }, nextId, timeoutMs)); nextId++;
    const domEnable = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "DOM.enable", params: {} }, nextId, timeoutMs)); nextId++;
    const pageEnable = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Page.enable", params: {} }, nextId, timeoutMs)); nextId++;
    const bringToFront = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Page.bringToFront", params: {} }, nextId, timeoutMs)); nextId++;
    const interceptOn = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Page.setInterceptFileChooserDialog", params: { enabled: true } }, nextId, timeoutMs)); nextId++;
    const center = await conn.sendAndWaitId({ id: nextId, method: "Runtime.evaluate", params: { expression: buildCenterExpr(selector), returnByValue: true, awaitPromise: false, userGesture: false } }, nextId, timeoutMs);
    const centerObj = JSON.parse(center)?.result?.result?.value || {}; nextId++;
    let clickRecord, fileChooserOpened = null, setFiles;
    if (clickMode === "direct") {
      const [nid, direct] = await wsDirectSetFileInput(conn, nextId, selector, filePaths, timeoutMs); nextId = nid;
      clickRecord = JSON.stringify({ mode: clickMode, direct });
      setFiles = JSON.stringify(direct.setFileInputFiles);
    } else if (clickMode === "programmatic") {
      conn.send({ id: nextId, method: "Runtime.evaluate", params: { expression: buildClickExpr(selector), returnByValue: true, awaitPromise: false, userGesture: true } });
      clickRecord = JSON.stringify({ id: nextId, mode: clickMode, sent: true }); nextId++;
      fileChooserOpened = await conn.waitMethod("Page.fileChooserOpened", timeoutMs);
    } else if (clickMode === "mouse") {
      if (!centerObj.ok) throw new BridgeError(`selector not clickable: ${JSON.stringify(centerObj)}`);
      nextId = await dispatchMouseClick(conn, nextId, Number(centerObj.x || 0), Number(centerObj.y || 0), timeoutMs);
      clickRecord = JSON.stringify({ mode: clickMode, x: centerObj.x, y: centerObj.y });
      fileChooserOpened = await conn.waitMethod("Page.fileChooserOpened", timeoutMs);
    } else throw new BridgeError(`invalid click mode: ${clickMode}`);
    let backendNodeId = null, evt = null;
    if (fileChooserOpened !== null) {
      evt = JSON.parse(fileChooserOpened);
      backendNodeId = requireInt(evt?.params?.backendNodeId, "backendNodeId");
      setFiles = await conn.sendAndWaitId({ id: nextId, method: "DOM.setFileInputFiles", params: { backendNodeId, files: filePaths } }, nextId, timeoutMs); nextId++;
    }
    const interceptOff = JSON.parse(await conn.sendAndWaitId({ id: nextId, method: "Page.setInterceptFileChooserDialog", params: { enabled: false } }, nextId, timeoutMs)); nextId++;
    const verify = await conn.sendAndWaitId({ id: nextId, method: "Runtime.evaluate", params: { expression: buildVerifyExpr(filePaths), returnByValue: true, awaitPromise: false, userGesture: false } }, nextId, timeoutMs);
    const result = {
      ok: true, backendNodeId,
      runtime_enable: runtimeEnable, dom_enable: domEnable, page_enable: pageEnable, bring_to_front: bringToFront,
      intercept_on: interceptOn, center: JSON.parse(center), click: JSON.parse(clickRecord),
      fileChooserOpened: evt, setFileInputFiles: setFiles ? JSON.parse(typeof setFiles === "string" ? setFiles : JSON.stringify(setFiles)) : undefined,
      intercept_off: interceptOff, verify: JSON.parse(verify),
    };
    return JSON.stringify(result);
  } finally { conn.close(); }
}

async function main(argv) {
  if (argv.length < 1 || ["-h", "--help", "help"].includes(argv[0])) { process.stderr.write(usage()); return argv.length >= 1 ? 0 : 2; }
  const cmd = argv[0];
  const rest = argv;
  try {
    if (cmd === "version") { const { addr, port } = parseAddrPort(rest); writeJsonOrString(await httpRequest(addr, port, "GET", "/json/version")); return 0; }
    if (cmd === "wsurl") {
      const { addr, port } = parseAddrPort(rest);
      const obj = JSON.parse(await httpRequest(addr, port, "GET", "/json/version"));
      if (typeof obj.webSocketDebuggerUrl !== "string") throw new BridgeError("missing webSocketDebuggerUrl");
      process.stdout.write(obj.webSocketDebuggerUrl + "\n"); return 0;
    }
    if (cmd === "list") { const { addr, port } = parseAddrPort(rest); writeJsonOrString(await httpRequest(addr, port, "GET", "/json/list")); return 0; }
    if (cmd === "new") {
      const { addr, port } = parseAddrPort(rest);
      const url = flagValue(rest, "--url") || "about:blank";
      const safe = encodeURI(url);
      writeJsonOrString(await httpRequest(addr, port, "PUT", `/json/new?${safe}`)); return 0;
    }
    if (cmd === "close") {
      const { addr, port } = parseAddrPort(rest);
      const id = flagValue(rest, "--id");
      if (id == null) throw new BridgeError("missing: --id");
      writeJsonOrString(await httpRequest(addr, port, "PUT", `/json/close/${encodeURIComponent(id)}`)); return 0;
    }
    if (cmd === "call") {
      const ws = flagValue(rest, "--ws"), req = flagValue(rest, "--req");
      if (ws == null) throw new BridgeError("missing: --ws");
      if (req == null) throw new BridgeError("missing: --req");
      process.stdout.write((await wsCall(ws, req, parseTimeoutMs(flagValue(rest, "--timeout-ms")))) + "\n"); return 0;
    }
    if (cmd === "filechooser") {
      const ws = flagValue(rest, "--ws"), selector = flagValue(rest, "--selector"), files = flagValues(rest, "--file");
      const clickMode = flagValue(rest, "--click-mode") || "mouse";
      if (ws == null) throw new BridgeError("missing: --ws");
      if (selector == null) throw new BridgeError("missing: --selector");
      if (!files.length) throw new BridgeError("missing: --file");
      process.stdout.write((await wsFilechooser(ws, selector, files.map((p) => pathResolve(p)), parseTimeoutMs(flagValue(rest, "--timeout-ms")), clickMode)) + "\n"); return 0;
    }
    process.stderr.write(`unknown command: ${cmd}\n`); process.stderr.write(usage()); return 2;
  } catch (e) {
    process.stderr.write(`cdp-bridge:error:${e instanceof Error ? e.message : e}\n`); return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
