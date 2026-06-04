import * as std from "./qjs-compat/std.mjs";

import { extractProjectId, openOrCreateChatGptTarget } from "./chatgpt/index.mjs";
import { requireCdp } from "./connect.mjs";
import { getDefaultAddr, getDefaultPort, mkCaller, parseArgs, run } from "./lib.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-project-access-probe.mjs --projectUrl <.../project> [--addr 127.0.0.1] [--port <n>] [--timeoutMs 60000] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      addr: getDefaultAddr(),
      port: getDefaultPort(),
      projectUrl: null,
      timeoutMs: 60000,
      json: false,
    },
    flags: {
      addr: {},
      port: { parse: (raw, current) => Number(raw) || current },
      projectUrl: { names: ["--projectUrl", "--project-url"] },
      timeoutMs: { names: ["--timeoutMs", "--timeout-ms"], parse: (raw, current) => Number(raw) || current },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => out.projectUrl ? out : null,
  });
}

function projectAccessProbeExpr(projectId) {
  const pid = JSON.stringify(String(projectId || ""));
  return `(() => {
    const projectId = ${pid};
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const body = norm(document.body ? document.body.innerText : '').slice(0, 5000);
    const title = String(document.title || '');
    const href = String(location.href || '');
    const buttons = Array.from(document.querySelectorAll('button,a,[role="button"],[role="tab"]'));
    const labels = buttons.map((el) => norm(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')).filter(Boolean).slice(0, 80);
    const loginActions = labels.filter((s) => /(log in|login|sign up|continue with|continue as|continue to|ログイン|サインアップ|登録|続行)/i.test(s));
    const hasProjectHref = !!(projectId && href.includes('/g/g-p-' + projectId) && href.includes('/project'));
    const hasProjectShell = labels.some((s) => /^(Chats|Sources|チャット|ソース)$/i.test(s)) ||
      !!document.querySelector('button[role="tab"], [data-testid="project-sidebar"]');
    const denied = /(you do not have access|you don't have access|not found|404|アクセス権|見つかりません)/i.test(body);
    const loginUrl = href.includes('/auth/login') || href.includes('/login');
    return {
      href,
      title,
      readyState: document.readyState,
      hasProjectHref,
      hasProjectShell,
      denied,
      loginUrl,
      loginActions,
      bodySample: body.slice(0, 800),
    };
  })()`;
}

function classify(projectUrl, projectId, page) {
  if (!projectId) {
    return {
      ok: false,
      status: "project-url-wrong-shape",
      reason: "Project URL must include /g/g-p-<project-id>/project",
    };
  }
  if (!page || typeof page !== "object") {
    return {
      ok: false,
      status: "project-access-probe-failed",
      reason: "PAGE_PROBE_FAILED",
    };
  }
  if (page.loginUrl || (Array.isArray(page.loginActions) && page.loginActions.length > 0 && !page.hasProjectShell)) {
    return {
      ok: false,
      status: "project-access-profile-missing",
      reason: "TARGET_PROJECT_LOGIN_REQUIRED",
    };
  }
  if (page.denied) {
    return {
      ok: false,
      status: "project-access-denied",
      reason: "TARGET_PROJECT_ACCESS_DENIED_OR_NOT_FOUND",
    };
  }
  if (!page.hasProjectHref) {
    return {
      ok: false,
      status: "project-access-url-mismatch",
      reason: "TARGET_DID_NOT_RESOLVE_TO_REQUESTED_PROJECT",
    };
  }
  if (!page.hasProjectShell) {
    return {
      ok: false,
      status: "project-access-shell-missing",
      reason: "TARGET_PROJECT_SHELL_NOT_VISIBLE",
    };
  }
  return {
    ok: true,
    status: "project-access-ok",
    reason: "TARGET_PROJECT_ROUTE_VERIFIED",
  };
}

function main(args) {
  const projectId = extractProjectId(args.projectUrl);
  const conn = requireCdp(args.addr, args.port);
  const opened = openOrCreateChatGptTarget(conn, args.projectUrl, {
    purpose: "project-access-probe",
    checkSession: false,
    timeoutMs: args.timeoutMs,
  });
  const caller = mkCaller(opened.wsUrl);
  const page = caller.evalValue(projectAccessProbeExpr(projectId), { timeoutMs: args.timeoutMs });
  const classification = classify(args.projectUrl, projectId, page);
  const result = {
    kind: "ops.projectAccessProbe.v1",
    ok: classification.ok,
    status: classification.status,
    reason: classification.reason,
    projectUrl: args.projectUrl,
    projectId,
    addr: args.addr,
    port: args.port,
    target: {
      id: opened.target && opened.target.id ? opened.target.id : null,
      url: opened.target && opened.target.url ? opened.target.url : null,
      title: opened.target && opened.target.title ? opened.target.title : null,
    },
    page,
  };
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else std.out.puts(`${result.status}\n`);
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
