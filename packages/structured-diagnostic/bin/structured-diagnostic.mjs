#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

import {
  DiagnosticContractError,
  canonicalizeDiagnosticJsonl,
} from "../adapters/node.mjs";

function usage() {
  return "usage: structured-diagnostic check [file|-]\n";
}

function writeError(error) {
  if (error instanceof DiagnosticContractError) {
    const location = [
      error.line === undefined ? null : `line ${error.line}`,
      error.path && error.path !== "$" ? error.path : null,
    ].filter(Boolean).join(":");
    const suffix = location === "" ? "" : ` ${location}`;
    process.stderr.write(`structured-diagnostic: ${error.code}${suffix}: ${error.message}\n`);
    return;
  }
  process.stderr.write(`structured-diagnostic: INPUT_READ_FAILED: ${error.message}\n`);
}

const [command, input = "-", ...rest] = process.argv.slice(2);
if (command !== "check" || rest.length !== 0) {
  process.stderr.write(usage());
  process.exitCode = 2;
} else {
  try {
    const text = input === "-" ? readFileSync(0, "utf8") : readFileSync(input, "utf8");
    const canonical = canonicalizeDiagnosticJsonl(text);
    process.stdout.write(canonical);
  } catch (error) {
    writeError(error);
    process.exitCode = 1;
  }
}
