#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicJson, exactSha, requireCondition, sanitizedEnv, sha256File } from "./modules/core.mjs";
import { validateIsolationVerdict } from "./modules/input-contracts.mjs";

// Build-time evidence capture, not part of normal artifact-only consumption.
export function captureIsolation({ root, opsSha, output, spawn = spawnSync }) {
  exactSha(opsSha, "ops SHA");
  const repository = path.resolve(root ?? ".");
  const inputs = ["tools/check-ci-intent-workflow-branches.mjs", "ci.intent.v1.jsonl",
    "contracts/secret-effect-boundary.v1.jsonl", ".github/workflows"];
  const env = sanitizedEnv(process.env);
  function git(...args) {
    const result = spawn("git", ["-C", repository, ...args], { encoding: "utf8", env });
    requireCondition(result.status === 0, "isolation capture requires a readable Git source checkout");
    return result.stdout.trim();
  }
  function verifySource() {
    requireCondition(git("rev-parse", "HEAD") === opsSha, "ops SHA differs from repository HEAD");
    requireCondition(git("status", "--porcelain=v1", "--untracked-files=all", "--ignored", "--", ...inputs) === "",
      "isolation source inputs differ from the committed tree");
    for (const file of inputs.slice(0, 3)) git("cat-file", "-e", `HEAD:${file}`);
  }
  verifySource();
  const checker = path.join(repository, inputs[0]);
  const checked = spawn(process.execPath, [checker, repository], { encoding: "utf8", env });
  requireCondition(checked.status === 0, `secret-effect isolation check failed with exit ${checked.status ?? "signal"}`);
  const lines = checked.stdout.split(/\r?\n/).filter(line => line.trim());
  requireCondition(lines.length > 0, "isolation checker emitted no verdict");
  verifySource();
  const verdict = {
    ...JSON.parse(lines.at(-1)),
    opsSha,
    inputs: {
      checkerSha256: `sha256:${sha256File(checker)}`,
      intentSha256: `sha256:${sha256File(path.join(repository, inputs[1]))}`,
      boundarySha256: `sha256:${sha256File(path.join(repository, inputs[2]))}`,
      workflowTreeSha: git("rev-parse", "HEAD:.github/workflows"),
    },
  };
  validateIsolationVerdict(verdict, opsSha);
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

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { captureIsolation(parseArgs(process.argv.slice(2))); }
  catch (error) { process.stderr.write(`capture-isolation: ${error.message}\n`); process.exitCode = 1; }
}
