import fs from "node:fs";
import http from "node:http";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonl(text) {
  const records = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try { records.push(JSON.parse(trimmed)); }
    catch (error) { errors.push({ line: index + 1, error: String(error.message || error), preview: trimmed.slice(0, 160) }); }
  });
  return { records, errors };
}

export function assertOwnerInputEnvelope(record) {
  if (!isObject(record)) throw new Error("record must be an object");
  if (record.kind !== "jsonl.record.generic.v1") throw new Error("record.kind must be jsonl.record.generic.v1");
  if (!record.recordId) throw new Error("recordId is required");
  if (!record.recordedAt) throw new Error("recordedAt is required");
  if (record.payloadKind !== "owner.raw.input.v1") throw new Error("payloadKind must be owner.raw.input.v1");
  if (!isObject(record.payload)) throw new Error("payload object is required");
  for (const field of ["goalRef", "purposeRef", "ownerRef", "sourceSurface", "targetRefs", "body"]) {
    if (!(field in record.payload)) throw new Error(`payload.${field} is required`);
  }
  if (!Array.isArray(record.payload.targetRefs)) throw new Error("payload.targetRefs must be an array");
  if (!isObject(record.meta)) throw new Error("meta is required");
  if (record.meta.approval !== false) throw new Error("owner input must not assert approval");
  if (record.meta.authorizesMerge === true || record.meta.authorizesFire === true) throw new Error("owner input must not authorize merge/fire");
  return record;
}

export function appendRawLine(rawPath, record) {
  const checked = assertOwnerInputEnvelope(record);
  fs.mkdirSync(new URL(".", `file://${rawPath}`).pathname, { recursive: true });
  fs.appendFileSync(rawPath, `${JSON.stringify(checked)}\n`);
  return { kind: "ui.raw.append.receipt.v1", recordId: checked.recordId, rawPath, appended: true };
}

export function readRaw(rawPath) {
  if (!fs.existsSync(rawPath)) return [];
  const parsed = parseJsonl(fs.readFileSync(rawPath, "utf8"));
  if (parsed.errors.length) throw new Error(`raw JSONL parse errors: ${JSON.stringify(parsed.errors)}`);
  return parsed.records;
}

export function projectUiReadModel(records) {
  const ownerInputs = records.filter((record) => record?.payloadKind === "owner.raw.input.v1");
  const byGoal = new Map();
  const mentions = new Map();
  for (const record of ownerInputs) {
    const goal = String(record.payload.goalRef || "unset");
    byGoal.set(goal, (byGoal.get(goal) || 0) + 1);
    for (const ref of record.payload.targetRefs || []) {
      if (!ref || !ref.targetId) continue;
      mentions.set(`${ref.targetKind || "custom"}:${ref.targetId}`, {
        kind: "ui.mention.ref.v1",
        refKind: ref.targetKind || "custom",
        refId: String(ref.targetId),
        label: String(ref.label || ref.targetId),
      });
    }
  }
  return {
    kind: "ui.raw.loop.read_model.v1",
    rawCount: records.length,
    ownerInputCount: ownerInputs.length,
    byGoal: Object.fromEntries([...byGoal.entries()].sort(([a], [b]) => a.localeCompare(b))),
    mentionIndex: { kind: "ui.mention.index.v1", mentions: [...mentions.values()].sort((a, b) => `${a.refKind}:${a.label}`.localeCompare(`${b.refKind}:${b.label}`)) },
    latest: ownerInputs.slice(-8).reverse().map((record) => ({ recordId: record.recordId, goalRef: record.payload.goalRef, ownerRef: record.payload.ownerRef, body: record.payload.body })),
  };
}

export async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

export function startServer({ rawPath, host = "127.0.0.1", port = 0 } = {}) {
  if (!rawPath) throw new Error("rawPath is required");
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/api/raw") {
        const record = await readRequestJson(req);
        const append = appendRawLine(rawPath, record);
        const projection = projectUiReadModel(readRaw(rawPath));
        return sendJson(res, 200, { kind: "ui.raw.loop.receipt.v1", append, projection });
      }
      if (req.method === "GET" && req.url === "/read-model") return sendJson(res, 200, projectUiReadModel(readRaw(rawPath)));
      return sendJson(res, 404, { kind: "ui.raw.loop.error.v1", error: "not found" });
    } catch (error) {
      return sendJson(res, 400, { kind: "ui.raw.loop.error.v1", error: String(error.message || error) });
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(value)}\n`);
}
