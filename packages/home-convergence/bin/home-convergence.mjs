#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { buildSignedConvergenceReceipt } from "../lib/signed-convergence.mjs";
import { auditRuntimeSource } from "../lib/source-audit.mjs";

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const failUsage = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

let [command, ...argv] = process.argv.slice(2);
if (command?.startsWith("--")) {
  argv = [command, ...argv];
  command = "receipt";
}

if (command === "source-audit") {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string" },
      "ops-revision": { type: "string" },
      details: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.root || !values["ops-revision"]) {
    failUsage("usage: home-convergence source-audit --root <package-dir> --ops-revision <sha> [--details]");
  }
  try {
    const audit = auditRuntimeSource({
      root: values.root,
      exactOpsRevision: values["ops-revision"],
    });
    process.stdout.write(`${JSON.stringify(values.details ? audit : audit.summary)}\n`);
    process.exit(audit.summary.status === "pass" ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "source-audit-error", message: error.message })}\n`);
    process.exit(1);
  }
}

if (command !== "receipt") {
  failUsage("usage: home-convergence <source-audit|receipt> ...");
}

const { values } = parseArgs({
  args: argv,
  options: {
    requests: { type: "string" },
    "request-attestation": { type: "string" },
    "package-primitive-attestation": { type: "string" },
    wrapper: { type: "string" },
    results: { type: "string" },
    "source-audit": { type: "string" },
    review: { type: "string" },
    "execution-authority": { type: "string" },
    "execution-authority-digest": { type: "string" },
    "review-authority": { type: "string" },
    "review-authority-digest": { type: "string" },
    "ops-revision": { type: "string" },
    "envs-revision": { type: "string" },
    "flakes-revision": { type: "string" },
    "target-set-digest": { type: "string" },
  },
  strict: true,
});

for (const key of [
  "requests",
  "request-attestation",
  "package-primitive-attestation",
  "wrapper",
  "results",
  "source-audit",
  "review",
  "execution-authority",
  "execution-authority-digest",
  "review-authority",
  "review-authority-digest",
  "ops-revision",
  "envs-revision",
  "flakes-revision",
  "target-set-digest",
]) {
  if (!values[key]) failUsage(`missing required option --${key}`);
}

try {
  const receipt = buildSignedConvergenceReceipt({
    exactOpsRevision: values["ops-revision"],
    exactEnvsRevision: values["envs-revision"],
    exactFlakesRevision: values["flakes-revision"],
    targetSetDigest: values["target-set-digest"],
    requests: readJson(values.requests),
    requestAttestation: readJson(values["request-attestation"]),
    packagePrimitiveAttestation: readJson(values["package-primitive-attestation"]),
    wrapperReceipt: readJson(values.wrapper),
    targetResults: readJson(values.results),
    sourceAudit: readJson(values["source-audit"]),
    independentReview: readJson(values.review),
    executionAuthority: readJson(values["execution-authority"]),
    expectedExecutionAuthorityDigest: values["execution-authority-digest"],
    reviewAuthority: readJson(values["review-authority"]),
    expectedReviewAuthorityDigest: values["review-authority-digest"],
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
