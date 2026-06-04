import * as std from "./qjs-compat/std.mjs";
import * as os from "./qjs-compat/os.mjs";

// ESM helpers for driving Chromium CDP without jq/node.
// Runtime: quickjs-ng (qjs) in ESM mode; std/os imported from ./qjs-compat/std.mjs and ./qjs-compat/os.mjs.

const DOC_BASE = "cdp://docs/cdp-errors.md";

export class CdpError extends Error {
  constructor(code, detail, docRef, hint) {
    super(detail);
    this.name = "CdpError";
    this.code = code;
    this.detail = detail;
    this.docRef = docRef || `${DOC_BASE}#${code}`;
    this.hint = hint;
    this.ok = false;
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      detail: this.message,
      docRef: this.docRef,
      hint: this.hint || null,
    };
  }
}

export function cdpError(code, detail, hint) {
  return new CdpError(code, detail, null, hint);
}

let nextTmpId = 0;

function tmpPath(prefix) {
  nextTmpId += 1;
  return `/tmp/${prefix}_${os.getpid()}_${Date.now()}_${nextTmpId}`;
}

function popenStatus(file) {
  const status = Number(file.close()) || 0;
  return status > 255 ? (status >> 8) : status;
}

function cloneDefaultValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === "object") return { ...value };
  return value;
}

function hasRequiredValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function shellQuote(value) {
  const s = String(value);
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function shToString(command) {
  const pipe = std.popen(String(command || ""), "r");
  let out = "";
  while (!pipe.eof()) {
    const line = pipe.getline();
    if (line === null) break;
    out += line + "\n";
  }
  const rc = popenStatus(pipe);
  if (rc !== 0) throw new Error(`command failed rc=${rc}: ${String(command || "")}`);
  return out;
}

export function runToString(argv, stdinText) {
  if (!Array.isArray(argv)) return shToString(argv);

  const errPath = tmpPath("cdp_err") + ".txt";
  let inputPath = null;

  try {
    let command = argv.map(shellQuote).join(" ") + ` 2>${shellQuote(errPath)}`;
    if (stdinText !== undefined && stdinText !== null) {
      inputPath = tmpPath("cdp_in") + ".txt";
      std.writeFile(inputPath, String(stdinText));
      command += ` <${shellQuote(inputPath)}`;
    }

    const pipe = std.popen(command, "r");
    let out = "";
    while (!pipe.eof()) {
      const line = pipe.getline();
      if (line === null) break;
      out += line + "\n";
    }
    const rc = popenStatus(pipe);
    if (rc !== 0) {
      const errText = std.loadFile(errPath) || "";
      const suffix = errText ? `: ${String(errText).slice(0, 500)}` : "";
      throw new Error(`command failed rc=${rc}: ${argv.map(String).join(" ")}${suffix}`);
    }
    return out;
  } finally {
    if (errPath) { try { os.remove(errPath); } catch {} }
    if (inputPath) { try { os.remove(inputPath); } catch {} }
  }
}

export function sleepMs(ms) {
  if (ms <= 0) return;
  os.sleep(ms);
}

export function getDefaultAddr() {
  return std.getenv("HQ_CHROME_ADDR") || "127.0.0.1";
}

export function getDefaultPort() {
  return Number(std.getenv("HQ_CHROME_PORT") || "9222") || 9222;
}

export function cdpBridgeJson(args) {
  const out = runToString(["cdp-bridge", ...args]);
  return JSON.parse(out);
}

export function cdpVersion(addr, port) {
  return cdpBridgeJson(["version", "--addr", addr, "--port", String(port)]);
}

export function cdpWsUrl(addr, port) {
  return runToString(["cdp-bridge", "wsurl", "--addr", addr, "--port", String(port)]).trim();
}

export function cdpList(addr, port) {
  return cdpBridgeJson(["list", "--addr", addr, "--port", String(port)]);
}

export function cdpNew(addr, port, url) {
  return cdpBridgeJson(["new", "--addr", addr, "--port", String(port), "--url", url]);
}

export function cdpClose(addr, port, id) {
  return cdpBridgeJson(["close", "--addr", addr, "--port", String(port), "--id", id]);
}

export function cdpCall(wsUrl, reqObj, timeoutMs) {
  const argv = ["call", "--ws", wsUrl, "--req", JSON.stringify(reqObj)];
  if (timeoutMs !== undefined && timeoutMs !== null) {
    argv.push("--timeout-ms", String(timeoutMs));
  }
  return cdpBridgeJson(argv);
}

export function cdpEvaluate(wsUrl, expression, opts) {
  const o = opts || {};
  const req = {
    id: o.id || 1,
    method: "Runtime.evaluate",
    params: {
      expression,
      returnByValue: o.returnByValue !== false,
      awaitPromise: o.awaitPromise === true,
    },
  };
  return cdpCall(wsUrl, req, o.timeoutMs || 60000);
}

export function mkCaller(wsUrl) {
  let nextId = 1;
  const shouldRetry = (e) => String(e || "").includes("WouldBlock");
  const withRetry = (fn) => {
    let last = null;
    for (let i = 0; i < 4; i++) {
      try {
        return fn();
      } catch (e) {
        last = e;
        if (!shouldRetry(e) || i === 3) throw e;
        sleepMs(150 + i * 200);
      }
    }
    throw last || new Error("retry failed");
  };

  const call = (method, params, timeoutMs) => {
    const req = { id: nextId++, method, params: params || {} };
    return withRetry(() => cdpCall(wsUrl, req, timeoutMs || 60000));
  };

  const evalDetailed = (expression, opts) => {
    const o = opts || {};
    const req = {
      id: nextId++,
      method: "Runtime.evaluate",
      params: {
        expression,
        returnByValue: true,
        awaitPromise: !!o.awaitPromise,
      },
    };
    const resp = withRetry(() => cdpCall(wsUrl, req, o.timeoutMs || 60000));
    const result = resp && resp.result ? resp.result : null;
    const remoteObject = result && result.result ? result.result : null;
    const hasValue = !!(remoteObject && Object.prototype.hasOwnProperty.call(remoteObject, "value"));
    const value = hasValue ? remoteObject.value : undefined;
    const exceptionDetails = result && result.exceptionDetails ? result.exceptionDetails : null;
    return { resp, hasValue, value, remoteObject, exceptionDetails };
  };

  const evalValue = (expression, opts) => {
    const details = evalDetailed(expression, opts);
    return details.hasValue ? details.value : null;
  };

  return { call, evalValue, evalDetailed };
}

export function pollUntil(fn, opts) {
  const o = opts || {};
  const timeoutMs = Math.max(0, Number(o.timeoutMs) || 0);
  const pollMs = Math.max(1, Number(o.pollMs) || 200);
  const label = String(o.label || "condition");
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (true) {
    try {
      const value = fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }

    if (Date.now() >= deadline) break;
    sleepMs(pollMs);
  }

  if (lastError) {
    throw new Error(`timeout waiting for ${label}: ${String(lastError && lastError.message ? lastError.message : lastError)}`);
  }
  throw new Error(`timeout waiting for ${label}`);
}

export function isHeadlessMode() {
  return std.getenv("HQ_CHROME_HEADLESS") === "1";
}

export function getChromeProfileDir() {
  return std.getenv("HQ_CHROME_PROFILE_DIR") || (std.getenv("HOME") + "/.secret/hq/chromium-cdp-profile");
}

export function detectLoginState(wsUrl) {
  const expr = `(() => {
    const body = document.body ? document.body.innerText.slice(0, 1000) : "";
    const title = document.title || "";
    const hasChatGPTLoggedIn = !!document.querySelector("[data-testid='conversations-list']") ||
                               !!document.querySelector("nav[aria-label='Main navigation']");
    const isCloudflare = title.includes("Just a moment") || body.includes("Cloudflare");
    const isLoginPage = body.includes("Sign in") || body.includes("login") || title.includes("Log in");
    return {
      logged_in: hasChatGPTLoggedIn,
      cloudflare: isCloudflare,
      login_page: isLoginPage,
      title: document.title,
      url: location.href,
    };
  })()`;

  try {
    const resp = cdpEvaluate(wsUrl, expr, { timeoutMs: 30000 });
    return resp && resp.result && resp.result.result ? resp.result.result.value : null;
  } catch (_) {
    return null;
  }
}

export function waitForLogin(wsUrl, opts) {
  const o = opts || {};
  const intervalMin = o.intervalMin || 2000;
  const intervalMax = o.intervalMax || 5000;
  const maxTries = o.maxTries || 30;
  const maxDurationMs = o.maxDurationMs || 120000;
  const startTime = Date.now();
  const deadline = startTime + maxDurationMs;

  for (let i = 0; i < maxTries; i++) {
    const state = detectLoginState(wsUrl);
    if (state && state.logged_in && !state.cloudflare && !state.login_page) {
      return { ok: true, state, tries: i + 1 };
    }
    if (Date.now() >= deadline) break;
    const interval = intervalMin + Math.random() * (intervalMax - intervalMin);
    sleepMs(interval);
  }

  const finalState = detectLoginState(wsUrl);
  return {
    ok: false,
    state: finalState,
    tries: maxTries,
    reason: finalState && finalState.cloudflare ? "cloudflare" :
            finalState && finalState.login_page ? "login_required" : "timeout",
  };
}

export function preflightCheck(addr, port, targetUrl, opts) {
  const o = opts || {};
  const waitMs = o.waitMs || 8000;
  const timeoutMs = o.timeoutMs || 60000;
  const allowGenerating = o.allowGenerating === true;

  try {
    cdpBridgeJson(["version", "--addr", addr, "--port", String(port)]);
  } catch (_) {
    return {
      ok: false,
      error: cdpError(
        "BROWSER_NOT_RUNNING",
        `Chrome not responding at ${addr}:${port}`,
        "Start Chromium: chromium-cdp",
      ),
    };
  }

  let targets;
  try {
    targets = cdpBridgeJson(["list", "--addr", addr, "--port", String(port)]);
  } catch (_) {
    return {
      ok: false,
      error: cdpError(
        "CDP_UNAVAILABLE",
        `CDP endpoint not responding at ${addr}:${port}`,
        "Restart Chromium: pkill chromium; chromium-cdp",
      ),
    };
  }

  const pages = (targets || []).filter((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
  const url = String(targetUrl || "");
  let tab = null;
  if (url) {
    tab = pages.find((t) => String(t.url || "") === url) ||
          pages.find((t) => String(t.url || "").startsWith(url));
    if (!tab) {
      const cid = url.match(/\/c\/([0-9a-fA-F-]{16,})/);
      if (cid) tab = pages.find((t) => String(t.url || "").includes(cid[1]));
    }
  }
  if (!tab && pages.length > 0) tab = pages[0];

  if (!tab) {
    return {
      ok: false,
      error: cdpError(
        "TARGET_NOT_FOUND",
        `No tab found for URL: ${targetUrl}`,
        `Open tab: cdp-bridge new --url "${targetUrl}"`,
      ),
    };
  }

  if (!tab.webSocketDebuggerUrl) {
    return {
      ok: false,
      error: cdpError(
        "TAB_NOT_CONNECTED",
        `Tab found but WebSocket URL is invalid for: ${tab.url || targetUrl}`,
        "Close stale tab and reopen: cdp-bridge close --id <id>; cdp-bridge new --url <url>",
      ),
    };
  }

  try {
    const loginCheck = cdpEvaluate(tab.webSocketDebuggerUrl, `
      (() => {
        const form = document.querySelector('form[action*="login"]');
        const url = window.location.href;
        return { hasLoginForm: !!form, url: url };
      })()
    `, { id: 999, timeoutMs });

    const val = loginCheck && loginCheck.result && loginCheck.result.result ? loginCheck.result.result.value : null;
    if (val && val.hasLoginForm) {
      return {
        ok: false,
        error: cdpError(
          "LOGIN_REQUIRED",
          "ChatGPT login required. Login form detected.",
          "Open chatgpt.com, login manually (one-time), then retry",
        ),
      };
    }
  } catch (_) {}

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const readyCheck = cdpEvaluate(tab.webSocketDebuggerUrl, `
        (() => ({ readyState: document.readyState, title: document.title }))()
      `, { id: 998, timeoutMs: 5000 });
      const val = readyCheck && readyCheck.result && readyCheck.result.result ? readyCheck.result.result.value : null;
      if (val && val.readyState === "complete") {
        try {
          const genCheck = cdpEvaluate(tab.webSocketDebuggerUrl, `
            (() => {
              const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"]');
              return { generating: !!stop };
            })()
          `, { id: 997, timeoutMs: 5000 });
          const genVal = genCheck && genCheck.result && genCheck.result.result ? genCheck.result.result.value : null;
          if (genVal && genVal.generating && !allowGenerating) {
            return {
              ok: false,
              error: cdpError(
                "GENERATING",
                "GPT is still generating a response. Stop button visible.",
                "Wait for generation to complete or click stop, then retry",
              ),
            };
          }
        } catch (_) {}

        return { ok: true, tab, wsUrl: tab.webSocketDebuggerUrl };
      }
    } catch (_) {}
    sleepMs(250);
  }

  return {
    ok: false,
    error: cdpError(
      "PAGE_LOADING",
      `Page still loading after ${waitMs}ms for: ${targetUrl}`,
      `Increase wait time: --waitMs ${waitMs * 2}`,
    ),
  };
}

export function parseArgs(argv, spec) {
  const options = spec || {};
  const defaults = options.defaults || {};
  const flags = options.flags || {};
  const out = {};

  for (const key of Object.keys(defaults)) {
    out[key] = cloneDefaultValue(defaults[key]);
  }

  const configuredStartIndex = Number.isFinite(options.startIndex) ? options.startIndex : 1;
  const onError = options.onError === "null" ? "null" : "throw";
  const allowUnknown = options.allowUnknown === true;
  const helpFlags = options.helpFlags === false ? [] : (options.helpFlags || ["-h", "--help"]);
  const onHelp = options.onHelp || "null";
  const helpKey = options.helpKey || "help";
  const reportError = typeof options.reportError === "function"
    ? options.reportError
    : (options.reportError
        ? (msg) => {
            std.err.puts(String(msg) + "\n");
            std.err.flush();
          }
        : null);

  const byName = Object.create(null);
  const entries = [];

  const addNames = (key, def) => {
    const raw = def && (def.names || def.name);
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [`--${key}`];
    return list.map((name) => (String(name).startsWith("-") ? String(name) : `--${String(name)}`));
  };

  const fail = (msg) => {
    if (reportError) {
      try { reportError(msg); } catch {}
    }
    if (onError === "null") return null;
    throw new Error(msg);
  };

  for (const key of Object.keys(flags)) {
    const def = flags[key] || {};
    const entry = { key, def, names: addNames(key, def) };
    entries.push(entry);
    if (!(key in out) && def.multiple) out[key] = [];
    for (const name of entry.names) byName[name] = entry;
  }

  let startIndex = configuredStartIndex;
  if (startIndex === 1 && Array.isArray(argv) && argv.length > 0) {
    const firstArg = String(argv[0] || "");
    if (firstArg.startsWith("-")) startIndex = 0;
  }

  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (helpFlags.indexOf(arg) >= 0) {
      if (onHelp === "set") {
        out[helpKey] = true;
        continue;
      }
      return null;
    }

    const entry = byName[arg];
    if (!entry) {
      if (allowUnknown) continue;
      return fail(`unknown arg: ${arg}`);
    }

    const def = entry.def || {};
    const boolFlag = def.type === "boolean" || def.boolean === true || def.flag === true;

    if (boolFlag) {
      const value = Object.prototype.hasOwnProperty.call(def, "value") ? def.value : true;
      if (typeof def.set === "function") def.set(out, value, value, arg, argv, i);
      else if (def.multiple) {
        if (!Array.isArray(out[entry.key])) out[entry.key] = [];
        out[entry.key].push(value);
      } else out[entry.key] = value;
      continue;
    }

    if (i + 1 >= argv.length) return fail(`missing value for ${arg}`);
    const raw = argv[++i];
    let value;
    if (typeof def.parse === "function") value = def.parse(raw, out[entry.key], out, arg, argv, i);
    else if (def.type === "number") value = Number(raw);
    else value = raw;

    if (value === undefined && def.skipUndefined) continue;
    if (typeof def.validate === "function" && !def.validate(value, out, raw)) {
      return fail(def.invalidMessage || `invalid value for ${arg}: ${raw}`);
    }

    if (typeof def.set === "function") def.set(out, value, raw, arg, argv, i);
    else if (def.multiple) {
      if (!Array.isArray(out[entry.key])) out[entry.key] = [];
      out[entry.key].push(value);
    } else out[entry.key] = value;
  }

  for (const entry of entries) {
    if (!entry.def || !entry.def.required) continue;
    if (!hasRequiredValue(out[entry.key])) {
      return fail(`missing required flag: ${entry.names[0]}`);
    }
  }

  if (typeof options.finalize === "function") {
    const finalized = options.finalize(out);
    if (finalized === null) return null;
    if (finalized === false) return fail(options.finalizeError || "invalid arguments");
    if (finalized !== undefined) return finalized;
  }

  return out;
}


