import * as std from "../../core/std.mjs";

import { extractConversationId, extractProjectId } from "./shared.mjs";

export const CHATGPT_THREAD_IR_SCHEMA = "openai.chatgpt.thread@cdp-v1";
export const CHATGPT_SEARCH_IR_SCHEMA = "openai.chatgpt.search_index@draft-cdp-v1";
export const CHATGPT_INVENTORY_IR_SCHEMA = "openai.chatgpt.inventory@draft-cdp-v1";
export const CHATGPT_DOWNLOAD_IR_SCHEMA = "openai.chatgpt.download_targets@draft-cdp-v1";
export const CHATGPT_THREADS_IR_SCHEMA = "openai.chatgpt.threads_index@draft-cdp-v1";

function nowIso() {
  return new Date().toISOString();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMessageParts(text) {
  if (Array.isArray(text)) return text;
  return [String(text || "")];
}

function normalizeVisibleMessage(message, index) {
  const m = message || {};
  const parts = normalizeMessageParts(m.text || m.preview || "");
  return {
    index: Number.isFinite(index) ? index : Number(m.idx) || 0,
    role: String(m.role || ""),
    content: {
      content_type: "text",
      parts,
    },
    create_time: null,
    update_time: null,
    status: null,
    end_turn: null,
    weight: null,
    channel: null,
    recipient: null,
    metadata: {},
  };
}

function normalizeArtifactTarget(target) {
  const row = target || {};
  const name = String(row.name || "");
  const locator = normalizeDownloadLocator(row.locator, name);
  if (locator.kind !== "chip" && locator.kind !== "sandbox_link" && locator.kind !== "download_link") {
    return null;
  }
  return {
    name,
    ok: row.ok !== false,
    error: row.error == null ? null : String(row.error),
    locator,
    download: {
      method: String((row.download && row.download.method) || (locator.kind === "sandbox_link" ? "sandbox_link" : "chip_click")),
      filename_expected: String((row.download && row.download.filename_expected) || name),
    },
  };
}

function normalizeArtifacts(rows) {
  const out = [];
  const seen = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const artifact = normalizeArtifactTarget(row);
    if (!artifact || !artifact.name) continue;
    const key = JSON.stringify([artifact.name, artifact.locator.kind, artifact.locator.href]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(artifact);
  }
  return out;
}

function normalizeThreadSummary(row) {
  const r = row || {};
  const url = String(r.url || r.href || "");
  return {
    thread_id: String(r.thread_id || extractConversationId(url) || ""),
    title: String(r.title || ""),
    url,
    project_id: String(r.project_id || extractProjectId(String(r.project_url || "")) || ""),
    project_url: String(r.project_url || ""),
    date: String(r.date || ""),
  };
}

export function materializeThreadIr(input) {
  const src = input || {};
  const url = String(src.url || src.href || "");
  const title = String(src.title || "");
  const conversationId = src.id || extractConversationId(url) || null;
  const visibleMessages = Array.isArray(src.visible_messages)
    ? src.visible_messages.map((m, idx) => normalizeVisibleMessage(m, idx))
    : [];
  const hits = Array.isArray(src.hits) ? cloneJson(src.hits) : [];
  const last = Array.isArray(src.last) ? cloneJson(src.last) : [];
  const finalResult = src.final_result ? cloneJson(src.final_result) : null;
  const stats = src.stats ? cloneJson(src.stats) : null;
  const capturedAt = String(src.captured_at || nowIso());
  const artifacts = normalizeArtifacts(src.artifacts || src.targets);
  const threadRecord = {
    id: conversationId,
    title,
    create_time: null,
    update_time: null,
    default_model_slug: null,
    gizmo_type: null,
    is_archived: false,
    is_starred: false,
    mapping: {},
    current_node: null,
    moderation_results: [],
    artifacts,
  };

  return {
    schema: CHATGPT_THREAD_IR_SCHEMA,
    captured_at: capturedAt,
    thread: threadRecord,
    _cdp: {
      source: {
        kind: String((src.source && src.source.kind) || "cdp-live"),
        addr: src.source && src.source.addr ? String(src.source.addr) : null,
        port: src.source && src.source.port ? Number(src.source.port) : null,
        target_id: src.source && src.source.target_id ? String(src.source.target_id) : null,
        url,
      },
      visible_messages: visibleMessages,
      read_thread: finalResult || {
        href: url,
        title,
        readyState: String(src.readyState || ""),
        msgCount: visibleMessages.length,
        hasPrompt: !!src.hasPrompt,
        isStreaming: !!src.isStreaming,
        stableRounds: Number(src.stableRounds) || 0,
        hits,
        last,
      },
      stats,
    },
  };
}

function normalizeSearchResult(result) {
  const r = result || {};
  const href = String(r.href || r.url || "");
  return {
    href,
    url: href,
    title: String(r.title || ""),
    conversation_id: extractConversationId(href),
  };
}

function normalizeInventoryProject(project) {
  const p = project || {};
  const url = String(p.url || p.href || "");
  return {
    name: String(p.name || ""),
    project_id: String(p.project_id || extractProjectId(url) || ""),
    url,
  };
}

function normalizeInventoryThread(thread) {
  const t = thread || {};
  const url = String(t.url || t.href || "");
  return {
    title: String(t.title || ""),
    thread_id: String(t.thread_id || extractConversationId(url) || ""),
    date: String(t.date || ""),
    url,
  };
}

export function materializeSearchIr(input) {
  const src = input || {};
  const query = String(src.query || "");
  const results = Array.isArray(src.results) ? src.results.map(normalizeSearchResult) : [];
  const capturedAt = String(src.captured_at || nowIso());
  return {
    schema: CHATGPT_SEARCH_IR_SCHEMA,
    captured_at: capturedAt,
    search: {
      query,
      results,
    },
    _cdp: {
      source: {
        kind: String((src.source && src.source.kind) || "cdp-live"),
        addr: src.source && src.source.addr ? String(src.source.addr) : null,
        port: src.source && src.source.port ? Number(src.source.port) : null,
        target_id: src.source && src.source.target_id ? String(src.source.target_id) : null,
        url: src.source && src.source.url ? String(src.source.url) : "https://chatgpt.com/",
      },
      stats: src.stats ? cloneJson(src.stats) : null,
    },
  };
}

export function projectSearchResultFromIr(doc) {
  const ir = doc || {};
  const search = ir.search || {};
  return {
    query: String(search.query || ""),
    target: ir._cdp && ir._cdp.source && ir._cdp.source.target_id ? String(ir._cdp.source.target_id) : null,
    results: Array.isArray(search.results) ? cloneJson(search.results) : [],
  };
}

export function materializeInventoryIr(input) {
  const src = input || {};
  const capturedAt = String(src.ts_utc || src.captured_at || nowIso());
  const projects = Array.isArray(src.projects) ? src.projects.map(normalizeInventoryProject) : [];
  const unprojectedThreads = Array.isArray(src.unprojected_threads)
    ? src.unprojected_threads.map(normalizeInventoryThread)
    : [];
  const projected = {};
  const projectedThreads = src.projected_threads || {};
  for (const [key, rows] of Object.entries(projectedThreads)) {
    projected[String(key)] = Array.isArray(rows) ? rows.map(normalizeInventoryThread) : [];
  }
  const threads = [
    ...unprojectedThreads.map((row) => normalizeThreadSummary(row)),
    ...projects.flatMap((project) => {
      const rows = projected[String(project.project_id)] || [];
      return rows.map((row) => normalizeThreadSummary({
        ...row,
        project_id: project.project_id,
        project_url: project.url,
      }));
    }),
  ];
  return {
    schema: CHATGPT_INVENTORY_IR_SCHEMA,
    captured_at: capturedAt,
    inventory: {
      addr: String(src.addr || ""),
      port: Number(src.port) || null,
      base_url: src.base && src.base.url ? String(src.base.url) : String(src.url || "https://chatgpt.com/"),
      projects,
      threads,
      unprojected_threads: unprojectedThreads,
      projected_threads: projected,
    },
    _cdp: {
      base: src.base ? cloneJson(src.base) : null,
      projected_debug: src.projected_debug ? cloneJson(src.projected_debug) : null,
    },
  };
}

export function materializeThreadsIndexIr(input) {
  const src = input || {};
  const capturedAt = String(src.captured_at || nowIso());
  const threads = Array.isArray(src.threads) ? src.threads.map(normalizeThreadSummary) : [];
  return {
    schema: CHATGPT_THREADS_IR_SCHEMA,
    captured_at: capturedAt,
    threads: {
      items: threads,
    },
    _cdp: {
      source: src.source ? cloneJson(src.source) : null,
      stats: src.stats ? cloneJson(src.stats) : null,
    },
  };
}

export function projectThreadsIndexFromIr(doc) {
  const ir = doc || {};
  return {
    items: ir.threads && Array.isArray(ir.threads.items) ? cloneJson(ir.threads.items) : [],
  };
}

export function projectInventoryFromIr(doc) {
  const ir = doc || {};
  const inventory = ir.inventory || {};
  return {
    ts_utc: String(ir.captured_at || ""),
    addr: String(inventory.addr || ""),
    port: inventory.port == null ? null : Number(inventory.port),
    base: ir._cdp && ir._cdp.base ? cloneJson(ir._cdp.base) : undefined,
    projects: Array.isArray(inventory.projects) ? cloneJson(inventory.projects) : [],
    unprojected_threads: Array.isArray(inventory.unprojected_threads)
      ? cloneJson(inventory.unprojected_threads)
      : [],
    projected_threads: inventory.projected_threads ? cloneJson(inventory.projected_threads) : {},
    projected_debug: ir._cdp && ir._cdp.projected_debug ? cloneJson(ir._cdp.projected_debug) : undefined,
  };
}

function normalizeDownloadLocator(locator, name) {
  const loc = locator || {};
  const fallbackName = String(name || "");
  const kind = String(loc.kind || "chip");
  return {
    kind,
    label: String(loc.label || fallbackName),
    href: String(loc.href || ""),
    match: String(loc.match || ""),
  };
}

function normalizeDownloadTarget(target) {
  return normalizeArtifactTarget(target);
}

export function materializeDownloadResolveIr(input) {
  const src = input || {};
  const url = String(src.url || src.sourceUrl || "");
  const projectUrl = String(src.projectUrl || "");
  const sourceUrl = String(src.sourceUrl || "");
  const targets = Array.isArray(src.targets) ? src.targets.map(normalizeDownloadTarget) : [];
  const capturedAt = String(src.captured_at || nowIso());
  return {
    schema: CHATGPT_DOWNLOAD_IR_SCHEMA,
    captured_at: capturedAt,
    context: {
      url,
      thread_id: extractConversationId(url),
      project_url: projectUrl,
      project_id: extractProjectId(projectUrl),
      source_url: sourceUrl,
      needle: src.needle == null ? null : String(src.needle),
    },
    targets,
    _cdp: {
      source: {
        kind: String((src.source && src.source.kind) || "cdp-live"),
        addr: src.source && src.source.addr ? String(src.source.addr) : null,
        port: src.source && src.source.port ? Number(src.source.port) : null,
        target_id: src.source && src.source.target_id ? String(src.source.target_id) : null,
        url,
      },
      stats: src.stats ? cloneJson(src.stats) : null,
      target: src.target ? cloneJson(src.target) : null,
      chips: src.chips ? cloneJson(src.chips) : null,
      scan: src.scan ? cloneJson(src.scan) : null,
    },
  };
}

export function projectDownloadResolveFromIr(doc) {
  const ir = doc || {};
  const thread = ir.thread || {};
  const context = ir.context || {};
  const sidecar = ir._cdp || {};
  const source = sidecar.source || {};
  const threadUrl = String((source && source.url) || "");
  const target = sidecar.target ? cloneJson(sidecar.target) : {
    id: source && source.target_id ? String(source.target_id) : "",
    title: "",
    url: threadUrl,
  };
  const artifacts = Array.isArray(thread.artifacts) ? cloneJson(thread.artifacts) : [];
  if (artifacts.length > 0) {
    return {
      url: String(threadUrl || context.url || ""),
      projectUrl: String(context.project_url || ""),
      sourceUrl: String(context.source_url || threadUrl || ""),
      needle: context.needle == null ? null : String(context.needle),
      targets: artifacts,
      target,
      chips: ir._cdp && ir._cdp.chips ? cloneJson(ir._cdp.chips) : null,
      scan: ir._cdp && ir._cdp.scan ? cloneJson(ir._cdp.scan) : null,
    };
  }
  return {
    url: String(context.url || ""),
    projectUrl: String(context.project_url || ""),
    sourceUrl: String(context.source_url || ""),
    needle: context.needle == null ? null : String(context.needle),
    targets: Array.isArray(ir.targets) ? cloneJson(ir.targets) : [],
    target: ir._cdp && ir._cdp.target ? cloneJson(ir._cdp.target) : null,
    chips: ir._cdp && ir._cdp.chips ? cloneJson(ir._cdp.chips) : null,
    scan: ir._cdp && ir._cdp.scan ? cloneJson(ir._cdp.scan) : null,
  };
}

export function projectReadThreadResultFromIr(doc) {
  const ir = doc || {};
  const sidecar = ir._cdp || {};
  const thread = ir.thread || {};
  const readThread = sidecar.read_thread || {};
  const visible = Array.isArray(sidecar.visible_messages) ? sidecar.visible_messages : [];
  const href = String(readThread.href || (sidecar.source && sidecar.source.url) || "");
  const title = String(readThread.title || thread.title || "");
  return {
    href,
    title,
    readyState: String(readThread.readyState || ""),
    msgCount: Number(readThread.msgCount) || visible.length,
    hasPrompt: !!readThread.hasPrompt,
    isStreaming: !!readThread.isStreaming,
    stableRounds: Number(readThread.stableRounds) || 0,
    hits: Array.isArray(readThread.hits) ? cloneJson(readThread.hits) : [],
    last: Array.isArray(readThread.last) ? cloneJson(readThread.last) : [],
    artifacts: Array.isArray(thread.artifacts) ? cloneJson(thread.artifacts) : [],
  };
}

export function isFreshIr(doc, opts) {
  const ir = doc || {};
  const options = opts || {};
  const ttlSec = Math.max(0, Number(options.maxAgeSec) || 0);
  if (ttlSec <= 0) return false;
  const ts = Date.parse(String(ir.captured_at || ""));
  if (!Number.isFinite(ts)) return false;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  return nowMs - ts <= ttlSec * 1000;
}

export function loadIr(path) {
  const raw = std.loadFile(String(path || ""));
  if (raw === null || raw === undefined) return null;
  return JSON.parse(String(raw));
}

export function saveIr(path, doc) {
  std.writeFile(String(path || ""), JSON.stringify(doc, null, 2) + "\n");
}
