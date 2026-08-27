#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCanonicalJsonl } from "../../packages/artifact-assembly/src/canonical-json.mjs";
import { readArtifactLock } from "../../packages/artifact-assembly/src/lock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const criteriaPath = path.join(here, "data", "jsonl", "criteria.jsonl");
const statusPath = path.join(here, "data", "jsonl", "status.jsonl");
const outputPath = path.join(here, "generated", "completion-gates.md");
const lockPath = path.resolve(here, "../../locks/semantic-map-a2ui.jsonl");
const freshBundleReceiptPath = path.join(here, "evidence", "fresh-bundle-closure-receipt.json");
const sourceExportReceiptPath = path.join(here, "evidence", "source-export-retirement-receipt.json");
const allowedStatuses = new Set(["IN_PROGRESS", "NOT_STARTED", "PASS", "PENDING_INPUT"]);

const readRows = (filePath, label) => parseCanonicalJsonl(fs.readFileSync(filePath, "utf8"), label);

const indexUnique = (rows, label) => {
  const index = new Map();
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error(`${label}: every row must be an object`);
    if (typeof row.id !== "string" || row.id.length === 0) throw new Error(`${label}: every row needs a non-empty id`);
    if (index.has(row.id)) throw new Error(`${label}: duplicate id ${row.id}`);
    index.set(row.id, row);
  }
  return index;
};

const validate = (criteria, statuses) => {
  const criteriaById = indexUnique(criteria, "criteria");
  const statusById = indexUnique(statuses, "status");
  const missingStatus = [...criteriaById.keys()].filter((id) => !statusById.has(id));
  const orphanStatus = [...statusById.keys()].filter((id) => !criteriaById.has(id));
  if (missingStatus.length > 0 || orphanStatus.length > 0) {
    throw new Error(`criteria/status id mismatch; missing=${missingStatus.join(",") || "none"}; orphan=${orphanStatus.join(",") || "none"}`);
  }
  for (const row of criteria) {
    const keys = Object.keys(row).sort().join(",");
    if (keys !== "blocking,evidence,expected,group,id,method,owner,requirement") throw new Error(`criteria ${row.id}: unexpected fields ${keys}`);
    if (typeof row.blocking !== "boolean") throw new Error(`criteria ${row.id}: blocking must be boolean`);
    for (const field of ["evidence", "expected", "group", "method", "owner", "requirement"]) {
      if (typeof row[field] !== "string") throw new Error(`criteria ${row.id}: ${field} must be string`);
    }
  }
  for (const row of statuses) {
    const keys = Object.keys(row).sort().join(",");
    if (keys !== "id,note,status") throw new Error(`status ${row.id}: unexpected fields ${keys}`);
    if (!allowedStatuses.has(row.status)) throw new Error(`status ${row.id}: unsupported status ${row.status}`);
    if (typeof row.note !== "string") throw new Error(`status ${row.id}: note must be string`);
  }
  return { criteriaById, statusById };
};

const validateLockedArtifactEvidence = (criteriaById, lockRows) => {
  const appRows = lockRows.filter((row) => row.id === "semantic-map-a2ui-app");
  if (appRows.length !== 1) throw new Error(`semantic-map lock: expected one semantic-map-a2ui-app row, found ${appRows.length}`);
  const app = appRows[0];
  if (app.owner !== "ui") throw new Error("semantic-map lock: app owner must be ui");
  if (app.status !== "locked") throw new Error("semantic-map lock: app must be locked");
  if (!/^[a-f0-9]{40}$/u.test(app.revision ?? "")) throw new Error("semantic-map lock: app revision must be a Git commit");
  if (!/^[a-f0-9]{64}$/u.test(app.sha256 ?? "")) throw new Error("semantic-map lock: app sha256 must be a digest");
  const digestCriterion = criteriaById.get("BLD-002");
  if (!digestCriterion) throw new Error("criteria: BLD-002 is required");
  if (digestCriterion.expected !== app.sha256) {
    throw new Error(`criteria/lock digest drift: BLD-002=${digestCriterion.expected}; lock=${app.sha256}`);
  }
  const revisionCriterion = criteriaById.get("BLD-003");
  if (!revisionCriterion) throw new Error("criteria: BLD-003 is required");
  if (revisionCriterion.expected !== app.revision) {
    throw new Error(`criteria/lock revision drift: BLD-003=${revisionCriterion.expected}; lock=${app.revision}`);
  }
  return app;
};

const readJson = (filePath, label) => {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value;
};

const requireHex = (value, size, label) => {
  if (!(new RegExp(`^[a-f0-9]{${size}}$`, "u")).test(value ?? "")) throw new Error(`${label}: invalid digest`);
};

