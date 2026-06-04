export const CHATGPT_BASE = "https://chatgpt.com";
export const CONV_ID_RE = /\/c\/([0-9a-fA-F-]{16,})/;
export const PROJECT_ID_RE = /\/g\/g-p-([^/]+)/;

export const SELECTORS = {
  stop: 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop"], button[aria-label="停止"]',
  send: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Send"], button[aria-label="送信"]',
  assistantMsg: '[data-message-author-role="assistant"]',
  userMsg: '[data-message-author-role="user"]',
  modelSwitcher: 'button[data-testid="model-switcher-dropdown-button"], button[aria-label*="Model selector" i], button[aria-label*="current model" i]',
};

export function extractConversationId(url) {
  const m = String(url || "").match(CONV_ID_RE);
  return m ? m[1] : null;
}

export function extractProjectId(url) {
  const m = String(url || "").match(PROJECT_ID_RE);
  return m ? m[1] : null;
}

export function projectIdsCompatible(parentProjectId, childProjectId) {
  const parent = String(parentProjectId || "");
  const child = String(childProjectId || "");
  if (!parent || !child) return false;
  if (parent === child) return true;
  return child.startsWith(parent + "-") || parent.startsWith(child + "-");
}

export function assertProjectThreadUrlMatchesProject(threadUrl, projectUrl, label) {
  const projectId = extractProjectId(projectUrl);
  const threadProjectId = extractProjectId(threadUrl);
  if (!projectId) {
    throw new Error(`${label || "thread"}: --projectUrl is required and must be a ChatGPT Project URL`);
  }
  if (!threadProjectId) {
    throw new Error(`${label || "thread"}: thread URL is not a ChatGPT Project thread URL: ${String(threadUrl || "")}`);
  }
  if (!projectIdsCompatible(projectId, threadProjectId)) {
    throw new Error(`${label || "thread"}: project mismatch: projectUrl=${projectId}, threadUrl=${threadProjectId}`);
  }
  return { projectId, threadProjectId };
}

export function normalizeAbsUrl(href) {
  const h = String(href || "");
  if (!h) return h;
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("/")) return CHATGPT_BASE + h;
  return h;
}

export function isChatGptUrl(href) {
  const url = normalizeAbsUrl(href);
  return url.startsWith(CHATGPT_BASE);
}

export function urlsMatch(actualHref, targetHref) {
  const actual = normalizeAbsUrl(actualHref);
  const target = normalizeAbsUrl(targetHref);
  if (!actual || !target) return false;
  if (actual === target) return true;
  if (actual.startsWith(target)) return true;

  const targetConvId = extractConversationId(target);
  if (targetConvId && actual.includes(targetConvId)) return true;

  const targetProjectId = extractProjectId(target);
  if (targetProjectId && actual.includes(`/g/g-p-${targetProjectId}`)) return true;

  return false;
}

export function listPageTargets(targets) {
  return (targets || []).filter((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
}

export function previewTargets(targets) {
  return listPageTargets(targets).map((t) => ({ id: t.id, title: t.title, url: t.url }));
}

export function pickTargetByUrl(targets, url) {
  const pages = listPageTargets(targets);
  const u = String(url || "");
  const abs = normalizeAbsUrl(u);

  let cands = pages.filter((t) => {
    const targetUrl = normalizeAbsUrl(String((t && t.url) || ""));
    return targetUrl === abs || String((t && t.url) || "") === u;
  });

  if (cands.length === 0) {
    cands = pages.filter((t) => {
      const targetUrl = normalizeAbsUrl(String((t && t.url) || ""));
      return targetUrl.startsWith(abs) || String((t && t.url) || "").startsWith(u);
    });
  }

  if (cands.length === 0) {
    const pid = extractProjectId(abs || u);
    if (pid) {
      cands = pages.filter((t) => String((t && t.url) || "").includes(`/g/g-p-${pid}/project`));
    }
  }

  if (cands.length === 0) {
    const cid = extractConversationId(abs || u);
    if (cid) {
      cands = pages.filter((t) => String((t && t.url) || "").includes(cid));
    }
  }

  return cands.length ? cands[cands.length - 1] : null;
}
