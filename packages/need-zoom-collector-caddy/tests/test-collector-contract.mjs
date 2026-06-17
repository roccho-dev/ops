import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCollectorServer } from "../src/collector.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "need-zoom-collector-"));
const server = createCollectorServer({
  dataDir: tmp,
  projectionSql: path.join(root, "sql/need_zoom_projection.sql"),
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
const base = `http://127.0.0.1:${addr.port}`;

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

const pool = await (await fetch(base + "/api/pool.json")).json();
assert.equal(pool.rawCount, 6);
assert.equal(pool.byPayloadKind["need_zoom.node.v1"], 2);
assert.equal(pool.latest.purpose, "company exit");

const projection = await (await fetch(base + "/api/projection/need-zoom.voronoi_surface.v1")).json();
assert.equal(projection.kind, "need_zoom.voronoi_surface.v1");
assert.equal(projection.surface.rawCount, 6);
assert.equal(projection.surface.purpose, "company exit");
assert.equal(projection.nodes.length, 2);
assert.ok(projection.visibleNodeIds.includes("purpose"));

server.close();
console.log(JSON.stringify({
  status: "need-zoom-collector-caddy-check-pass",
  rawCount: pool.rawCount,
  projection: projection.kind,
}, null, 2));
