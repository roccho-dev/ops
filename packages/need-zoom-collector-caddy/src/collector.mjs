import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(usage());
    return 0;
  }
  const server = createCollectorServer(opts);
  const [host, port] = splitAddr(opts.addr);
  await new Promise((resolve) => server.listen(Number(port), host, resolve));
  const actual = server.address();
  process.stdout.write(JSON.stringify({
    status: "need-zoom-collector-listening",
    addr: `${actual.address}:${actual.port}`,
    dataDir: opts.dataDir,
    rawLog: rawLogPath(opts.dataDir),
  }) + "\n");
  await new Promise(() => {});
  return 0;
}

export function createCollectorServer(opts = {}) {
  const dataDir = opts.dataDir || "./data";
  const projectionSql = opts.projectionSql || "";
  fs.mkdirSync(dataDir, { recursive: true });
  const rawLog = rawLogPath(dataDir);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://collector.local");
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, health(dataDir, rawLog, projectionSql));
      if (req.method === "GET" && url.pathname === "/api/raw.jsonl") return rawJsonl(res, rawLog);
      if (req.method === "GET" && url.pathname === "/api/pool.json") return json(res, 200, buildPool(rawLog));
      if (req.method === "GET" && url.pathname === "/api/projection/need-zoom.voronoi_surface.v1") {
        return projection(res, rawLog, projectionSql);
      }
      if (req.method === "POST" && url.pathname === "/api/raw") {
        const payload = await readJson(req);
        const record = appendPayload(rawLog, payload, "/api/raw");
        return json(res, 202, { ok: true, status: "queued-raw-jsonl", record });
      }
      if (req.method === "POST" && url.pathname === "/api/raw/batch") {
        const body = await readJson(req);
        const payloads = Array.isArray(body) ? body : body.payloads;
        if (!Array.isArray(payloads) || payloads.length === 0) return json(res, 400, { ok: false, error: "empty-batch" });
        const records = payloads.map((payload) => appendPayload(rawLog, payload, "/api/raw/batch"));
        return json(res, 202, { ok: true, status: "queued-raw-jsonl-batch", count: records.length, records });
      }
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "not-found" }) + "\n");
    } catch (error) {
      json(res, 500, { ok: false, error: "collector-error", detail: String(error.message || error) });
    }
  });
}

export function appendPayload(rawLog, payload, endpoint) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload object required");
  const payloadKind = typeof payload.kind === "string" && payload.kind ? payload.kind : "unknown.payload.v1";
  const record = {
    kind: "jsonl.record.generic.v1",
    recordId: `need-zoom:${crypto.randomBytes(8).toString("hex")}`,
    recordedAt: new Date().toISOString(),
    payloadKind,
    payloadVersion: typeof payload.version === "string" ? payload.version : "v1",
    payload,
    meta: {
      source: "need-zoom-collector-caddy",
      transport: "http-post",
      endpoint,
      pool: "need_zoom.raw_pool.v1",
      canonicalStatus: "local-runtime-not-ssot",
      approval: false,
    },
  };
  fs.mkdirSync(path.dirname(rawLog), { recursive: true });
  fs.appendFileSync(rawLog, JSON.stringify(record) + "\n");
  return record;
}

export function readRecords(rawLog) {
  if (!fs.existsSync(rawLog)) return [];
  return fs.readFileSync(rawLog, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

export function buildPool(rawLog) {
  const records = readRecords(rawLog);
  const byPayloadKind = {};
  const received = { CEO: 0, CTO: 0, CFO: 0, CPO: 0, COO: 0 };
  let purpose = "unset";
  for (const record of records) {
    byPayloadKind[record.payloadKind] = (byPayloadKind[record.payloadKind] || 0) + 1;
    if (record.payloadKind === "need_zoom.event.v1" && record.payload?.type === "purpose.set" && record.payload.label) purpose = record.payload.label;
    if (record.payloadKind === "need_zoom.event.v1" && record.payload?.type === "cxo.receive" && received[record.payload.to] != null) received[record.payload.to] += 1;
  }
  return {
    kind: "need_zoom.raw_pool.v1",
    rawLog,
    rawCount: records.length,
    byPayloadKind: Object.fromEntries(Object.entries(byPayloadKind).sort(([a], [b]) => a.localeCompare(b))),
    latest: { purpose },
    received,
  };
}

function projection(res, rawLog, projectionSql) {
  if (!projectionSql) return json(res, 500, { ok: false, error: "missing-projection-sql" });
  if (!fs.existsSync(rawLog)) return json(res, 200, emptyProjection());
  const sql = fs.readFileSync(projectionSql, "utf8").replaceAll("{{RAW_JSONL}}", rawLog.replaceAll("'", "''"));
  const result = spawnSync("duckdb", ["-json", "-c", sql], { encoding: "utf8" });
  if (result.status !== 0) return json(res, 500, { ok: false, error: "duckdb-failed", detail: result.stderr || result.stdout });
  const rows = JSON.parse(result.stdout);
  res.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(rows[0].projection) + "\n");
}

function health(dataDir, rawLog, projectionSql) {
  return {
    ok: true,
    kind: "needZoom.collectorHealth.v1",
    dataDir,
    rawLog,
    projectionSql,
    duckdb: spawnSync("duckdb", ["--version"], { encoding: "utf8" }).status === 0,
  };
}

function rawJsonl(res, rawLog) {
  res.writeHead(200, { "cache-control": "no-store", "content-type": "application/x-ndjson; charset=utf-8" });
  if (fs.existsSync(rawLog)) fs.createReadStream(rawLog).pipe(res);
  else res.end("");
}

async function readJson(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || "{}");
}

function json(res, status, value) {
  res.writeHead(status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value) + "\n");
}

function emptyProjection() {
  return {
    kind: "need_zoom.voronoi_surface.v1",
    surface: { title: "Need Zoom Voronoi PoC", purpose: "unset", rawCount: 0 },
    facets: [],
    nodes: [],
    edges: [],
    visibleNodeIds: [],
    visibleEdges: [],
    events: [],
    received: {},
    pool: { kind: "need_zoom.raw_pool.v1", rawCount: 0, byPayloadKind: {} },
  };
}

function parseArgs(argv) {
  const opts = {
    addr: process.env.NEED_ZOOM_COLLECTOR_ADDR || "127.0.0.1:19081",
    dataDir: process.env.NEED_ZOOM_DATA_DIR || "./data",
    projectionSql: process.env.NEED_ZOOM_PROJECTION_SQL || "",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--addr") opts.addr = argv[++i];
    else if (arg === "--data-dir") opts.dataDir = argv[++i];
    else if (arg === "--projection-sql") opts.projectionSql = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function splitAddr(addr) {
  const index = String(addr).lastIndexOf(":");
  if (index < 0) throw new Error(`addr must be host:port: ${addr}`);
  return [addr.slice(0, index), addr.slice(index + 1)];
}

function rawLogPath(dataDir) {
  return path.join(dataDir, "raw.jsonl");
}

function usage() {
  return `usage: need-zoom-collector [--addr 127.0.0.1:19081] [--data-dir DIR] [--projection-sql FILE]\n`;
}
