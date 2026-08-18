import { readFileSync } from "node:fs";

import {
  DiagnosticContractError,
  canonicalizeDiagnosticJsonl as canonicalizeDiagnosticJsonlCore,
  encodeDiagnostic as encodeDiagnosticCore,
  parseDiagnosticLine as parseDiagnosticLineCore,
  validateDiagnostic as validateDiagnosticCore,
} from "../lib/diagnostic.mjs";

export { DiagnosticContractError };

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export const diagnosticContract = deepFreeze(
  JSON.parse(readFileSync(new URL("../contract.json", import.meta.url), "utf8")),
);

export function validateDiagnostic(value) {
  return validateDiagnosticCore(value, diagnosticContract);
}

export function encodeDiagnostic(value) {
  return encodeDiagnosticCore(value, diagnosticContract);
}

export function parseDiagnosticLine(line) {
  return parseDiagnosticLineCore(line, diagnosticContract);
}

export function canonicalizeDiagnosticJsonl(text) {
  return canonicalizeDiagnosticJsonlCore(text, diagnosticContract);
}

export function writeDiagnostic(value, stream = process.stderr) {
  if (stream === null || typeof stream !== "object" || typeof stream.write !== "function") {
    throw new DiagnosticContractError(
      "DIAGNOSTIC_STREAM_INVALID",
      "stream",
      "stream must expose a write(text) function",
    );
  }
  return stream.write(encodeDiagnostic(value));
}
