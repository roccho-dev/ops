#!/usr/bin/env node
// Test suite for ops-build-receipt-check.
//
// Synthesizes fixture data in tmp and runs the binary against each fixture,
// verifying PASS/FAIL and specific error codes. Uses PATH binary when
// available (Nix check), falls back to sibling source (local run).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingBin = path.join(here, "..", "bin", "ops-build-receipt-check.mjs");
const cmd = fs.existsSync(siblingBin)
  ? [process.execPath, siblingBin]
  : ["ops-build-receipt-check"];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-check-test-"));

function fixture(name, obj) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

const BASE = {
  kind: "build.receipt.v1",
  receiptId: "test-001",
  createdAt: "2026-06-19T00:00:00Z",
  buildResult: "success",
  classification: "success",
  inputs: [
    { inputId: "flake-nixpkgs", rawHash: "sha256-aaa", sourceRef: "github:NixOS/nixpkgs" },
    { inputId: "flake-self", rawHash: "sha256-bbb", sourceRef: "path:." },
  ],
  outputs: { outputSpecAsserted: true, contentHash: "sha256-ccc", outputPaths: ["/nix/store/example"] },
  environment: { system: "x86_64-linux", nixVersion: "2.28.1", toolchain: { nodejs: "22.14.0" } },
  metadata: {
    rawHash: "sha256-ddd",
    proposalHash: "sha256-ddd",
    treeHash: "abc123",
    dirty: false,
    intentRev: "proposal/example-260619",
    adrLinkage: ["ADR-001"],
    breakingChangeMarker: false,
  },
};

function run(fixturePath, extraArgs = []) {
  try {
    const out = execFileSync(cmd[0], [...cmd.slice(1), "--input", fixturePath, "--json", ...extraArgs], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    return { ok: true, result: JSON.parse(out) };
  } catch (e) {
    if (e.stdout) {
      return { ok: false, result: JSON.parse(e.stdout) };
    }
    throw e;
  }
}

// PASS: valid receipt
{
  const p = fixture("valid.json", BASE);
  const { ok, result } = run(p);
  assert.equal(ok, true, "valid receipt should pass");
  assert.equal(result.ok, true);
  assert.equal(result.classification, "success");
  assert.equal(result.errors.length, 0);
  console.log("ok - valid receipt passes");
}

// FAIL: authority field present
{
  const p = fixture("authority.json", { ...BASE, approved: true });
  const { ok, result } = run(p);
  assert.equal(ok, false, "authority field receipt should fail");
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes("authority-field-present"), "must detect authority field");
  console.log("ok - rejects authority field");
}

// FAIL: duplicate input IDs
{
  const p = fixture("dup-input.json", {
    ...BASE,
    inputs: [
      { inputId: "flake-nixpkgs", rawHash: "sha256-aaa" },
      { inputId: "flake-nixpkgs", rawHash: "sha256-bbb" },
    ],
  });
  const { ok, result } = run(p);
  assert.equal(ok, false, "duplicate input ID should fail");
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes("duplicate-input-id"), "must detect duplicate input ID");
  console.log("ok - rejects duplicate input IDs");
}

// FAIL: rawHash/proposalHash mismatch
{
  const p = fixture("hash-mismatch.json", {
    ...BASE,
    buildResult: "failure",
    classification: "unintended_breakage",
    metadata: { ...BASE.metadata, rawHash: "sha256-OLD", proposalHash: "sha256-NEW" },
  });
  const { ok, result } = run(p);
  assert.equal(ok, false, "hash mismatch should fail");
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes("rawHash-proposalHash-mismatch"), "must detect hash mismatch");
  console.log("ok - rejects rawHash/proposalHash mismatch");
}

// FAIL: dirty without treeHash
{
  const meta = { ...BASE.metadata, dirty: true };
  delete meta.treeHash;
  const p = fixture("dirty-no-tree.json", {
    ...BASE,
    buildResult: "failure",
    classification: "env_toolchain_cache",
    metadata: meta,
  });
  const { ok, result } = run(p);
  assert.equal(ok, false, "dirty without treeHash should fail");
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes("dirty-without-treeHash"), "must detect dirty without treeHash");
  console.log("ok - rejects dirty tree without treeHash");
}

// ADVISORY: stale intent rev (receipt is valid, advisory surfaced)
{
  const p = fixture("stale-rev.json", {
    ...BASE,
    metadata: { ...BASE.metadata, intentRev: "proposal/old-260601" },
  });
  const { ok, result } = run(p, ["--intent-rev", "proposal/current-260619"]);
  assert.equal(ok, true, "stale intent rev receipt is still valid (advisory only)");
  const advCodes = result.advisories.map((a) => a.code);
  assert.ok(advCodes.includes("stale-intent-rev"), "must surface stale-intent-rev advisory");
  console.log("ok - surfaces stale intent rev as advisory");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("all tests passed");
