// domain/auth: ChatGPT ログイン状態の検出/待機/preflight。core に依存(逆は不可)。
import { cdpBridgeJson, cdpEvaluate } from "../core/cdp-client.mjs";
import { cdpError } from "../core/result.mjs";
import { sleepMs } from "../core/proc.mjs";

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