const validateFreshBundleEvidence = (statusById, lockRows) => {
  const closed = ["TRN-012", "URLX-007"].every((id) => statusById.get(id)?.status === "PASS");
  if (!closed) return;
  const receipt = readJson(freshBundleReceiptPath, "fresh bundle receipt");
  if (receipt.schema !== "roccho.fresh-bundle-closure-receipt/1" || receipt.status !== "PASS" || receipt.authority !== false) {
    throw new Error("fresh bundle receipt: schema/status/authority differs");
  }
  if (JSON.stringify(receipt.criteria) !== JSON.stringify(["TRN-012", "URLX-007"])) throw new Error("fresh bundle receipt: criterion closure differs");
  const mobile = receipt.bundles?.["mobile-agent"];
  const ui = receipt.bundles?.ui;
  const ops = receipt.bundles?.["ops-proof-parent"];
  for (const [name, row] of [["mobile-agent", mobile], ["ui", ui], ["ops-proof-parent", ops]]) {
    if (!row || row.bundleVerify !== "PASS" || row.directClone !== "PASS" || row.strictFsck !== "PASS") throw new Error(`fresh bundle receipt: ${name} clone proof differs`);
    requireHex(row.head, 40, `${name} head`);
    requireHex(row.sha256, 64, `${name} bundle sha256`);
  }
  if (mobile.fullVerification?.status !== "PASS" || mobile.fullVerification?.gates !== 48) throw new Error("fresh bundle receipt: mobile full verification differs");
  if (ui.repositoryCheck !== "PASS" || ui.generatedBuilds !== 2 || ui.businessModelDifferential?.pixelExact !== true || ui.businessModelDifferential?.mobilePixelExact !== true) throw new Error("fresh bundle receipt: UI proof differs");
  if (ops.registeredChecks?.total !== 44 || ops.registeredChecks?.pass !== 44 || ops.registeredChecks?.fail !== 0 || ops.registeredChecks?.timeout !== 0) throw new Error("fresh bundle receipt: OPS check matrix differs");
  if (!Object.values(receipt.crossFeature ?? {}).every((value) => value === "PASS")) throw new Error("fresh bundle receipt: cross-feature proof differs");
  const source = lockRows.find((row) => row.id === "semantic-map-package");
  const app = lockRows.find((row) => row.id === "semantic-map-a2ui-app");
  if (source?.revision !== mobile.head) throw new Error("fresh bundle receipt: mobile head/lock drift");
  if (app?.revision !== ui.head) throw new Error("fresh bundle receipt: UI head/lock drift");
  const sourceReceipt = readJson(sourceExportReceiptPath, "source export receipt");
  if (sourceReceipt.status !== "PASS_FRESH_BUNDLE_REPRODUCED" || sourceReceipt.freshBundleProof?.status !== "PASS") throw new Error("source export receipt: fresh proof differs");
  if (sourceReceipt.finalHeads?.mobileAgent !== mobile.head || sourceReceipt.finalHeads?.ui !== ui.head) throw new Error("source export receipt: final head drift");
  if (sourceReceipt.freshBundleProof?.mobileAgent?.sha256 !== mobile.sha256 || sourceReceipt.freshBundleProof?.ui?.sha256 !== ui.sha256) throw new Error("source export receipt: bundle digest drift");
};

const cell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\r", "").replaceAll("\n", "<br>");

const summarize = (criteria, statusById) => {
  const statusCounts = { IN_PROGRESS: 0, NOT_STARTED: 0, PASS: 0, PENDING_INPUT: 0 };
  let blockingOpen = 0;
  for (const criterion of criteria) {
    const status = statusById.get(criterion.id).status;
    statusCounts[status] += 1;
    if (criterion.blocking && status !== "PASS") blockingOpen += 1;
  }
  return { blockingOpen, statusCounts, total: criteria.length };
};

const render = (criteria, statusById, summary) => {
  const counts = ["PASS", "IN_PROGRESS", "NOT_STARTED", "PENDING_INPUT"]
    .map((status) => `\`${status}\`=${summary.statusCounts[status]}`)
    .join(" / ");
  const lines = [
    "# Parallel branch merge — completion verification matrix",
    "",
    "> Generated from `data/jsonl/criteria.jsonl` + `data/jsonl/status.jsonl`. Do not hand-edit.",
    "",
    `- Total gates: **${summary.total}**`,
    `- Blocking gates not PASS: **${summary.blockingOpen}**`,
    `- Status counts: ${counts}`,
    "",
    "| ID | Group | Owner | Blocking | Status | Requirement | Method | Expected | Evidence | Note |",
    "|---|---|---|:---:|---|---|---|---|---|---|",
  ];
  for (const criterion of criteria) {
    const state = statusById.get(criterion.id);
    lines.push(`| ${cell(criterion.id)} | ${cell(criterion.group)} | ${cell(criterion.owner)} | ${criterion.blocking ? "YES" : "NO"} | ${cell(state.status)} | ${cell(criterion.requirement)} | ${cell(criterion.method)} | ${cell(criterion.expected)} | ${cell(criterion.evidence)} | ${cell(state.note)} |`);
  }
  return `${lines.join("\n")}\n`;
};

const criteria = readRows(criteriaPath, "criteria.jsonl");
const statuses = readRows(statusPath, "status.jsonl");
const { criteriaById, statusById } = validate(criteria, statuses);
const semanticMapLock = readArtifactLock(lockPath);
validateLockedArtifactEvidence(criteriaById, semanticMapLock);
validateFreshBundleEvidence(statusById, semanticMapLock);
const summary = summarize(criteria, statusById);
const expected = render(criteria, statusById, summary);
const mode = process.argv[2] ?? "write";

if (mode === "write") {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, expected);
} else if (mode === "check") {
  const actual = fs.readFileSync(outputPath, "utf8");
  if (actual !== expected) throw new Error("generated completion matrix is stale");
} else if (mode === "require-complete" || mode === "--require-complete") {
  if (summary.blockingOpen !== 0) {
    process.stderr.write(`completion blocked: ${summary.blockingOpen} blocking gates are not PASS\n`);
    process.exitCode = 1;
  }
} else if (mode === "summary") {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} else {
  throw new Error(`unknown mode: ${mode}`);
}

if (mode !== "summary") process.stdout.write(`completion matrix ${mode}: ${summary.total} gates; ${summary.blockingOpen} blocking open\n`);