function defaultErrorText(error) {
  const message = String(error && error.message ? error.message : error);
  const stack = error && error.stack ? String(error.stack) : "";
  if (!stack) return message;
  if (stack.indexOf(message) >= 0) return stack;
  return message + "\n" + stack;
}

export function run(argv, spec) {
  const options = spec || {};
  const buildArgs = typeof options.buildArgs === "function" ? options.buildArgs : null;
  const main = typeof options.main === "function" ? options.main : null;
  const usage = typeof options.usage === "function" ? options.usage : null;
  const nullExitCode = Number.isFinite(options.nullExitCode) ? options.nullExitCode : 2;
  const errorExitCode = Number.isFinite(options.errorExitCode) ? options.errorExitCode : 1;
  const formatError = typeof options.formatError === "function"
    ? options.formatError
    : (error) => {
        std.err.puts(defaultErrorText(error) + "\n");
        std.err.flush();
      };

  if (!main) throw new Error("run() requires main");

  try {
    const parsed = buildArgs ? buildArgs(argv) : argv;
    if (parsed === null || parsed === undefined) {
      if (usage) usage();
      std.exit(nullExitCode);
      return;
    }
    const rc = main(parsed, argv);
    std.exit(typeof rc === "number" ? rc : 0);
  } catch (error) {
    formatError(error);
    std.exit(errorExitCode);
  }
}
