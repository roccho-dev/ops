import { mkCaller, sleepMs } from "./lib.mjs";

const CHATGPT_AUTH_COOKIE_NAMES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

const CHATGPT_PREAUTH_COOKIE_NAMES = [
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "__Host-authjs.csrf-token",
  "__Secure-authjs.callback-url",
  "oai-did",
];

function hasCookiePrefix(byName, prefix) {
  const want = String(prefix || "");
  if (!want) return false;
  return Object.keys(byName || {}).some((name) => name === want || name.startsWith(`${want}.`));
}

function cookieMapFromResult(resp) {
  const cookies = resp && resp.result && Array.isArray(resp.result.cookies) ? resp.result.cookies : [];
  const names = Object.create(null);
  for (const cookie of cookies) {
    const name = String((cookie && cookie.name) || "");
    if (!name) continue;
    names[name] = cookie;
  }
  return names;
}

function getAuthCookieState(wsUrl, urls) {
  const caller = mkCaller(wsUrl);
  const resp = caller.call("Network.getCookies", { urls }, 5000);
  const byName = cookieMapFromResult(resp);
  const authCookies = CHATGPT_AUTH_COOKIE_NAMES.filter((name) => hasCookiePrefix(byName, name));
  const preauthCookies = CHATGPT_PREAUTH_COOKIE_NAMES.filter((name) => hasCookiePrefix(byName, name));
  return { authCookies, preauthCookies, byName };
}

function buildChatGptProbeExpr() {
  return `(() => {
    const body = document.body ? document.body.innerText.slice(0, 1000) : "";
    const title = document.title || "";
    const hasLoggedIn = !!document.querySelector("[data-testid='conversations-list']") ||
                        !!document.querySelector("nav[aria-label='Main navigation']");
    const isChallenge = title.includes("Just a moment") || body.includes("Cloudflare");
    const isLoginPage = body.includes("Sign in") || body.includes("login") || title.includes("Log in");
    return {
      logged_in: hasLoggedIn,
      cloudflare: isChallenge,
      login_page: isLoginPage,
      title: document.title,
      url: location.href
    };
  })()`;
}

function classifyCommonState(state, target) {
  if (!state) {
    return {
      ok: false,
      status: "probe-failed",
      reason: "AUTH_PROBE_TRANSPORT_FAILED",
      title: String(target.title || ""),
      url: String(target.url || ""),
    };
  }

  let status = "unknown";
  let reason = "UNKNOWN";
  if (state.logged_in && !state.cloudflare && !state.login_page) {
    status = "logged-in";
    reason = "OK";
  } else if (state.cloudflare) {
    status = "challenge-blocked";
    reason = "CLOUDFLARE";
  } else if (state.unauthenticated) {
    status = "unauthenticated";
    reason = "NO_AUTH_SESSION_COOKIE";
  } else if (state.login_page) {
    status = "login-required";
    reason = "LOGIN_REQUIRED";
  }

  return {
    ok: status === "logged-in",
    status,
    reason,
    title: String(state.title || target.title || ""),
    url: String(state.url || target.url || ""),
  };
}

function probeState(wsUrl, expression, target) {
  const caller = mkCaller(wsUrl);
  let state = null;
  let lastError = null;

  for (let i = 0; i < 3; i++) {
    try {
      state = caller.evalValue(expression, { timeoutMs: 5000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      sleepMs(300 + (i * 300));
    }
  }

  if (!state && lastError) {
    return {
      ok: false,
      status: "probe-failed",
      reason: "AUTH_PROBE_TRANSPORT_FAILED",
      title: String(target.title || ""),
      url: String(target.url || ""),
    };
  }

  return classifyCommonState(state, target);
}

function buildUnauthenticatedResult(target, detail) {
  const result = {
    ok: false,
    status: "unauthenticated",
    reason: "NO_AUTH_SESSION_COOKIE",
    title: String(target.title || ""),
    url: String(target.url || ""),
    hint: "Open chatgpt.com, login manually once in this Linux Chromium profile, then retry",
  };
  if (detail && detail.preauthCookies && detail.preauthCookies.length) {
    result.preauthCookies = detail.preauthCookies;
  }
  return result;
}

const adapters = {
  chatgpt: {
    name: "chatgpt",
    matchPrefix: "https://chatgpt.com",
    hint: "chromium-cdp 'https://chatgpt.com/'",
    classifyTarget(target) {
      const wsUrl = String(target.webSocketDebuggerUrl || "");
      if (!wsUrl) {
        return {
          ok: false,
          status: "probe-failed",
          reason: "AUTH_PROBE_TRANSPORT_FAILED",
          title: String(target.title || ""),
          url: String(target.url || ""),
        };
      }
      try {
        const cookieState = getAuthCookieState(wsUrl, [
          "https://chatgpt.com/",
          "https://chatgpt.com/api/auth/session",
          "https://openai.com/",
        ]);
        if (cookieState.authCookies.length > 0) {
          return {
            ok: true,
            status: "logged-in",
            reason: "AUTH_SESSION_COOKIE_PRESENT",
            title: String(target.title || ""),
            url: String(target.url || ""),
            authCookies: cookieState.authCookies,
          };
        }
        if (cookieState.preauthCookies.length > 0) {
          return buildUnauthenticatedResult(target, cookieState);
        }
      } catch {
        // Fall through to weaker signals.
      }
      return probeState(wsUrl, buildChatGptProbeExpr(), target);
    },
  },
};

export function getAppAdapter(name) {
  const key = String(name || "").trim().toLowerCase();
  return adapters[key] || null;
}

export function listAppAdapterNames() {
  return Object.keys(adapters).sort();
}

export function findAdapterTarget(targets, adapter) {
  const pages = (targets || []).filter((t) => t && t.type === "page");
  const matchPrefix = String(adapter.matchPrefix || "");
  const matches = pages.filter((t) => String(t.url || "").startsWith(matchPrefix));
  return matches.length ? matches[matches.length - 1] : null;
}
