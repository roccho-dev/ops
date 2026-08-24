#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [action] = process.argv.slice(2);
const root = path.resolve(process.env.TASK_GRAPH_ROOT ?? process.cwd());
const out = path.join(root, "out");

const write = (name, value) => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, name), value, "utf8");
};

if (action === "produce") {
  fs.rmSync(out, { recursive: true, force: true });
  write("value.txt", "42\n");
  console.log(JSON.stringify({ task: action, value: 42 }));
} else if (action === "verify") {
  assert.equal(fs.readFileSync(path.join(out, "value.txt"), "utf8"), "42\n");
  write("status.txt", "PASS\n");
  console.log(JSON.stringify({ task: action, status: "PASS" }));
} else {
  throw new Error(`unknown task action: ${action ?? "<missing>"}`);
}
