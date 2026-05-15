import { getDefaultAddr, cdpList } from "./lib.mjs";
import { probeCdpPorts, requireCdp } from "./connect.mjs";
import { findAdapterTarget, getAppAdapter } from "./app-adapters.mjs";

function scoreStatus(status) {
  switch (String(status || "")) {
    case "logged-in": return 50;
    case "challenge-blocked": return 30;
    case "unauthenticated": return 20;
    case "login-required": return 10;
    case "target-not-found": return 0;
    default: return -10;
  }
}

export function rankSessions(rows) {
  const sessions = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  sessions.sort((a, b) =>
    scoreStatus(b.app && b.app.status) - scoreStatus(a.app && a.app.status) ||
    Number(b.attachablePageCount) - Number(a.attachablePageCount) ||
    Number(a.port) - Number(b.port));
  return sessions.map((row, idx) => ({ ...row, recommended: idx === 0 }));
}

export function summarizeCdpSessions(opts) {
  const options = opts || {};
  const addr = String(options.addr || getDefaultAddr());
  const requestedPort = options.port == null ? null : Number(options.port);
  const adapter = getAppAdapter(options.app || "chatgpt");
  const probeRows = probeCdpPorts(addr, requestedPort || undefined);
  const sessions = [];
  for (const row of probeRows) {
    const port = Number(row && row.port) || 0;
    if (!port) continue;
    let targets = [];
    try {
      targets = cdpList(addr, port);
    } catch {
      targets = [];
    }
    if (!Array.isArray(targets)) targets = [];
    const pages = (targets || []).filter((t) => t && t.type === "page");
    const target = adapter ? findAdapterTarget(targets, adapter) : null;
    const app = adapter && target ? { target, ...adapter.classifyTarget(target) } : {
      ok: false,
      status: "target-not-found",
      reason: "APP_TAB_NOT_FOUND",
    };
    sessions.push({
      addr,
      port,
      browser: String((row.version && row.version.Browser) || ""),
      protocolVersion: String((row.version && row.version["Protocol-Version"]) || ""),
      pageCount: pages.length,
      attachablePageCount: pages.filter((t) => String(t.webSocketDebuggerUrl || "").length > 0).length,
      app,
    });
  }
  return rankSessions(sessions);
}

export function selectRecommendedSession(opts) {
  const sessions = summarizeCdpSessions(opts);
  const chosen = sessions.length > 0 ? sessions[0] : null;
  return { sessions, chosen };
}

export function requireRecommendedSession(opts) {
  const selected = selectRecommendedSession(opts);
  if (!selected.chosen) {
    throw new Error("no_cdp_session_found");
  }
  const chosen = selected.chosen;
  return {
    ...requireCdp(chosen.addr, chosen.port),
    session: chosen,
    sessions: selected.sessions,
  };
}
