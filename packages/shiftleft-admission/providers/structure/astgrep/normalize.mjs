#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function fail(code, detail) {
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || values.has(name)) {
      fail("INVALID_ARGUMENT", "expected unique --name value pairs");
    }
    values.set(name, value);
  }
  const required = ["--ast-grep", "--rule", "--source", "--language"];
  for (const name of required) {
    if (!values.get(name)) fail("INVALID_ARGUMENT", `missing ${name}`);
  }
  return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]));
}

function decodeQuotedModule(text) {
  if (text.length < 2) return text;
  const quote = text[0];
  if (text.at(-1) !== quote || !["\"", "'", "`"].includes(quote)) return text;
  if (quote === "\"") {
    try {
      return JSON.parse(text);
    } catch {
      fail("ASTGREP_OUTPUT_INVALID", `invalid JSON string literal ${text}`);
    }
  }
  let value = "";
  for (let index = 1; index < text.length - 1; index++) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length - 1) {
      value += text[++index];
    } else {
      value += char;
    }
  }
  return value;
}

function moduleFromMatch(match) {
  const captured = match?.metaVariables?.single?.MODULE;
  const raw = captured?.text ?? match?.text;
  if (typeof raw !== "string" || raw.length === 0) {
    fail("ASTGREP_OUTPUT_INVALID", "match has no module text");
  }
  const module = decodeQuotedModule(raw);
  const line = captured?.range?.start?.line ?? match?.range?.start?.line;
  if (!Number.isInteger(line) || line < 0) {
    fail("ASTGREP_OUTPUT_INVALID", "match has no zero-based line");
  }
  return { module, line: line + 1 };
}

const args = parseArgs(process.argv.slice(2));
if (!["go", "javascript", "python"].includes(args.language)) {
  fail("UNSUPPORTED_LANGUAGE", args.language);
}
const result = spawnSync(
  args["ast-grep"],
  ["scan", "--rule", args.rule, "--json=stream", "--color", "never", args.source],
  {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (result.error) fail("ASTGREP_EXEC_FAILED", result.error.message);
if (result.signal) fail("ASTGREP_EXEC_FAILED", `terminated by ${result.signal}`);
if (result.status !== 0) {
  fail("ASTGREP_SCAN_FAILED", `exit=${result.status} stderr=${result.stderr.trim()}`);
}
const imports = [];
for (const [index, line] of result.stdout.split("\n").entries()) {
  if (!line.trim()) continue;
  let match;
  try {
    match = JSON.parse(line);
  } catch (error) {
    fail("ASTGREP_OUTPUT_INVALID", `line ${index + 1}: ${error.message}`);
  }
  imports.push(moduleFromMatch(match));
}
imports.sort((left, right) => left.module.localeCompare(right.module) || left.line - right.line);
process.stdout.write(`${JSON.stringify({ schema: "shiftleft-import-report/1", imports })}\n`);
