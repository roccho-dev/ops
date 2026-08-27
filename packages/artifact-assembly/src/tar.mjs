import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assertSafeRelativePath, resolveInside } from "./path.mjs";

const readString = (buffer, start, length) => {
  const slice = buffer.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero < 0 ? slice.length : zero).toString("utf8");
};

const readOctal = (buffer, start, length, label) => {
  const raw = readString(buffer, start, length).trim().replace(/^0+/, "") || "0";
  if (!/^[0-7]+$/.test(raw)) throw new Error(`tar ${label}: invalid octal value`);
  return Number.parseInt(raw, 8);
};

const verifyHeaderChecksum = (header) => {
  const expected = readOctal(header, 148, 8, "checksum");
  let sum = 0;
  for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : header[index];
  if (sum !== expected) throw new Error("tar header checksum mismatch");
};

const parsePax = (data) => {
  const result = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    if (space < 0) throw new Error("tar pax record missing length delimiter");
    const length = Number.parseInt(data.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length) throw new Error("tar pax record has invalid length");
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals <= 0) throw new Error("tar pax record is malformed");
    result[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return result;
};

const normalizePackagePath = (archivePath) => {
  if (typeof archivePath !== "string" || archivePath.length === 0) throw new Error("tar entry path is empty");
  if (archivePath.includes("\\") || archivePath.startsWith("/")) throw new Error(`tar entry has unsafe path: ${archivePath}`);
  const parts = archivePath.replace(/\/$/, "").split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error(`tar entry has unsafe path: ${archivePath}`);
  if (parts[0] !== "package") throw new Error(`npm tgz entry is outside package/: ${archivePath}`);
  if (parts.length === 1) return ".";
  const relative = parts.slice(1).join("/");
  return assertSafeRelativePath(relative, "npm package entry");
};

export const readTarEntries = (archivePath) => {
  const compressed = fs.readFileSync(archivePath);
  const bytes = compressed[0] === 0x1f && compressed[1] === 0x8b ? zlib.gunzipSync(compressed) : compressed;
  const entries = [];
  let offset = 0;
  let nextLongName = null;
  let nextPax = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    verifyHeaderChecksum(header);
    const size = readOctal(header, 124, 12, "size");
    const type = String.fromCharCode(header[156] || 48);
    const baseName = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${baseName}` : baseName;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error("tar entry exceeds archive length");
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "L") {
      nextLongName = data.subarray(0, Math.max(0, data.indexOf(0) < 0 ? data.length : data.indexOf(0))).toString("utf8");
    } else if (type === "x") {
      nextPax = parsePax(data);
      if (nextPax.linkpath) throw new Error("tar pax linkpath is forbidden");
    } else if (type === "g") {
      throw new Error("tar global pax headers are unsupported");
    } else {
      const archiveEntryPath = nextPax?.path ?? nextLongName ?? headerPath;
      nextLongName = null;
      nextPax = null;
      const relativePath = normalizePackagePath(archiveEntryPath);
      if (type !== "0" && type !== "5") throw new Error(`npm tgz contains unsupported link/device entry: ${archiveEntryPath}`);
      entries.push({ data: Buffer.from(data), path: relativePath, type: type === "5" ? "directory" : "file" });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (entries.length === 0) throw new Error("npm tgz contains no package entries");
  return entries;
};

export const extractNpmTgz = (archivePath, outputRoot) => {
  fs.mkdirSync(outputRoot, { recursive: true });
  const seen = new Set();
  for (const entry of readTarEntries(archivePath)) {
    if (entry.path === ".") continue;
    if (seen.has(entry.path)) throw new Error(`npm tgz contains duplicate entry: ${entry.path}`);
    seen.add(entry.path);
    const destination = resolveInside(outputRoot, entry.path, "npm package entry");
    if (entry.type === "directory") {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.data, { flag: "wx" });
  }
  return outputRoot;
};
