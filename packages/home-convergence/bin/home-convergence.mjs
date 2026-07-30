#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { buildConvergenceReceipt } from "../lib/home-convergence.mjs";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

const { values } = parseArgs({
  options: {
    requests: { type: "string" },
    wrapper: { type: "string" },
    results: { type: "string" },
    review: { type: "string" },
    "ops-revision": { type: "string" },
    "envs-revision": { type: "string" },
    "flakes-revision": { type: "string" },
    "target-set-digest": { type: "string" },
  },
  strict: true,
});

const required = [
  "requests",
  "wrapper",
  "results",
  "review",
  "ops-revision",
  "envs-revision",
  "flakes-revision",
  "target-set-digest",
];

for (const key of required) {
  if (!values[key]) {
    console.error(`missing required option --${key}`);
    process.exit(2);
  }
}

try {
  const receipt = buildConvergenceReceipt({
    exactOpsRevision: values["ops-revision"],
    exactEnvsRevision: values["envs-revision"],
    exactFlakesRevision: values["flakes-revision"],
    targetSetDigest: values["target-set-digest"],
    requests: readJson(values.requests),
    wrapperReceipt: readJson(values.wrapper),
    targetResults: readJson(values.results),
    independentReview: readJson(values.review),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code ?? "invalid-input",
    message: error.message,
    detail: error.detail ?? {},
  })}\n`);
  process.exit(1);
}
