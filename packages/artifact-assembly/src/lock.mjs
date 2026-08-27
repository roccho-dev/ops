import fs from "node:fs";
import { parseCanonicalJsonl } from "./canonical-json.mjs";
import { assertSafeRelativePath } from "./path.mjs";

const allowedKinds = new Set(["directory", "file", "npm-tgz"]);
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]*$/;
const statusValues = new Set(["locked", "pending-bytes", "pending-digest"]);
const commonKeys = new Set(["id", "kind", "name", "note", "owner", "required", "revision", "sha256", "status", "target", "version"]);
const npmKeys = new Set([...commonKeys, "export", "shim"]);

const assertOptionalString = (row, key) => {
  if (row[key] !== undefined && row[key] !== null && (typeof row[key] !== "string" || row[key].length === 0)) {
    throw new Error(`lock ${row.id ?? "?"}: ${key} must be null or non-empty string`);
  }
};

export const validateArtifactLock = (rows, { requireComplete = false } = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("artifact lock must contain at least one row");
  const ids = new Set();
  const targets = new Set();
  const shims = new Set();
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("artifact lock row must be an object");
    if (typeof row.id !== "string" || !idPattern.test(row.id)) throw new Error("artifact lock row has invalid id");
    const allowedKeys = row.kind === "npm-tgz" ? npmKeys : commonKeys;
    const unknownKeys = Object.keys(row).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) throw new Error(`lock ${row.id}: unknown field ${unknownKeys.sort().join(",")}`);
    if (ids.has(row.id)) throw new Error(`duplicate artifact lock id: ${row.id}`);
    ids.add(row.id);
    if (!allowedKinds.has(row.kind)) throw new Error(`lock ${row.id}: unsupported kind`);
    if (typeof row.name !== "string" || row.name.length === 0) throw new Error(`lock ${row.id}: name is required`);
    if (typeof row.version !== "string" || row.version.length === 0) throw new Error(`lock ${row.id}: version is required`);
    if (typeof row.owner !== "string" || row.owner.length === 0) throw new Error(`lock ${row.id}: owner is required`);
    if (typeof row.required !== "boolean") throw new Error(`lock ${row.id}: required must be boolean`);
    if (!statusValues.has(row.status)) throw new Error(`lock ${row.id}: invalid status`);
    assertOptionalString(row, "note");
    assertOptionalString(row, "revision");
    assertOptionalString(row, "sha256");
    if (row.sha256 !== null && row.sha256 !== undefined && !digestPattern.test(row.sha256)) {
      throw new Error(`lock ${row.id}: sha256 must be lowercase 64 hex`);
    }
    assertSafeRelativePath(row.target, `lock ${row.id} target`, { allowDot: true });
    if (targets.has(row.target)) throw new Error(`duplicate artifact target: ${row.target}`);
    targets.add(row.target);
    if (row.kind === "npm-tgz") {
      if (typeof row.export !== "string" || row.export.length === 0) throw new Error(`lock ${row.id}: export is required`);
      assertSafeRelativePath(row.shim, `lock ${row.id} shim`);
      if (shims.has(row.shim)) throw new Error(`duplicate artifact shim: ${row.shim}`);
      shims.add(row.shim);
    } else if (row.export !== undefined || row.shim !== undefined) {
      throw new Error(`lock ${row.id}: export/shim only valid for npm-tgz`);
    }
    if (requireComplete && row.required) {
      if (row.status !== "locked") throw new Error(`lock ${row.id}: required artifact is not locked`);
      if (!digestPattern.test(row.sha256 ?? "")) throw new Error(`lock ${row.id}: required artifact digest is incomplete`);
    }
  }
  return rows;
};

export const parseArtifactLock = (text, options = {}) => validateArtifactLock(parseCanonicalJsonl(text, "artifact lock"), options);

export const readArtifactLock = (lockPath, options = {}) => parseArtifactLock(fs.readFileSync(lockPath, "utf8"), options);
