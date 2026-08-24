#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const fail = message => { throw new Error(message); };
const safeId = value => typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value);

function options(args) {
  const result = {};
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!["--graph", "--target", "--receipt"].includes(key) || !value || result[key]) fail("invalid options");
    result[key] = value;
  }
  for (const key of ["--graph", "--target", "--receipt"]) if (!result[key]) fail(`missing ${key}`);
  return result;
}

function loadGraph(file) {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { fail(`line ${index + 1}: invalid JSON`); }
    if (row?.schema !== "ops.taskNode/1" || !safeId(row.id)) fail(`line ${index + 1}: invalid task`);
    if (!Array.isArray(row.deps) || row.deps.some(dep => !safeId(dep))) fail(`${row.id}: invalid deps`);
    if (!Array.isArray(row.argv) || row.argv.length === 0 || row.argv.some(value => typeof value !== "string" || value.length === 0)) fail(`${row.id}: invalid argv`);
    if (row.cwd !== undefined && (typeof row.cwd !== "string" || path.isAbsolute(row.cwd) || row.cwd.split(/[\\/]/u).some(part => part === ".."))) fail(`${row.id}: invalid cwd`);
    return Object.freeze({ id: row.id, deps: Object.freeze([...row.deps]), argv: Object.freeze([...row.argv]), cwd: row.cwd ?? "." });
  });
  if (rows.length === 0) fail("empty task graph");
  const tasks = new Map();
  for (const row of rows) {
    if (tasks.has(row.id)) fail(`duplicate task: ${row.id}`);
    tasks.set(row.id, row);
  }
  for (const row of rows) for (const dep of row.deps) if (!tasks.has(dep)) fail(`${row.id}: missing dependency ${dep}`);
  return tasks;
}

function orderFor(tasks, target) {
  if (!tasks.has(target)) fail(`unknown target: ${target}`);
  const states = new Map();
  const ordered = [];
  const visit = id => {
    const state = states.get(id) ?? 0;
    if (state === 1) fail(`cycle at ${id}`);
    if (state === 2) return;
    states.set(id, 1);
    for (const dep of tasks.get(id).deps) visit(dep);
    states.set(id, 2);
    ordered.push(tasks.get(id));
  };
  visit(target);
  return ordered;
}

function run() {
  const opts = options(process.argv.slice(2));
  const root = process.cwd();
  const graph = path.resolve(root, opts["--graph"]);
  const receipt = path.resolve(root, opts["--receipt"]);
  const target = opts["--target"];
  const tasks = loadGraph(graph);
  const ordered = orderFor(tasks, target);
  const results = [];

  for (const task of ordered) {
    const cwd = path.resolve(root, task.cwd);
    if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) fail(`${task.id}: cwd escapes root`);
    const completed = spawnSync(task.argv[0], task.argv.slice(1), {
      cwd,
      env: { ...process.env, TASK_GRAPH_ROOT: root, TASK_GRAPH_TASK_ID: task.id },
      shell: false,
      stdio: "inherit",
    });
    const exitCode = completed.status ?? 1;
    results.push(Object.freeze({ id: task.id, exitCode }));
    if (completed.error) fail(`${task.id}: ${completed.error.message}`);
    if (exitCode !== 0) fail(`${task.id}: exit ${exitCode}`);
  }

  const value = Object.freeze({
    schema: "ops.taskGraphReceipt/1",
    status: "PASS",
    target,
    graph: path.relative(root, graph).replaceAll(path.sep, "/"),
    order: Object.freeze(ordered.map(task => task.id)),
    results: Object.freeze(results),
  });
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, `${JSON.stringify(value)}\n`, "utf8");
  console.log(JSON.stringify(value));
}

try { run(); } catch (error) { console.error(`task-graph: ${error.message}`); process.exit(1); }
