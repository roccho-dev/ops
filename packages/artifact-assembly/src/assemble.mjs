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

const removeIfPresent = (target) => {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
};

const promoteAtomically = (stagingRoot, outputRoot, failAt) => {
  const parent = path.dirname(outputRoot);
  const backup = path.join(parent, `.${path.basename(outputRoot)}.previous-${process.pid}-${Date.now()}`);
  let movedOld = false;
  try {
    if (failAt === "before-promote") throw new Error("injected failure before promote");
    if (fs.existsSync(outputRoot)) {
      fs.renameSync(outputRoot, backup);
      movedOld = true;
    }
    if (failAt === "after-backup") throw new Error("injected failure after backup");
    fs.renameSync(stagingRoot, outputRoot);
    if (movedOld) removeIfPresent(backup);
  } catch (error) {
    if (movedOld && !fs.existsSync(outputRoot) && fs.existsSync(backup)) fs.renameSync(backup, outputRoot);
    throw error;
  } finally {
    removeIfPresent(backup);
  }
};

export const assembleArtifact = ({ failAt = null, lockPath, outputDir, requireComplete = true, sources = {} }) => {
  if (!lockPath || !outputDir) throw new Error("lockPath and outputDir are required");
  const rows = readArtifactLock(lockPath, { requireComplete });
  const outputRoot = path.resolve(outputDir);
  const parent = path.dirname(outputRoot);
  fs.mkdirSync(parent, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(parent, `.${path.basename(outputRoot)}.stage-`));
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-assembly-"));
  const occupied = new Set();
  const inputs = [];
  try {
    for (const row of rows) {
      if (!row.required && !sources[row.id]) continue;
      const source = sourceFor(sources, row);
      if (!fs.existsSync(source)) throw new Error(`lock ${row.id}: source does not exist`);
      if (row.kind === "directory") inputs.push(processDirectory(row, source, stagingRoot, occupied));
      else if (row.kind === "file") inputs.push(processFile(row, source, stagingRoot, occupied));
      else inputs.push(processNpmTgz(row, source, stagingRoot, occupied, scratchRoot));
    }
    const output = sha256Tree(stagingRoot);
    const receipt = {
      authority: false,
      files: output.files,
      inputs,
      locks: rows,
      outputTreeSha256: output.sha256,
      schema: "roccho.artifact.assembly-receipt/2",
      status: "PASS",
    };
    promoteAtomically(stagingRoot, outputRoot, failAt);
    return receipt;
  } finally {
    removeIfPresent(stagingRoot);
    removeIfPresent(scratchRoot);
  }
};

export const writeAssemblyReceipt = (receiptPath, receipt) => {
  assertSafeRelativePath(path.basename(receiptPath), "receipt filename");
  fs.mkdirSync(path.dirname(path.resolve(receiptPath)), { recursive: true });
  fs.writeFileSync(receiptPath, canonicalJsonText(receipt));
};
