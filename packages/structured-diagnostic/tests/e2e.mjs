import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DiagnosticContractError,
  canonicalizeDiagnosticJsonl,
  diagnosticContract,
  encodeDiagnostic,
  validateDiagnostic,
  writeDiagnostic,
} from "../adapters/node.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(packageRoot, "bin", "structured-diagnostic.mjs");

function expectContractError(fn, expectedCode) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof DiagnosticContractError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

const good = {
  schema: "diagnostic/1",
  code: "example.ready",
  level: "info",
  message: "ready",
  fields: {
    z: 1,
    a: true,
    n: null,
  },
};

const expectedGood =
  '{"schema":"diagnostic/1","code":"example.ready","level":"info","message":"ready","fields":{"a":true,"n":null,"z":1}}\n';

assert.equal(encodeDiagnostic(good), expectedGood);
assert.equal(encodeDiagnostic(good), encodeDiagnostic(good));
assert.deepEqual(Object.keys(validateDiagnostic(good)), ["schema", "code", "level", "message", "fields"]);
assert.deepEqual(Object.keys(validateDiagnostic(good).fields), ["a", "n", "z"]);

const falsePositive = {
  schema: "diagnostic/1",
  code: "example.words",
  level: "debug",
  message: "event_id timestamp status are ordinary words here",
  fields: { note: "run_id is also ordinary text" },
};
assert.equal(validateDiagnostic(falsePositive).code, "example.words");

expectContractError(
  () => validateDiagnostic({ ...good, timestamp: "2026-08-18T00:00:00Z" }),
  "DIAGNOSTIC_HOST_FIELD_FORGED",
);
expectContractError(() => validateDiagnostic({ ...good, extra: true }), "DIAGNOSTIC_UNKNOWN_FIELD");
expectContractError(() => validateDiagnostic({ ...good, level: "fatal" }), "DIAGNOSTIC_LEVEL_INVALID");
expectContractError(() => validateDiagnostic({ ...good, fields: { nested: { value: 1 } } }), "DIAGNOSTIC_FIELD_VALUE_INVALID");
expectContractError(() => validateDiagnostic({ ...good, fields: { nested: [1] } }), "DIAGNOSTIC_FIELD_VALUE_INVALID");
expectContractError(
  () => validateDiagnostic({ ...good, message: "\ud800" }),
  "DIAGNOSTIC_MESSAGE_INVALID_UNICODE",
);
expectContractError(
  () => validateDiagnostic({ ...good, fields: { broken: "\udc00" } }),
  "DIAGNOSTIC_FIELD_STRING_INVALID_UNICODE",
);
const accessorDiagnostic = { ...good };
Object.defineProperty(accessorDiagnostic, "hidden", { value: true, enumerable: false });
expectContractError(() => validateDiagnostic(accessorDiagnostic), "DIAGNOSTIC_NON_JSON_PROPERTY");
const symbolDiagnostic = { ...good, [Symbol("hidden")]: true };
expectContractError(() => validateDiagnostic(symbolDiagnostic), "DIAGNOSTIC_NON_JSON_PROPERTY");
expectContractError(
  () => validateDiagnostic({ ...good, message: "x".repeat(diagnosticContract.limits.messageBytes + 1) }),
  "DIAGNOSTIC_MESSAGE_TOO_LARGE",
);

const oversizedFields = {};
for (let index = 0; index < 9; index += 1) {
  oversizedFields[`part_${index}`] = "x".repeat(diagnosticContract.limits.fieldStringBytes);
}
expectContractError(
  () => validateDiagnostic({ ...good, fields: oversizedFields }),
  "DIAGNOSTIC_ENCODED_TOO_LARGE",
);

const writes = [];
const writeResult = writeDiagnostic(good, {
  write(text) {
    writes.push(text);
    return true;
  },
});
assert.equal(writeResult, true);
assert.deepEqual(writes, [expectedGood]);

const encodedObject = JSON.parse(expectedGood);
for (const hostField of diagnosticContract.hostOwnedTopLevel) {
  assert.equal(Object.hasOwn(encodedObject, hostField), false);
}

const canonicalPair = `${JSON.stringify(good)}\n${JSON.stringify(falsePositive)}\n`;
assert.equal(
  canonicalizeDiagnosticJsonl(canonicalPair),
  `${expectedGood}${encodeDiagnostic(falsePositive)}`,
);

expectContractError(
  () => canonicalizeDiagnosticJsonl(`${JSON.stringify(good)}\n\n`),
  "DIAGNOSTIC_JSONL_EMPTY_LINE",
);
expectContractError(
  () => canonicalizeDiagnosticJsonl(
    '{"schema":"diagnostic/1","code":"example.duplicate","level":"info","level":"error","message":"x"}\n',
  ),
  "DIAGNOSTIC_DUPLICATE_KEY",
);
expectContractError(
  () => canonicalizeDiagnosticJsonl(
    '{"schema":"diagnostic/1","code":"example.duplicate","level":"info","message":"x","fields":{"a":1,"\u0061":2}}\n',
  ),
  "DIAGNOSTIC_DUPLICATE_KEY",
);

const temporary = mkdtempSync(path.join(tmpdir(), "structured-diagnostic-"));
try {
  const goodPath = path.join(temporary, "good.jsonl");
  writeFileSync(goodPath, canonicalPair);
  const goodRun = spawnSync(process.execPath, [bin, "check", goodPath], { encoding: "utf8" });
  assert.equal(goodRun.status, 0, goodRun.stderr);
  assert.equal(goodRun.stderr, "");
  assert.equal(goodRun.stdout, `${expectedGood}${encodeDiagnostic(falsePositive)}`);

  const falseNegativePath = path.join(temporary, "false-negative.jsonl");
  writeFileSync(
    falseNegativePath,
    `${JSON.stringify(good)}\n${JSON.stringify({ ...good, timestamp: "forged" })}\n`,
  );
  const badRun = spawnSync(process.execPath, [bin, "check", falseNegativePath], { encoding: "utf8" });
  assert.equal(badRun.status, 1);
  assert.equal(badRun.stdout, "");
  assert.match(badRun.stderr, /DIAGNOSTIC_HOST_FIELD_FORGED/);
  assert.match(badRun.stderr, /line 2:timestamp/);

  const stdinRun = spawnSync(process.execPath, [bin, "check"], {
    input: `${JSON.stringify(good)}\n`,
    encoding: "utf8",
  });
  assert.equal(stdinRun.status, 0, stdinRun.stderr);
  assert.equal(stdinRun.stdout, expectedGood);

  const usageRun = spawnSync(process.execPath, [bin], { encoding: "utf8" });
  assert.equal(usageRun.status, 2);
  assert.equal(usageRun.stdout, "");
  assert.equal(usageRun.stderr, "usage: structured-diagnostic check [file|-]\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const coreSource = readFileSync(path.join(packageRoot, "lib", "diagnostic.mjs"), "utf8");
for (const forbidden of ["node:", "process.", "console.", "Date(", "Date.now", "Math.random", "fetch("]) {
  assert.equal(coreSource.includes(forbidden), false, `pure core contains forbidden token: ${forbidden}`);
}

const adapterSource = readFileSync(path.join(packageRoot, "adapters", "node.mjs"), "utf8");
assert.equal(adapterSource.includes("console."), false, "adapter must not use console.*");
assert.equal(adapterSource.includes("#116"), false, "runtime adapter must not depend on #116");

process.stdout.write("structured-diagnostic e2e: PASS\n");
