import { requireCdp } from "../connect.mjs";
import { cdpCall, cdpList, pollUntil } from "../lib.mjs";
import { getChatGptPageState, navigateChatGptTarget } from "./navigation.mjs";
import { buildLoginRequiredMessage, isLoginRequired, probeChatGptTarget } from "./session.mjs";
import {
  CHATGPT_BASE,
  extractConversationId,
  isChatGptUrl,
  listPageTargets,
  normalizeAbsUrl,
  pickTargetByUrl,
  previewTargets,
} from "./shared.mjs";

function pickTargetById(targets, id) {
  const pages = listPageTargets(targets);
  return pages.find((t) => String((t && t.id) || "") === String(id || "")) || null;
}

function pickAnyChatGptTarget(targets) {
  const pages = listPageTargets(targets);
  const urlMatch = pages.filter((t) => isChatGptUrl((t && t.url) || ""));
  if (urlMatch.length > 0) return urlMatch[urlMatch.length - 1];

  const titleMatch = pages.filter((t) => String((t && t.title) || "").toLowerCase().includes("chatgpt"));
  return titleMatch.length > 0 ? titleMatch[titleMatch.length - 1] : null;
}

export function shouldReuseAnyChatGptTarget(url) {
  const normalized = normalizeAbsUrl(url || CHATGPT_BASE).replace(/\/+$/, "");
  return normalized === CHATGPT_BASE;
}

function ensureConnection(connectionOrArgs) {
  if (
    connectionOrArgs &&
    typeof connectionOrArgs === "object" &&
    typeof connectionOrArgs.addr === "string" &&
    typeof connectionOrArgs.port === "number" &&
    Array.isArray(connectionOrArgs.targets)
  ) {
    return connectionOrArgs;
  }
  const args = connectionOrArgs || {};
  return requireCdp(args.addr, args.port);
}

function refreshTargets(conn) {
  const fresh = cdpList(conn.addr, conn.port);
  return listPageTargets(fresh);
}

function createChatGptTarget(conn) {
  if (!conn || !conn.wsUrl) {
    throw new Error("browser websocket unavailable; cannot create ChatGPT tab");
  }

  const created = cdpCall(conn.wsUrl, {
    id: 94,
    method: "Target.createTarget",
    params: { url: CHATGPT_BASE },
  }, 60000);

  const targetId = created && created.result ? created.result.targetId : null;
  if (!targetId) {
    throw new Error("Target.createTarget returned no targetId");
  }

  return pollUntil(
    () => {
      const freshTargets = refreshTargets(conn);
      return pickTargetById(freshTargets, targetId) || null;
    },
    {
      timeoutMs: 30000,
      pollMs: 250,
      label: "ChatGPT target creation",
    },
  );
}

function buildNotFoundMessage(url, id, targets, purpose) {
  const lines = [];
  const preview = previewTargets(targets);
  lines.push(`ChatGPT tab not found${purpose ? ` for ${purpose}` : ""}.`);
  if (id) lines.push(`Requested --id ${id}`);
  if (url) lines.push(`Requested URL: ${String(url)}`);
  lines.push(`Open ${CHATGPT_BASE} first, or use cdp-open.mjs with the same --url.`);
  if (preview.length > 0) {
    lines.push("Open page targets:");
    lines.push(JSON.stringify(preview, null, 2));
  }
  return lines.join("\n");
}

export function requireChatGptTarget(connectionOrArgs, spec, opts) {
  const conn = ensureConnection(connectionOrArgs);
  const targetSpec = spec || {};
  const options = opts || {};
  const url = targetSpec.url || null;
  const id = targetSpec.id || null;
  const purpose = String(options.purpose || "");
  let targets = Array.isArray(targetSpec.targets) ? targetSpec.targets : listPageTargets(conn.targets);

  let target = null;
  if (id) target = pickTargetById(targets, id);
  if (!target && url) target = pickTargetByUrl(targets, url);

  if (!target && !Array.isArray(targetSpec.targets)) {
    targets = refreshTargets(conn);
    if (id) target = pickTargetById(targets, id);
    if (!target && url) target = pickTargetByUrl(targets, url);
  }

  if (!target) throw new Error(buildNotFoundMessage(url, id, targets, purpose));

  const session = options.checkSession === false ? null : probeChatGptTarget(target.webSocketDebuggerUrl);
  if (isLoginRequired(session)) throw new Error(buildLoginRequiredMessage(target, session, purpose));
  return { ...conn, targets, target, wsUrl: target.webSocketDebuggerUrl, chatgpt: session };
}

export function openOrCreateChatGptTarget(connectionOrArgs, url, opts) {
  const baseConn = ensureConnection(connectionOrArgs);
  const options = opts || {};
  const purpose = String(options.purpose || "");
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 60000);
  const targetUrl = normalizeAbsUrl(url || CHATGPT_BASE);

  let targets = listPageTargets(baseConn.targets);
  let target = pickTargetByUrl(targets, targetUrl);
  if (!target && shouldReuseAnyChatGptTarget(targetUrl)) {
    target = pickAnyChatGptTarget(targets);
  }
  let created = false;

  if (!target) {
    target = createChatGptTarget(baseConn);
    created = true;
  }

  let navigation = null;
  try {
    navigation = navigateChatGptTarget(target.webSocketDebuggerUrl, targetUrl, { timeoutMs, purpose });
  } catch (error) {
    const session = options.checkSession === false ? null : probeChatGptTarget(target.webSocketDebuggerUrl);
    if (isLoginRequired(session)) {
      throw new Error(buildLoginRequiredMessage(target, session, purpose));
    }
    throw error;
  }

  targets = refreshTargets(baseConn);
  const resolved = pickTargetById(targets, target.id) || pickTargetByUrl(targets, navigation.finalUrl) || target;
  const finalTarget = {
    ...resolved,
    title: navigation.title || resolved.title,
    url: navigation.finalUrl || resolved.url,
  };
  const session = options.checkSession === false ? null : probeChatGptTarget(finalTarget.webSocketDebuggerUrl || target.webSocketDebuggerUrl);
  if (isLoginRequired(session)) throw new Error(buildLoginRequiredMessage(finalTarget, session, purpose));

  return {
    ...baseConn,
    targets,
    target: finalTarget,
    wsUrl: finalTarget.webSocketDebuggerUrl || target.webSocketDebuggerUrl,
    created,
    navigated: !!navigation.assigned,
    finalUrl: navigation.finalUrl,
    chatgpt: session,
  };
}

export function waitForResolvedChatGptPage(wsUrl, targetUrl, opts) {
  const url = normalizeAbsUrl(targetUrl || CHATGPT_BASE);
  const timeoutMs = Math.max(1, Number((opts || {}).timeoutMs) || 60000);
  return pollUntil(
    () => {
      const page = getChatGptPageState(wsUrl);
      if (!page || typeof page !== "object") return null;
      const href = String(page.href || "");
      if (href === url || href.startsWith(url)) return page;
      const cid = extractConversationId(url);
      if (cid && href.includes(cid)) return page;
      return null;
    },
    {
      timeoutMs,
      pollMs: 250,
      label: "ChatGPT page resolve",
    },
  );
}
