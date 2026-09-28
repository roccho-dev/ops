#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadJson, runTargetRuntime } from "./lib.mjs";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    values[key.slice(2)] = value;
    index += 1;
  }
  if (!values.request) throw new Error("--request is required");
  return values;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runTargetRuntime(loadJson(args.request, "runtime request"));
    process.stdout.write(`${JSON.stringify({ status: result.status, claim: result.claim })}\n`);
  } catch (error) {
    process.stderr.write(`voice-ui-target-runtime: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
