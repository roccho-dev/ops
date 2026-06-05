// Command-line interface for ops-thread-fsm.
//
// Node ESM port of cli.py (stdlib only, behavior-identical). Reproduces the
// argparse subcommand surface used by the CLI and the flake check.

import process from "node:process";

import * as core from "./core.mjs";
import * as readiness from "./readiness.mjs";

const PROG = "ops-thread-fsm";

// Subcommand specs. Each option: { name, dest, store_true, required, default, choices }.
// `--json` is the common flag (store_true).
const COMMON_JSON = { name: "--json", dest: "json", store_true: true, default: false };

const COMMANDS = {
  status: {
    handler: core.cmdStatus,
    options: [
      { name: "--events", dest: "events", default: null },
      { name: "--state", dest: "state", default: null },
      COMMON_JSON,
    ],
  },
  next: {
    handler: core.cmdNext,
    options: [
      { name: "--state-kind", dest: "state_kind", required: true, default: null },
      { name: "--phase", dest: "phase", default: "impl" },
      { name: "--request-kind", dest: "request_kind", default: "work" },
      { name: "--classification", dest: "classification", default: null },
      { name: "--dry-run", dest: "dry_run", store_true: true, default: false },
      COMMON_JSON,
    ],
  },
  "classify-readback": {
    handler: core.cmdClassifyReadback,
    options: [
      { name: "--input", dest: "input", required: true, default: null },
      { name: "--phase", dest: "phase", required: true, default: null },
      { name: "--request-kind", dest: "request_kind", required: true, default: null },
      COMMON_JSON,
    ],
  },
  "evaluate-plan": {
    handler: core.cmdEvaluatePlan,
    options: [
      { name: "--input", dest: "input", required: true, default: null },
      COMMON_JSON,
    ],
  },
  "check-discussion": {
    handler: core.cmdCheckDiscussion,
    options: [
      { name: "--input", dest: "input", required: true, default: null },
      COMMON_JSON,
    ],
  },
  "facilitate-discussion": {
    handler: core.cmdFacilitateDiscussion,
    options: [
      { name: "--input", dest: "input", required: true, default: null },
      COMMON_JSON,
    ],
  },
  "render-prompt": {
    handler: core.cmdRenderPrompt,
    options: [
      { name: "--phase", dest: "phase", required: true, default: null },
      { name: "--request-kind", dest: "request_kind", required: true, default: null },
      { name: "--dry-run", dest: "dry_run", store_true: true, default: false },
      COMMON_JSON,
    ],
  },
  "check-ready": {
    handler: readiness.cmdCheckReady,
    options: [
      { name: "--delivery", dest: "delivery", default: null },
      { name: "--materialize-manifest", dest: "materialize_manifest", default: null },
      { name: "--impl-review", dest: "impl_review", default: null },
      { name: "--review", dest: "review", default: null },
      { name: "--local-gate", dest: "local_gate", default: null },
      { name: "--merge-review", dest: "merge_review", default: null },
      { name: "--run-report", dest: "run_report", default: null },
      {
        name: "--target",
        dest: "target",
        default: "ready-for-merge-review",
        choices: ["ready-for-merge-review", "merge-ready"],
      },
      { name: "--dry-run", dest: "dry_run", store_true: true, default: false },
      COMMON_JSON,
    ],
  },
  "classify-localize": {
    handler: readiness.cmdClassifyLocalize,
    options: [
      { name: "--input", dest: "input", required: true, default: null },
      COMMON_JSON,
    ],
  },
};

class ArgparseExit extends Error {
  constructor(code) {
    super(`argparse exit ${code}`);
    this.code = code;
  }
}

function fail(usage, message) {
  process.stderr.write(usage + "\n");
  process.stderr.write(`${PROG}: error: ${message}\n`);
  throw new ArgparseExit(2);
}

function parseArgs(argv) {
  const topUsage = `usage: ${PROG} [-h] {${Object.keys(COMMANDS).join(",")}} ...`;
  if (argv.length === 0) {
    fail(topUsage, "the following arguments are required: command");
  }
  const command = argv[0];
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    fail(topUsage, `argument command: invalid choice: '${command}' (choose from ${Object.keys(COMMANDS).map((c) => `'${c}'`).join(", ")})`);
  }
  const spec = COMMANDS[command];
  const subUsage = `usage: ${PROG} ${command} [-h] ...`;
  const byName = {};
  for (const opt of spec.options) {
    byName[opt.name] = opt;
  }
  const args = { command, handler: spec.handler };
  for (const opt of spec.options) {
    args[opt.dest] = opt.default;
  }
  const rest = argv.slice(1);
  let i = 0;
  while (i < rest.length) {
    let token = rest[i];
    let inlineValue = null;
    const eq = token.indexOf("=");
    if (token.startsWith("--") && eq !== -1) {
      inlineValue = token.slice(eq + 1);
      token = token.slice(0, eq);
    }
    const opt = byName[token];
    if (!opt) {
      fail(subUsage, `unrecognized arguments: ${rest[i]}`);
    }
    if (opt.store_true) {
      if (inlineValue !== null) {
        fail(subUsage, `argument ${opt.name}: ignored explicit argument '${inlineValue}'`);
      }
      args[opt.dest] = true;
      i += 1;
      continue;
    }
    let value;
    if (inlineValue !== null) {
      value = inlineValue;
      i += 1;
    } else {
      if (i + 1 >= rest.length) {
        fail(subUsage, `argument ${opt.name}: expected one argument`);
      }
      value = rest[i + 1];
      i += 2;
    }
    if (opt.choices && !opt.choices.includes(value)) {
      fail(
        subUsage,
        `argument ${opt.name}: invalid choice: '${value}' (choose from ${opt.choices.map((c) => `'${c}'`).join(", ")})`,
      );
    }
    args[opt.dest] = value;
  }
  const missingRequired = spec.options
    .filter((opt) => opt.required && (args[opt.dest] === null || args[opt.dest] === undefined))
    .map((opt) => opt.name);
  if (missingRequired.length) {
    fail(subUsage, `the following arguments are required: ${missingRequired.join(", ")}`);
  }
  return args;
}

export function main(argv = null) {
  const list = argv === null ? process.argv.slice(2) : argv;
  let args;
  try {
    args = parseArgs(list);
  } catch (err) {
    if (err instanceof ArgparseExit) {
      return err.code;
    }
    throw err;
  }
  const result = args.handler(args);
  return Number(result || 0);
}
