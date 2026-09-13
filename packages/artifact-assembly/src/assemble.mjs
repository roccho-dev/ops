import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJsonText } from "./canonical-json.mjs";
import { sha256File, sha256Tree } from "./digest.mjs";
import { readArtifactLock } from "./lock.mjs";
import { inspectPackageExport } from "./package-export.mjs";
import { assertSafeRelativePath, resolveInside, toPosix } from "./path.mjs";
import { extractNpmTgz } from "./tar.mjs";

const copyDirectory = (source, destination, occupied) => {
  const entries = fs.readdirSync(source, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) throw new Error(`directory artifact contains symlink: ${sourcePath}`);
    if (stat.isDirectory()) {
      copyDirectory(sourcePath, destinationPath, occupied);
      continue;
    }
    if (!stat.isFile()) throw new Error(`directory artifact contains unsupported entry: ${sourcePath}`);
    const key = path.resolve(destinationPath);
    if (occupied.has(key) || fs.existsSync(destinationPath)) throw new Error(`artifact output collision: ${destinationPath}`);
    occupied.add(key);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  }
};

const writeOutputFile = (destination, bytes, occupied) => {
  const key = path.resolve(destination);
  if (occupied.has(key) || fs.existsSync(destination)) throw new Error(`artifact output collision: ${destination}`);
  occupied.add(key);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: "wx" });
};

const relativeImport = (fromFile, targetFile) => {
  let relative = toPosix(path.relative(path.dirname(fromFile), targetFile));
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
};

const sourceFor = (sources, row) => {
  const source = sources[row.id];
  if (typeof source !== "string" || source.length === 0) throw new Error(`lock ${row.id}: source path is missing`);
  return path.resolve(source);
};

const processDirectory = (row, source, stagingRoot, occupied) => {
  const digest = sha256Tree(source);
  if (digest.sha256 !== row.sha256) throw new Error(`lock ${row.id}: directory digest mismatch`);
  const destination = row.target === "." ? stagingRoot : resolveInside(stagingRoot, row.target, `lock ${row.id} target`);
  copyDirectory(source, destination, occupied);
  return { id: row.id, kind: row.kind, revision: row.revision ?? null, sha256: digest.sha256 };
};

const processFile = (row, source, stagingRoot, occupied) => {
  const digest = sha256File(source);
  if (digest !== row.sha256) throw new Error(`lock ${row.id}: file digest mismatch`);
  const destination = resolveInside(stagingRoot, row.target, `lock ${row.id} target`);
  writeOutputFile(destination, fs.readFileSync(source), occupied);
  return { id: row.id, kind: row.kind, revision: row.revision ?? null, sha256: digest };
};

const processNpmTgz = (row, source, stagingRoot, occupied, scratchRoot) => {
  const digest = sha256File(source);
  if (digest !== row.sha256) throw new Error(`lock ${row.id}: npm tgz digest mismatch`);
  const packageRoot = path.join(scratchRoot, row.id);
  extractNpmTgz(source, packageRoot);
  const inspected = inspectPackageExport(packageRoot, row);
  const destination = resolveInside(stagingRoot, row.target, `lock ${row.id} target`);
  copyDirectory(packageRoot, destination, occupied);
  const exportedFile = resolveInside(destination, inspected.relative, `lock ${row.id} exported file`);
  const shimPath = resolveInside(stagingRoot, row.shim, `lock ${row.id} shim`);
  const specifier = relativeImport(shimPath, exportedFile);
  writeOutputFile(shimPath, Buffer.from(`export * from ${JSON.stringify(specifier)};\n`, "utf8"), occupied);
  return { export: row.export, id: row.id, kind: row.kind, revision: row.revision ?? null, sha256: digest, shim: row.shim };
};

const assertFreshOutput = (outputRoot) => {
  // lstat also catches dangling symlinks, unlike existsSync.
  if (fs.lstatSync(outputRoot, { throwIfNoEntry: false })) {
    throw new Error(`artifact output path must not exist: ${outputRoot}`);
  }
};

// Resolve a not-yet-created workspace through its existing ancestors without writing.
const physicalPath = (target) => {
  let current = path.resolve(target);
  const missing = [];
  while (!fs.lstatSync(current, { throwIfNoEntry: false })) {
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.resolve(fs.realpathSync(current), ...missing);
};

const publishFresh = (stagingRoot, outputRoot, expectedDigest, failAt) => {
  if (failAt === "before-promote") throw new Error("injected failure before promote");
  // Exclusive mkdir, not check-then-rename: a late empty directory must also win.
  fs.mkdirSync(outputRoot);
  copyDirectory(stagingRoot, outputRoot, new Set());
  if (sha256Tree(outputRoot).sha256 !== expectedDigest) throw new Error("published artifact digest mismatch");
};

export const assembleArtifact = ({ failAt = null, lockPath, outputDir, requireComplete = true, sources = {} }) => {
  if (!lockPath || !outputDir) throw new Error("lockPath and outputDir are required");
  if (failAt !== null && failAt !== "before-promote") throw new Error(`unsupported failAt: ${failAt}`);
  const rows = readArtifactLock(lockPath, { requireComplete });
  const outputRoot = path.resolve(outputDir);
  assertFreshOutput(outputRoot);
  const parent = path.dirname(outputRoot);
  const workspaceParents = [physicalPath(parent), physicalPath(os.tmpdir())];
  const bindings = rows.filter((row) => row.required || sources[row.id]).map((row) => {
    const source = sourceFor(sources, row);
    if (!fs.existsSync(source)) throw new Error(`lock ${row.id}: source does not exist`);
    if (row.kind === "directory") {
      const sourceRoot = fs.realpathSync(source);
      for (const workspaceParent of workspaceParents) {
        const relative = path.relative(sourceRoot, workspaceParent);
        if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) {
          throw new Error(`lock ${row.id}: workspace overlaps directory input`);
        }
      }
    }
    return { row, source };
  });
  fs.mkdirSync(parent, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(parent, `.${path.basename(outputRoot)}.stage-`));
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-assembly-"));
  const occupied = new Set();
  const inputs = [];
  // Retain fresh staging/scratch on success and failure. Never replace or clean another tree.
  for (const { row, source } of bindings) {
    if (row.kind === "directory") inputs.push(processDirectory(row, source, stagingRoot, occupied));
    else if (row.kind === "file") inputs.push(processFile(row, source, stagingRoot, occupied));
    else inputs.push(processNpmTgz(row, source, stagingRoot, occupied, scratchRoot));
  }
  const output = sha256Tree(stagingRoot);
  publishFresh(stagingRoot, outputRoot, output.sha256, failAt);
  return {
    authority: false,
    files: output.files,
    inputs,
    locks: rows,
    outputTreeSha256: output.sha256,
    schema: "roccho.artifact.assembly-receipt/2",
    status: "PASS",
  };
};

export const writeAssemblyReceipt = (receiptPath, receipt) => {
  assertSafeRelativePath(path.basename(receiptPath), "receipt filename");
  fs.mkdirSync(path.dirname(path.resolve(receiptPath)), { recursive: true });
  fs.writeFileSync(receiptPath, canonicalJsonText(receipt), { flag: "wx" });
};
