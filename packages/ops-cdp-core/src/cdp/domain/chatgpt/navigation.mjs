import { cdpCall, cdpEvaluate, pollUntil } from "../../lib.mjs";
import { CHATGPT_BASE, normalizeAbsUrl, urlsMatch } from "./shared.mjs";

function pageStateExpr() {
  return `(() => ({
    href: String(location.href || ''),
    title: String(document.title || ''),
    readyState: String(document.readyState || ''),
    isChatGptOrigin: String(location.origin || '').includes('chatgpt.com')
  }))()`;
}

export function getChatGptPageState(wsUrl) {
  const resp = cdpEvaluate(wsUrl, pageStateExpr(), {
    id: 92,
    returnByValue: true,
    awaitPromise: false,
    timeoutMs: 20000,
  });
  return resp && resp.result && resp.result.result ? resp.result.result.value : null;
}

function navigateWithinSpaExpr(targetUrl) {
  const target = JSON.stringify(String(targetUrl || ""));
  return `(() => {
    const targetUrl = ${target};
    const before = String(location.href || '');
    const assigned = before !== targetUrl;
    if (assigned) window.location.href = targetUrl;
    return {
      ok: true,
      assigned,
      before,
      href: String(location.href || ''),
      readyState: String(document.readyState || '')
    };
  })()`;
}

function navigationLabel(purpose) {
  return purpose ? `ChatGPT SPA navigation for ${purpose}` : "ChatGPT SPA navigation";
}

export function navigateChatGptTarget(wsUrl, targetUrl, opts) {
  const url = normalizeAbsUrl(targetUrl || CHATGPT_BASE);
  const options = opts || {};
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 60000);
  const evalResp = cdpEvaluate(wsUrl, navigateWithinSpaExpr(url), {
    id: 93,
    returnByValue: true,
    awaitPromise: false,
    timeoutMs: 30000,
  });
  const initial = evalResp && evalResp.result && evalResp.result.result ? evalResp.result.result.value : null;
  if (initial && initial.ok === false) {
    throw new Error(`failed to request ChatGPT SPA navigation: ${String(initial.error || "unknown_error")}`);
  }

  const state = pollUntil(
    () => {
      const page = getChatGptPageState(wsUrl);
      if (!page || typeof page !== "object") return null;
      if (!urlsMatch(page.href, url)) return null;
      if (String(page.readyState || "") === "loading") return null;
      return page;
    },
    {
      timeoutMs,
      pollMs: 250,
      label: navigationLabel(String(options.purpose || "")),
    },
  );

  return {
    ok: true,
    assigned: !!(initial && initial.assigned),
    targetUrl: url,
    finalUrl: String((state && state.href) || url),
    title: String((state && state.title) || ""),
    readyState: String((state && state.readyState) || ""),
  };
}
