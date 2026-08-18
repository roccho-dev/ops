#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.argv[2] ?? ".";
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const records = read("ci.intent.v1.jsonl")
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`ci.intent.v1.jsonl:${index + 1}: ${error.message}`);
    }
  })
  .filter((record) => record.kind === "ci.intent.v1" && record.provider === "github-actions");

const failures = [];
const indent = (line) => line.match(/^(\s*)/)[1].length;

function triggerBlock(text, trigger) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^(\\s*)${trigger}:\\s*(?:#.*)?$`));
    if (!match) continue;
    const base = match[1].length;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (indent(line) <= base) break;
      body.push(line);
    }
    return body;
  }
  return null;
}

function inlineArray(value, label) {
  const match = value.trim().match(/^\[(.*)\]$/);
  if (!match) throw new Error(`${label}: expected inline array`);
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);
}

function pushBranches(text, relative) {
  const body = triggerBlock(text, "push");
  if (!body) return null;
  for (let index = 0; index < body.length; index += 1) {
    const match = body[index].match(/^(\s*)branches:\s*(.*?)\s*$/);
    if (!match) continue;
    if (match[2]) return inlineArray(match[2], `${relative}:push.branches`);
    const base = match[1].length;
    const values = [];
    for (let cursor = index + 1; cursor < body.length; cursor += 1) {
      const line = body[cursor];
      if (indent(line) <= base) break;
      const item = line.match(/^\s*-\s*['\"]?([^'\"#]+?)['\"]?\s*(?:#.*)?$/);
      if (!item) throw new Error(`${relative}:push.branches contains an unsupported line: ${line.trim()}`);
      values.push(item[1].trim());
    }
    return values;
  }
  return ["*"];
}

const sameSet = (left, right) => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

for (const record of records) {
  if (!record.path) {
    failures.push("ci.intent.v1 record missing path");
    continue;
  }
  let workflow;
  try {
    workflow = read(record.path);
  } catch (error) {
    failures.push(`${record.path}: workflow file not readable: ${error.message}`);
    continue;
  }
  const dispatch = Array.isArray(record.dispatch) ? record.dispatch : [];
  for (const trigger of ["pull_request", "workflow_dispatch"]) {
    if (dispatch.includes(trigger) && triggerBlock(workflow, trigger) === null) {
      failures.push(`${record.path}: intent declares ${trigger} but workflow lacks ${trigger} trigger`);
    }
  }
  if (dispatch.includes("push")) {
    const actual = pushBranches(workflow, record.path);
    if (actual === null) {
      failures.push(`${record.path}: intent declares push but workflow lacks push trigger`);
      continue;
    }
    if (!Array.isArray(record.push_branches)) {
      failures.push(`${record.path}: intent declares push but missing push_branches array; use ["*"] for no branch filter`);
      continue;
    }
    if (!sameSet(record.push_branches, actual)) {
      failures.push(`${record.path}: push branch mismatch: intent=${JSON.stringify(record.push_branches)} workflow=${JSON.stringify(actual)}`);
    }
  }
}

if (failures.length) {
  console.error("ci intent/workflow branch check failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ kind: "ops.ciIntentWorkflowBranches.check.v1", status: "pass", records: records.length }));
