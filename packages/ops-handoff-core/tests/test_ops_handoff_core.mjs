#!/usr/bin/env node
// Static behavior tests for ops-handoff-core (Node port of test_ops_handoff_core.py).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

function assert(cond, message) {
  if (!cond) throw new Error("AssertionError: " + (message || ""));
}

function run(cmd, expect = 0) {
  const proc = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf-8" });
  const code = proc.status;
  if (code !== expect) {
    throw new Error(
      `unexpected exit ${code}, expected ${expect}: ${cmd.join(" ")}\n` +
        `stdout:\n${proc.stdout}\nstderr:\n${proc.stderr}`,
    );
  }
  return proc;
}

function main(argv) {
  const packageDir = path.resolve(argv[0]);
  const outRoot = path.resolve(argv[1]);
  const binPath = path.join(packageDir, "bin", "ops-handoff-core.mjs");
  const fixtures = path.join(packageDir, "tests", "fixtures");
  const handoff = path.join(outRoot, "handoff");
  fs.mkdirSync(outRoot, { recursive: true });

  const node = process.execPath;

  const generate = run([
    node,
    binPath,
    "generate",
    "--role-catalog",
    path.join(fixtures, "role-catalog.md"),
    "--topology",
    path.join(fixtures, "organization-topology.a2ui.jsonl"),
    "--command-board",
    path.join(fixtures, "command-board.a2ui.jsonl"),
    "--request",
    path.join(fixtures, "REQUEST.md"),
    "--source-manifest",
    path.join(fixtures, "source-manifest.json"),
    "--runtime-manifest",
    path.join(fixtures, "runtime-manifest.json"),
    "--merge-target",
    path.join(fixtures, "merge-target.json"),
    "--thread-roster",
    path.join(fixtures, "thread-roster.json"),
    "--out-dir",
    handoff,
    "--json",
  ]);
  const generated = JSON.parse(generate.stdout);
  assert(generated.status === "handoff-generated", "generate status");

  const validate = run([
    node,
    binPath,
    "validate",
    "--handoff-dir",
    handoff,
    "--no-role-body-sentinel",
    "FULL_ROLE_CATALOG_BODY_SENTINEL",
  ]);
  const valid = JSON.parse(validate.stdout);
  assert(valid.status === "handoff-valid", "validate status");

  const manifest = JSON.parse(fs.readFileSync(path.join(handoff, "HANDOFF_MANIFEST.json"), "utf-8"));
  assert(manifest.handoffId.startsWith("handoff:"), "handoffId prefix");
  assert(manifest.handoffId !== "handoff:ops-handoff-core-proof", "handoffId not stub");
  assert(manifest.state.current === "handoff-created", "state current");
  assert(manifest.state.terminal === false, "state terminal");
  assert(manifest.approvalBoundary.transportReadbackIsApproval === false, "transportReadbackIsApproval");
  assert(manifest.approvalBoundary.semanticApproval === false, "semanticApproval");
  assert(manifest.approvalBoundary.completionApproval === false, "completionApproval");
  const fns = new Set(manifest.threads.map((row) => row.threadFunction));
  const want = new Set(["impl-work", "impl-review", "merge-work", "merge-review"]);
  assert(fns.size === want.size && [...want].every((f) => fns.has(f)), "thread functions set");

  const threadsRoot = path.join(handoff, "THREADS");
  const mdFiles = [];
  for (const dir of fs.readdirSync(threadsRoot).sort()) {
    const full = path.join(threadsRoot, dir);
    if (fs.statSync(full).isDirectory()) {
      for (const f of fs.readdirSync(full).sort()) {
        if (f.endsWith(".md")) mdFiles.push(path.join(full, f));
      }
    }
  }
  const threadText = mdFiles.map((p) => fs.readFileSync(p, "utf-8")).join("\n");
  assert(!threadText.includes("project-source-put"), "no project-source-put");
  assert(!threadText.includes("project-thread-create"), "no project-thread-create");
  assert(!threadText.includes("project-artifact-fetch"), "no project-artifact-fetch");
  assert(!threadText.includes("FULL_ROLE_CATALOG_BODY_SENTINEL"), "no sentinel");

  const missing = run(
    [
      node,
      binPath,
      "generate",
      "--role-catalog",
      path.join(fixtures, "role-catalog.md"),
      "--topology",
      path.join(fixtures, "organization-topology.a2ui.jsonl"),
      "--command-board",
      path.join(fixtures, "command-board.a2ui.jsonl"),
      "--request",
      path.join(fixtures, "REQUEST.md"),
      "--source-manifest",
      path.join(fixtures, "source-manifest.json"),
      "--runtime-manifest",
      path.join(fixtures, "runtime-manifest.json"),
      "--merge-target",
      path.join(fixtures, "merge-target.json"),
      "--out-dir",
      path.join(outRoot, "missing-roster"),
      "--json",
    ],
    2,
  );
  const missingResult = JSON.parse(missing.stdout);
  assert(missingResult.status === "missing-required-input", "missing-required-input");

  const artifact = path.join(outRoot, "artifact.txt");
  const runReport = path.join(outRoot, "RUN_REPORT.md");
  const verdict = path.join(outRoot, "verdict.txt");
  const claimPath = path.join(outRoot, "claim.jsonl");
  fs.writeFileSync(artifact, "artifact\n", "utf-8");
  fs.writeFileSync(runReport, "# run report\nok\n", "utf-8");
  fs.writeFileSync(verdict, "merge-review-pass\nok\n", "utf-8");
  const imported = run([
    node,
    binPath,
    "import-result",
    "--thread-function",
    "merge-review",
    "--artifact",
    artifact,
    "--run-report",
    runReport,
    "--verdict-file",
    verdict,
    "--claim-path",
    claimPath,
    "--json",
  ]);
  const importedDoc = JSON.parse(imported.stdout);
  assert(importedDoc.status === "handoff-result-imported", "import status");
  assert(importedDoc.localizerApproval === false, "localizerApproval");
  assert(fs.statSync(claimPath).isFile(), "claim file");
  const lines = fs.readFileSync(claimPath, "utf-8").split(/\r\n|\r|\n/).filter((l) => l !== "");
  const claim = JSON.parse(lines[lines.length - 1]);
  assert(claim.approvalBoundary.localizerApproval === false, "claim localizerApproval");
  assert(claim.artifacts[0].sha256, "artifact sha256");
  return 0;
}

process.exit(main(process.argv.slice(2)));
