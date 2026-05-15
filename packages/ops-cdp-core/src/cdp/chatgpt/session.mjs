import { cdpEvaluate } from "../lib.mjs";

function loginProbeExpr() {
  return `(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const nodes = Array.from(document.querySelectorAll('button,a,[role="button"]'));
    const labels = nodes
      .map((el) => norm(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || ''))
      .filter((s) => s.length > 0)
      .slice(0, 40);
    const re = /(log in|login|sign up|continue with|continue as|continue to|ログイン|サインアップ|登録|続行)/i;
    const loginActions = labels.filter((s) => re.test(s));
    const hasComposer = !!document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], form textarea, form [contenteditable="true"]');
    const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0;
    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      hasComposer,
      hasMessages,
      loginActions,
      isChatGptOrigin: String(location.href || '').includes('chatgpt.com'),
    };
  })()`;
}

export function probeChatGptTarget(wsUrl) {
  const resp = cdpEvaluate(wsUrl, loginProbeExpr(), {
    id: 91,
    returnByValue: true,
    awaitPromise: false,
    timeoutMs: 20000,
  });
  return resp && resp.result && resp.result.result ? resp.result.result.value : null;
}

export function isLoginRequired(info) {
  if (!info || typeof info !== "object") return false;
  const actions = Array.isArray(info.loginActions) ? info.loginActions : [];
  return actions.length > 0 && info.hasComposer !== true && info.hasMessages !== true;
}

export function buildLoginRequiredMessage(target, info, purpose) {
  const lines = [];
  lines.push(`ChatGPT login required${purpose ? ` for ${purpose}` : ""}.`);
  lines.push(`Target: ${String((target && target.url) || (info && info.href) || "")}`);
  lines.push("Complete login in the managed Chromium session, then retry.");
  lines.push("VNC: vncviewer localhost:5901");
  lines.push("Then: chromedevtoolprotocol-service-profile-bootstrap login-complete");
  return lines.join("\n");
}
