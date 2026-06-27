#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.argv[2] ?? ".";
const intentPath = path.join(root, "ci.intent.v1.jsonl");

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function parseJsonl(relPath) {
  return readText(relPath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${relPath}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

function indentOf(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function parseInlineArray(value, context) {
  const match = value.trim().match(/^\[(.*)\]\s*$/);
  if (!match) {
    throw new Error(`${context}: expected inline array such as [proposals]`);
  }
  const inner = match[1].trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => part.trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);
}

function extractTriggerBlock(text, trigger) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(new RegExp(`^(\\s*)${trigger}:\\s*(?:#.*)?$`));
    if (!match) continue;
    const baseIndent = match[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      if (indentOf(line) <= baseIndent) break;
      body.push(line);
    }
    return { line: i + 1, body };
  }
  return null;
}

function hasTrigger(text, trigger) {
  return extractTriggerBlock(text, trigger) !== null;
}

function extractPushBranches(text, relPath) {
  const block = extractTriggerBlock(text, "push");
  if (!block) return null;
  for (const line of block.body) {
    const match = line.match(/^\s*branches:\s*(.+?)\s*$/);
    if (match) {
      return parseInlineArray(match[1], `${relPath}:push.branches`);
    }
  }
  return null;
}

function sameSet(a, b) {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const failures = [];
const records = parseJsonl("ci.intent.v1.jsonl").filter(
  (record) => record.kind === "ci.intent.v1" && record.provider === "github-actions",
);

for (const record of records) {
  if (!record.path) {
    failures.push("ci.intent.v1 record missing path");
    continue;
  }

  let workflow;
  try {
    workflow = readText(record.path);
  } catch (error) {
    failures.push(`${record.path}: workflow file not readable: ${error.message}`);
    continue;
  }

  const dispatch = Array.isArray(record.dispatch) ? record.dispatch : [];

  if (dispatch.includes("pull_request") && !hasTrigger(workflow, "pull_request")) {
    failures.push(`${record.path}: intent declares pull_request but workflow lacks pull_request trigger`);
  }

  if (dispatch.includes("workflow_dispatch") && !hasTrigger(workflow, "workflow_dispatch")) {
    failures.push(`${record.path}: intent declares workflow_dispatch but workflow lacks workflow_dispatch trigger`);
  }

  if (dispatch.includes("push")) {
    if (!Array.isArray(record.push_branches)) {
      failures.push(`${record.path}: intent declares push but missing push_branches array`);
      continue;
    }
    const actual = extractPushBranches(workflow, record.path);
    if (!actual) {
      failures.push(`${record.path}: workflow lacks explicit push.branches`);
      continue;
    }
    if (!sameSet(record.push_branches, actual)) {
      failures.push(
        `${record.path}: push branch mismatch: intent=${JSON.stringify(record.push_branches)} workflow=${JSON.stringify(actual)}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("ci intent/workflow branch check failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ kind: "ops.ciIntentWorkflowBranches.check.v1", status: "pass", records: records.length }));
