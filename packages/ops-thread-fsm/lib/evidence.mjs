// Evidence-file helpers for ops-thread-fsm.
//
// This module only inspects files and metadata. It does not materialize artifacts,
// run local gates, call CDP, push, merge, or operate external threads.
//
// Node ESM port of evidence.py (stdlib only, behavior-identical).

import fs from "node:fs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadValue(path) {
  if (!path) {
    return "";
  }
  const raw = fs.readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Read a file, replacing undecodable bytes (errors="replace"). utf-8 decoding in
// Node with a Buffer.toString("utf8") already substitutes U+FFFD for bad bytes.
function readTextReplace(path) {
  return fs.readFileSync(path).toString("utf8");
}

export function readableFile(path) {
  if (!path) {
    return false;
  }
  if (!fs.existsSync(path)) {
    return false;
  }
  return Boolean(readTextReplace(path).trim());
}

// Python int(value): accepts ints, floats (truncates toward zero), and numeric
// strings (base-10, surrounding whitespace allowed). Anything else raises and the
// caller treats it as None.
function asInt(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    // Python int(True)==1, int(False)==0
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!/^[+-]?[0-9]+$/.test(s)) {
      return null;
    }
    return parseInt(s, 10);
  }
  return null;
}

function hex64(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value || "");
}

// Validate materializer manifest metadata without materializing anything.
export function deliveryManifestOk(path) {
  if (!path || !fs.existsSync(path)) {
    return false;
  }
  const manifest = loadValue(path);
  if (!isPlainObject(manifest) || manifest.ok !== true) {
    return false;
  }
  const count = asInt(manifest.count);
  const rows = manifest.rows;
  if (count === null || count <= 0 || !Array.isArray(rows) || rows.length !== count) {
    return false;
  }
  const indexes = [];
  for (const row of rows) {
    if (!isPlainObject(row) || row.ok !== true) {
      return false;
    }
    if (typeof row.path !== "string" || !row.path.trim()) {
      return false;
    }
    const byteCount = asInt(row.bytes);
    const expectedSource = Object.prototype.hasOwnProperty.call(row, "bytesExpected")
      ? row.bytesExpected
      : row.sizeExpected;
    const expectedBytes = asInt(expectedSource);
    if (
      byteCount === null ||
      expectedBytes === null ||
      byteCount <= 0 ||
      byteCount !== expectedBytes
    ) {
      return false;
    }
    const sha = String(row.sha256 === undefined ? "" : pyStr(row.sha256)).toLowerCase();
    const expectedSha = String(row.sha256Expected === undefined ? "" : pyStr(row.sha256Expected)).toLowerCase();
    if (!(hex64(sha) && hex64(expectedSha) && sha === expectedSha)) {
      return false;
    }
    const fileIndex = asInt(row.fileIndex);
    const fileCount = asInt(row.fileCount);
    if (fileIndex === null || fileCount !== count) {
      return false;
    }
    indexes.push(fileIndex);
  }
  const sortedIdx = [...indexes].sort((a, b) => a - b);
  const expected = [];
  for (let i = 1; i <= count; i += 1) {
    expected.push(i);
  }
  return sortedIdx.length === expected.length && sortedIdx.every((v, i) => v === expected[i]);
}

// Python str() rendering used by `str(row.get("sha256", ""))` etc.
function pyStr(value) {
  if (typeof value === "string") return value;
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  return String(value);
}
