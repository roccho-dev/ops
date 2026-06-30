#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingBin = path.join(here, "..", "bin", "ops-package-responses.mjs");
const cmd = fs.existsSync(siblingBin) ? [process.execPath, siblingBin] : ["ops-package-responses"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-package-responses-e2e-"));

function run(argv, opts = {}) {
  return execFileSync(cmd[0], [...cmd.slice(1), ...argv], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

try {
  const outDir = path.join(tmp, "packet");
  const emit = JSON.parse(run(["emit", "--out-dir", outDir, "--json"]));
  assert.equal(emit.kind, "ops.packageResponsePacket.v1");
  assert.equal(emit.authority, false);
  assert.equal(emit.non_authority_diagnostic, true);
  assert.equal(emit.row_counts.responses, 5);

  for (const file of emit.files) {
    assert.ok(fs.statSync(path.join(outDir, file)).size > 0, `${file} should be non-empty`);
  }
  assert.ok(fs.statSync(path.join(outDir, "manifest.json")).size > 0);

  const validation = JSON.parse(run(["validate", "--out-dir", outDir, "--json"]));
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(validation.counts.responses, 5);
  assert.equal(validation.counts.evidence, 10);
  assert.equal(validation.counts.receipts, 5);
  assert.equal(validation.counts.residuals, 1);

  const selftest = JSON.parse(run(["selftest", "--json"]));
  assert.equal(selftest.ok, true, JSON.stringify(selftest.errors));
  assert.equal(selftest.negative_fixture, "pass");

  const brokenDir = path.join(tmp, "broken");
  fs.cpSync(outDir, brokenDir, { recursive: true });
  fs.rmSync(path.join(brokenDir, "ops-package-receipts.jsonl"));
  let failed = false;
  try {
    run(["validate", "--out-dir", brokenDir, "--json"]);
  } catch (error) {
    failed = true;
    const result = JSON.parse(String(error.stdout));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "missing-file"));
  }
  assert.equal(failed, true, "missing receipt file must fail validation");

  process.stdout.write("ops-package-responses: all tests passed\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
