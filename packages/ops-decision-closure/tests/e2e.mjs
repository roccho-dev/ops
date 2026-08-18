#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const cli = path.join(root, "packages/ops-decision-closure/bin/ops-decision-closure.py");
const pythonCommand = process.env.OPS_PYTHON || "python3";
const duckdb = process.env.OPS_DUCKDB || "duckdb";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ops-decision-closure-"));
try {
  const r = spawnSync(pythonCommand, [cli, "proof", "--out-dir", out, "--duckdb", duckdb], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
  const summary = JSON.parse(r.stdout.trim());
  assert.equal(summary.status, "PASS_BOUNDED_LOCAL_PROOF");
  assert.equal(summary.verdict, "HOLD_JSONL_AUTHORITY_ONLY");
  assert.equal(summary.semanticMismatchCount, 0);
  assert.equal(summary.negativeCaseCount, 42);
  const receipt = JSON.parse(fs.readFileSync(path.join(out, "closure-receipt.json"), "utf8"));
  assert.equal(receipt.failClosedMismatchCount, 0);
  assert.equal(receipt.oldCheckpointReplay, "PASS");
  assert.equal(receipt.humanProjection.javascriptRequired, false);
  assert.ok(fs.statSync(path.join(out, "decision-room.html")).size > 1000);
  assert.ok(fs.statSync(path.join(out, "decision-packet.json")).size > 1000);
  assert.equal(receipt.terminalStates.L3, "HOLD_INSUFFICIENT_ECONOMIC_BASELINE");
  assert.equal(receipt.terminalStates.L4, "BLOCKED_KEY_PERSON_DEPENDENCY");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
