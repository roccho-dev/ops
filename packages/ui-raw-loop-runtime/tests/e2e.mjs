import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-raw-loop-"));
const rawPath = path.join(dir, "raw.jsonl");
const port = 19180 + Math.floor(Math.random() * 1000);
const child = spawn("ui-raw-loop-runtime", ["--raw", rawPath, "--serve", "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/read-model`);
      if (res.status === 200) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${stderr}`);
}

try {
  await waitForServer();
  const record = {
    kind: "jsonl.record.generic.v1",
    recordId: "ui:test-owner-input-1",
    recordedAt: "2026-06-20T00:00:00.000Z",
    payloadKind: "owner.raw.input.v1",
    payloadVersion: "v1",
    payload: {
      kind: "owner.raw.input.v1",
      goalRef: "goal:repo-package-ui-loop",
      purposeRef: "company-exit",
      ownerRef: "CEO",
      sourceSurface: "ui-log-panel",
      targetRefs: [{ kind: "ui.targetRef.v1", targetKind: "purpose", targetId: "company-exit", label: "company exit" }],
      body: "@company-exit review queued"
    },
    meta: { canonicalStatus: "input-not-authority", approval: false, authorizesFire: false, authorizesMerge: false }
  };
  const post = await fetch(`http://127.0.0.1:${port}/api/raw`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) });
  assert.equal(post.status, 200);
  const receipt = await post.json();
  assert.equal(receipt.kind, "ui.raw.loop.receipt.v1");
  assert.equal(receipt.projection.ownerInputCount, 1);
  const read = await fetch(`http://127.0.0.1:${port}/read-model`);
  assert.equal(read.status, 200);
  const model = await read.json();
  assert.equal(model.kind, "ui.raw.loop.read_model.v1");
  assert.equal(model.byGoal["goal:repo-package-ui-loop"], 1);
  assert.ok(model.mentionIndex.mentions.some((m) => m.refId === "company-exit"));
  assert.match(fs.readFileSync(rawPath, "utf8"), /owner.raw.input.v1/);
  console.log(JSON.stringify({ status: "ui-raw-loop-e2e-pass", ownerInputCount: model.ownerInputCount }, null, 2));
} finally {
  child.kill("SIGTERM");
}
