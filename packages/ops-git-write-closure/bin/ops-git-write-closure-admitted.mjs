#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const original = fileURLToPath(new URL("./ops-git-write-closure.mjs", import.meta.url));

function fail(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(1);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) fail("INVALID_ARGUMENT", `missing ${name}`);
  return args[index + 1];
}

function flagMap(command) {
  const flags = new Map();
  for (let index = 2; index < command.length; index += 2) {
    const name = command[index];
    const value = command[index + 1];
    if (!name?.startsWith("--") || value === undefined || flags.has(name)) {
      fail("INVALID_SHIFTLEFT_ADMISSION", "verify-worktree flags must be unique name/value pairs");
    }
    flags.set(name, value);
  }
  return flags;
}

function requireShiftLeftAdmission(request) {
  const matches = (request.checks ?? []).filter((check) => check?.id === "shiftleft-admission");
  if (matches.length !== 1) {
    fail("SHIFTLEFT_ADMISSION_REQUIRED", `expected exactly one shiftleft-admission check, got ${matches.length}`);
  }

  const command = matches[0].command;
  if (!Array.isArray(command) || command.length !== 8) {
    fail("INVALID_SHIFTLEFT_ADMISSION", "command must be policyctl verify-worktree plus three required flags");
  }
  if (command[0] !== "policyctl" || command[1] !== "verify-worktree") {
    fail("INVALID_SHIFTLEFT_ADMISSION", "command must invoke the canonical policyctl verify-worktree entrypoint");
  }

  const flags = flagMap(command);
  const receipt = flags.get("--receipt");
  const policyHash = flags.get("--policy-sha256");
  const repo = flags.get("--repo");
  if (!receipt) fail("INVALID_SHIFTLEFT_ADMISSION", "--receipt is required");
  if (!/^sha256:[0-9a-f]{64}$/.test(policyHash ?? "")) {
    fail("INVALID_SHIFTLEFT_ADMISSION", "--policy-sha256 must be an exact SHA-256 identity");
  }
  if (!repo || resolve(repo) !== resolve(request.worktree)) {
    fail("INVALID_SHIFTLEFT_ADMISSION", "--repo must equal the request worktree");
  }
}

const args = process.argv.slice(2);
if (args[0] === "prepare") {
  const requestPath = option(args, "--request");
  let request;
  try {
    request = JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (error) {
    fail("INVALID_REQUEST", error.message);
  }
  requireShiftLeftAdmission(request);
}

const delegated = spawnSync(process.execPath, [original, ...args], {
  stdio: "inherit",
  env: process.env,
});
if (delegated.error) fail("DELEGATE_FAILED", delegated.error.message);
if (delegated.signal) fail("DELEGATE_FAILED", `terminated by ${delegated.signal}`);
process.exit(delegated.status ?? 1);
