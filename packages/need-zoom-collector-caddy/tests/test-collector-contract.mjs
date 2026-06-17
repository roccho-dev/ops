import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "need-zoom-collector-"));
const projectionSql = path.join(tmp, "projection.sql");
fs.writeFileSync(projectionSql, `
with raw as (
  select json, json_extract_string(json, '$.payloadKind') as payloadKind
  from read_ndjson_objects('{{RAW_JSONL}}')
),
events as (
  select json_extract_string(json, '$.payload.type') as type,
         json_extract_string(json, '$.payload.label') as label
  from raw where payloadKind = 'need_zoom.event.v1'
),
current_purpose as (
  select label from events where type = 'purpose.set' order by label desc limit 1
)
select json_object(
  'kind', 'need_zoom.voronoi_surface.v1',
  'surface', json_object('rawCount', (select count(*) from raw), 'purpose', coalesce((select label from current_purpose), 'unset')),
  'nodes', json('[]'),
  'edges', json('[]'),
  'visibleNodeIds', json('[]'),
  'events', json('[]'),
  'pool', json_object('kind', 'need_zoom.raw_pool.v1', 'rawCount', (select count(*) from raw))
) as projection;
`);

const child = spawnCollector(tmp, projectionSql);
try {
  const info = await firstJsonLine(child);
  const base = `http://${info.addr}`;

  async function post(pathname, body) {
    const res = await fetch(base + pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    assert.ok(res.ok, JSON.stringify(json));
    return json;
  }

  await post("/api/raw/batch", { payloads: [
    { kind: "need_zoom.surface_config.v1", title: "Need Zoom", w: 1000, h: 700, cell: 7 },
    { kind: "need_zoom.node.v1", id: "purpose", label: "Purpose", facet: "purpose", lvl: 0, x: 500, y: 100, r: 80 },
    { kind: "need_zoom.node.v1", id: "value", label: "Value", facet: "purpose", lvl: 1, parent: "purpose", x: 520, y: 180, r: 60 },
    { kind: "need_zoom.edge.v1", a: "purpose", b: "value", k: "contains", w: 0.8 },
    { kind: "need_zoom.event.v1", type: "purpose.set", label: "company exit" },
  ] });

  const one = await post("/api/raw", { kind: "need_zoom.ui_query.v1", scale: 1, focus: "purpose" });
  assert.equal(one.record.kind, "jsonl.record.generic.v1");
  assert.equal(one.record.meta.canonicalStatus, "local-runtime-not-ssot");
  assert.equal(one.record.meta.approval, false);

  const feedback1 = await post("/api/raw", {
    kind: "ui.review.feedback.v1",
    reviewId: "review-123",
    feedback: "good work",
    meta: { idempotencyKey: "stable-key-123" },
  });
  assert.equal(feedback1.record.kind, "jsonl.record.generic.v1");
  assert.equal(feedback1.record.meta.idempotencyKey, "stable-key-123");

  const feedback2 = await post("/api/raw", {
    kind: "ui.review.feedback.v1",
    reviewId: "review-123",
    feedback: "good work",
    meta: { idempotencyKey: "stable-key-123" },
    timestamp: new Date().toISOString(),
  });
  assert.equal(feedback2.record.status, "duplicate", "second POST with same key should be marked duplicate");
  assert.equal(feedback2.record.idempotencyKey, "stable-key-123");

  const pool = await (await fetch(base + "/api/pool.json")).json();
  assert.equal(pool.rawCount, 7, "duplicate POST should not increase raw count");
  assert.equal(pool.byPayloadKind["need_zoom.node.v1"], 2);
  assert.equal(pool.latest.purpose, "company exit");

  const projection = await (await fetch(base + "/api/projection/need-zoom.voronoi_surface.v1")).json();
  assert.equal(projection.kind, "need_zoom.voronoi_surface.v1");
  assert.equal(projection.surface.rawCount, 7, "projection should reflect 7 unique records (no duplicates)");
  assert.equal(projection.surface.purpose, "company exit");

  console.log(JSON.stringify({
    status: "need-zoom-collector-caddy-check-pass",
    rawCount: pool.rawCount,
    projection: projection.kind,
    duplicateHandling: "verified",
  }, null, 2));
} finally {
  child.kill("SIGTERM");
}

function spawnCollector(dataDir, sqlPath) {
  const localBin = path.resolve("packages/need-zoom-collector-caddy/bin/need-zoom-collector.mjs");
  if (fs.existsSync(localBin)) {
    return spawn(process.execPath, [localBin, "--addr", "127.0.0.1:0", "--data-dir", dataDir, "--projection-sql", sqlPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn("need-zoom-collector", ["--addr", "127.0.0.1:0", "--data-dir", dataDir, "--projection-sql", sqlPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function firstJsonLine(child) {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`collector did not start; stderr=${err}`)), 10000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const line = out.split(/\n/).find((candidate) => candidate.trim());
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`collector exited ${code}; stderr=${err}`));
    });
  });
}
