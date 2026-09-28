#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function atomicJson(file, value) {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporaryDirectory = mkdtempSync(path.join(directory, ".voice-ui-isolation-"));
  try {
    const temporary = path.join(temporaryDirectory, "verdict.json");
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, target);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function captureIsolation({ root, opsSha, output, spawn = spawnSync }) {
  requireCondition(SHA40.test(opsSha ?? ""), "ops SHA must be an exact 40-character lowercase SHA");
  const repository = path.resolve(root ?? ".");
  const checker = path.join(repository, "tools/check-ci-intent-workflow-branches.mjs");
  const intent = path.join(repository, "ci.intent.v1.jsonl");
  const boundary = path.join(repository, "contracts/secret-effect-boundary.v1.jsonl");
  for (const file of [checker, intent, boundary]) requireCondition(existsSync(file), `isolation input missing: ${path.relative(repository, file)}`);

  if (existsSync(path.join(repository, ".git"))) {
    const resolved = spawn("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" });
    requireCondition(resolved.status === 0, "cannot resolve repository HEAD");
    requireCondition(resolved.stdout.trim() === opsSha, "ops SHA differs from repository HEAD");
  }

  const checked = spawn(process.execPath, [checker, repository], { encoding: "utf8" });
  if (checked.stdout) process.stdout.write(checked.stdout);
  if (checked.stderr) process.stderr.write(checked.stderr);
  requireCondition(checked.status === 0, `secret-effect isolation check failed with exit ${checked.status ?? "signal"}`);
  const lines = checked.stdout.split(/\r?\n/).filter(line => line.trim());
  requireCondition(lines.length > 0, "isolation checker emitted no verdict");
  const source = JSON.parse(lines.at(-1));
  requireCondition(source.kind === "ops.secretEffectBoundary.check.v1", "isolation checker kind differs");
  requireCondition(source.status === "PASS" && source.unclassified === 0, "isolation checker did not PASS");

  const verdict = {
    ...source,
    opsSha,
    inputs: {
      checkerSha256: `sha256:${digest(checker)}`,
      intentSha256: `sha256:${digest(intent)}`,
      boundarySha256: `sha256:${digest(boundary)}`,
    },
  };
  atomicJson(output, verdict);
  return verdict;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    requireCondition(key.startsWith("--"), `unexpected argument: ${key}`);
    const value = argv[index + 1];
    requireCondition(value !== undefined && !value.startsWith("--"), `missing value for ${key}`);
    values[key.slice(2)] = value;
    index += 1;
  }
  requireCondition(values["ops-sha"], "--ops-sha is required");
  requireCondition(values.output, "--output is required");
  return { root: values.root ?? ".", opsSha: values["ops-sha"], output: values.output };
}

async function main() {
  try {
    captureIsolation(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`capture-isolation: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
