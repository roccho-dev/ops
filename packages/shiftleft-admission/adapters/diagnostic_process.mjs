#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const encoder = new TextEncoder();
const [sourcePath] = process.argv.slice(2);

if (!sourcePath) {
  process.stderr.write("usage: diagnostic_process.mjs <program>\n");
  process.exit(2);
}

const adapterDir = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(adapterDir, "../../structured-diagnostic/contract.json");
const contractBytes = readFileSync(contractPath);
const contract = JSON.parse(contractBytes.toString("utf8"));
const contractSha256 = `sha256:${createHash("sha256").update(contractBytes).digest("hex")}`;

function report(status, findingCode, evidence) {
  process.stdout.write(`${JSON.stringify({
    schema: "shiftleft-diagnostic-process-report/1",
    status,
    findingCode,
    contractSha256,
    evidence,
  })}\n`);
}

function scalar(value) {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function validateDiagnostic(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { code: "diagnostic-schema-invalid", detail: "diagnostic must be an object" };
  }

  const allowed = new Set(contract.allowedTopLevel);
  const hostOwned = new Set(contract.hostOwnedTopLevel);
  for (const key of Object.keys(value)) {
    if (hostOwned.has(key)) {
      return { code: "diagnostic-host-field-forged", detail: `${key} is host-owned` };
    }
    if (!allowed.has(key)) {
      return { code: "diagnostic-schema-invalid", detail: `unknown top-level field: ${key}` };
    }
  }
  for (const key of contract.requiredTopLevel) {
    if (!Object.hasOwn(value, key)) {
      return { code: "diagnostic-schema-invalid", detail: `missing required field: ${key}` };
    }
  }
  if (value.schema !== contract.diagnosticSchema) {
    return { code: "diagnostic-schema-invalid", detail: `schema must be ${contract.diagnosticSchema}` };
  }
  if (typeof value.code !== "string" || !new RegExp(contract.patterns.code, "u").test(value.code) || byteLength(value.code) > contract.limits.codeBytes) {
    return { code: "diagnostic-schema-invalid", detail: "code is invalid" };
  }
  if (!contract.levels.includes(value.level)) {
    return { code: "diagnostic-schema-invalid", detail: "level is invalid" };
  }
  if (typeof value.message !== "string" || value.message.trim() === "" || byteLength(value.message) > contract.limits.messageBytes) {
    return { code: "diagnostic-schema-invalid", detail: "message is invalid" };
  }
  if (Object.hasOwn(value, "fields")) {
    if (value.fields === null || typeof value.fields !== "object" || Array.isArray(value.fields)) {
      return { code: "diagnostic-schema-invalid", detail: "fields must be an object" };
    }
    const keys = Object.keys(value.fields);
    if (keys.length > contract.limits.fields) {
      return { code: "diagnostic-schema-invalid", detail: "fields has too many entries" };
    }
    const fieldPattern = new RegExp(contract.patterns.field, "u");
    for (const key of keys) {
      const fieldValue = value.fields[key];
      if (!fieldPattern.test(key) || byteLength(key) > contract.limits.fieldNameBytes || !scalar(fieldValue)) {
        return { code: "diagnostic-schema-invalid", detail: `fields.${key} is invalid` };
      }
      if (typeof fieldValue === "string" && byteLength(fieldValue) > contract.limits.fieldStringBytes) {
        return { code: "diagnostic-schema-invalid", detail: `fields.${key} is too large` };
      }
    }
  }
  if (byteLength(`${JSON.stringify(value)}\n`) > contract.limits.encodedBytes) {
    return { code: "diagnostic-schema-invalid", detail: "encoded diagnostic is too large" };
  }
  return null;
}

function lines(text) {
  if (text === "") {
    return [];
  }
  const rows = text.split("\n");
  if (rows.at(-1) === "") {
    rows.pop();
  }
  return rows;
}

const child = spawnSync(process.execPath, [path.resolve(sourcePath)], {
  cwd: path.dirname(path.resolve(sourcePath)),
  encoding: "utf8",
  timeout: 2000,
  maxBuffer: 128 * 1024,
  env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
});

if (child.error) {
  report("unobserved", child.error.code === "ETIMEDOUT" ? "process-timeout" : "process-provider-unobserved", [
    { kind: "process", detail: child.error.code ?? child.error.message },
  ]);
  process.exit(0);
}
if (child.status !== 0) {
  report("unmet", "process-failed", [{ kind: "process", detail: `exit ${child.status}` }]);
  process.exit(0);
}

for (const [index, line] of lines(child.stdout).entries()) {
  if (line.trim() === "") {
    continue;
  }
  try {
    const value = JSON.parse(line);
    if (value !== null && typeof value === "object" && !Array.isArray(value) && value.schema === contract.diagnosticSchema) {
      report("unmet", "primary-output-polluted", [
        { kind: "stdout", path: "stdout", line: index + 1, detail: "diagnostic/1 row found in primary output" },
      ]);
      process.exit(0);
    }
  } catch {
    // Primary output is package-specific and need not be JSON.
  }
}

let diagnosticRows = 0;
for (const [index, line] of lines(child.stderr).entries()) {
  if (line.trim() === "") {
    report("unmet", "diagnostic-free-text", [
      { kind: "stderr", path: "stderr", line: index + 1, detail: "blank diagnostic line" },
    ]);
    process.exit(0);
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    report("unmet", "diagnostic-free-text", [
      { kind: "stderr", path: "stderr", line: index + 1, detail: "stderr line is not JSON" },
    ]);
    process.exit(0);
  }
  const invalid = validateDiagnostic(value);
  if (invalid) {
    report("unmet", invalid.code, [
      { kind: "stderr", path: "stderr", line: index + 1, detail: invalid.detail },
    ]);
    process.exit(0);
  }
  diagnosticRows += 1;
}

report("met", "stdio-contract-clean", [
  { kind: "stdout", path: "stdout", detail: "primary output contains no diagnostic/1 rows" },
  { kind: "stderr", path: "stderr", detail: `${diagnosticRows} diagnostic/1 row(s) validated against ${contractSha256}` },
]);
