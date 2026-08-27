import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toPosix } from "./path.mjs";

export const sha256Bytes = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export const sha256File = (filePath) => sha256Bytes(fs.readFileSync(filePath));

const collectFiles = (root, current, rows) => {
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`directory artifact contains symlink: ${toPosix(path.relative(root, absolute))}`);
    if (stat.isDirectory()) {
      collectFiles(root, absolute, rows);
      continue;
    }
    if (!stat.isFile()) throw new Error(`directory artifact contains unsupported entry: ${toPosix(path.relative(root, absolute))}`);
    const bytes = fs.readFileSync(absolute);
    rows.push({
      bytes: bytes.length,
      path: toPosix(path.relative(root, absolute)),
      sha256: sha256Bytes(bytes),
    });
  }
};

export const sha256Tree = (rootPath) => {
  const stat = fs.lstatSync(rootPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("tree digest input must be a real directory");
  const files = [];
  collectFiles(path.resolve(rootPath), path.resolve(rootPath), files);
  const hash = crypto.createHash("sha256");
  for (const row of files) hash.update(`${row.path}\0${row.bytes}\0${row.sha256}\n`, "utf8");
  return { files, sha256: hash.digest("hex") };
};
