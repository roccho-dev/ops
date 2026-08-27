import fs from "node:fs";
import path from "node:path";
import { assertSafeRelativePath, resolveInside } from "./path.mjs";

const chooseExportTarget = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of ["import", "browser", "default", "node"]) {
      const selected = chooseExportTarget(value[key]);
      if (selected) return selected;
    }
  }
  return null;
};

const normalizeExportTarget = (target) => {
  if (typeof target !== "string" || !target.startsWith("./")) throw new Error("package export must be a relative ./ path");
  const relative = target.slice(2);
  assertSafeRelativePath(relative, "package export target");
  return relative;
};

export const inspectPackageExport = (packageRoot, row) => {
  const manifestPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`lock ${row.id}: package.json is missing`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== row.name) throw new Error(`lock ${row.id}: package name mismatch`);
  if (manifest.version !== row.version) throw new Error(`lock ${row.id}: package version mismatch`);
  let rawTarget = null;
  if (manifest.exports !== undefined) {
    if (typeof manifest.exports === "string" || Array.isArray(manifest.exports)) {
      if (row.export === ".") rawTarget = chooseExportTarget(manifest.exports);
    } else if (manifest.exports && typeof manifest.exports === "object") {
      const direct = manifest.exports[row.export];
      rawTarget = chooseExportTarget(direct ?? (row.export === "." ? manifest.exports : null));
    }
  }
  if (!rawTarget && row.export === ".") rawTarget = manifest.module ?? manifest.main ?? null;
  if (!rawTarget) throw new Error(`lock ${row.id}: package export ${row.export} is missing`);
  const relative = normalizeExportTarget(rawTarget);
  const absolute = resolveInside(packageRoot, relative, "package export target");
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`lock ${row.id}: package export is not a regular file`);
  if (!/\.(mjs|js)$/.test(relative)) throw new Error(`lock ${row.id}: package export is not JavaScript ESM`);
  if (relative.endsWith(".js") && manifest.type !== "module") throw new Error(`lock ${row.id}: .js export requires type=module`);
  return { manifest, relative };
};
