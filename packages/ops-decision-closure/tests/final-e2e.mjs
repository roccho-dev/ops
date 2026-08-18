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
const cli = path.join(root, "packages/ops-decision-closure/bin/final-proof.py");
const duckdb = process.env.OPS_DUCKDB || "duckdb";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ops-decision-final-"));
try {
  const r = spawnSync("python3", [cli, "--out-dir", out, "--duckdb", duckdb, "--source-commit", "0000000000000000000000000000000000000000", "--source-tree", "0000000000000000000000000000000000000000"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${r.stdout}
${r.stderr}`);
  const summary = JSON.parse(r.stdout.trim());
  assert.equal(summary.status, "PASS_IMPLEMENTATION_READY_FOR_RELEASE");
  assert.equal(summary.selectedEngine, "sqlite-shards");
  assert.equal(summary.semanticMismatchCount, 0);
  assert.equal(summary.failClosedMismatchCount, 0);
  assert.equal(summary.decisionEconomics, "PASS_DECISION_ECONOMICS_G9");
  const receipt = JSON.parse(fs.readFileSync(path.join(out, "final-closure-receipt.json"), "utf8"));
  assert.equal(receipt.terminalStates.L1, "PASS_SQLITE_SHARDS");
  assert.equal(receipt.terminalStates.L3, "PASS_DECISION_ECONOMICS_G9");
  assert.equal(receipt.humanAI.actionCandidateCount, 5);
  assert.equal(receipt.humanAI.machineAnswerability, "PASS_MACHINE_ANSWERABILITY");
  assert.equal(receipt.humanAI.directAuthorityWriteCount, 0);
  assert.ok(fs.statSync(path.join(out, "decision-room.html")).size > 1000);
  assert.ok(fs.statSync(path.join(out, "dd-packet", "known-limitations.json")).size > 10);
  process.stdout.write(`${JSON.stringify(summary)}
`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
