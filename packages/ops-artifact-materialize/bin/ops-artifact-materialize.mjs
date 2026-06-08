#!/usr/bin/env node
// Materialize BEGIN_B64_FILE blocks from ChatGPT thread text.
//
// This is intentionally small: it decodes machine artifacts, verifies bytes and
// sha256, and writes a manifest. Human notes remain outside this contract.
//
// Node ESM port of ops-artifact-materialize.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { parseArgs } from "node:util";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

// Python: re.compile(r"BEGIN_B64_FILE\s+(.*?)\s+END_B64_FILE", re.DOTALL)
const BLOCK_RE = /BEGIN_B64_FILE\s+([\s\S]*?)\s+END_B64_FILE/g;
// Python META_RE (re.DOTALL) with named groups; in JS . needs the s flag.
const META_RE = new RegExp(
  "path:\\s*(?<path>\\S+)\\s+" +
    "bytes:\\s*(?<bytes>\\d+)\\s+" +
    "sha256:\\s*(?<sha256>[a-fA-F0-9]{64})\\s+" +
    "encoding:\\s*(?<encoding>\\S+)" +
    "(?:\\s+baseRev:\\s*(?<baseRev>\\S+))?" +
    "(?:\\s+sourceSeed:\\s*(?<sourceSeed>\\S+))?" +
    "(?:\\s+fileIndex:\\s*(?<fileIndex>\\d+))?" +
    "(?:\\s+fileCount:\\s*(?<fileCount>\\d+))?",
  "s",
);

function fail(message) {
  process.stderr.write(`ops-artifact-materialize: error: ${message}\n`);
  process.exit(1);
}

// --- Python json.dumps(indent=2) serializer (ensure_ascii=True, NO sort_keys) ---
// Mirrors json.dumps default: non-ASCII -> \uXXXX (surrogate pairs for astral),
// keys kept in insertion order (sort_keys absent), 2-space indent.
function jsonString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

function ser(value, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return "[\n" + value.map((v) => pad + ser(v, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const pad = " ".repeat(indent * (depth + 1));
  const closePad = " ".repeat(indent * depth);
  return (
    "{\n" +
    keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], indent, depth + 1)).join(",\n") +
    "\n" +
    closePad +
    "}"
  );
}

// Python json.dumps(value, indent=2) — ensure_ascii=True, no sort_keys.
function dumps2(value) {
  return ser(value, 2, 0);
}

function readInputText(filePath) {
  const raw = fs.readFileSync(filePath, { encoding: "utf-8" });
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return raw;
  }

  const previews = [];
  if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
    for (const key of ["last", "messages", "turns"]) {
      const value = doc[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
          const role = item.role;
          if (!(role === undefined || role === null || role === "assistant")) continue;
          // Python: item.get("preview") or item.get("text") or item.get("content")
          const preview = item.preview || item.text || item.content;
          if (typeof preview === "string") previews.push(preview);
        }
      }
    }
  }
  return previews.length ? previews.join("\n\n") : raw;
}

function safeOutputPath(outDir, relPath) {
  if (relPath.includes("\0")) {
    fail(`unsafe output path contains NUL: ${pyRepr(relPath)}`);
  }
  // PurePosixPath: absolute if starts with "/"; parts split on "/".
  const isAbsolute = relPath.startsWith("/");
  // PurePosixPath drops empty segments and "." segments.
  const parts = relPath.split("/").filter((p) => p !== "" && p !== ".");
  if (isAbsolute || parts.some((part) => part === "..")) {
    fail(`unsafe output path: ${relPath}`);
  }
  return path.join(outDir, ...parts);
}

// Mirror Python repr() for a simple string (used only in NUL error path).
function pyRepr(s) {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\0/g, "\\x00") + "'";
}

function parseBlock(block) {
  const payloadMarker = "payload:";
  const idx = block.indexOf(payloadMarker);
  if (idx < 0) {
    fail("BEGIN_B64_FILE block has no payload");
  }
  const metaText = block.slice(0, idx).trim();
  // Python: re.sub(r"\s+", "", block[idx+len:].strip())
  const payload = block
    .slice(idx + payloadMarker.length)
    .trim()
    .replace(/\s+/g, "");
  const match = META_RE.exec(metaText);
  if (!match) {
    fail(`cannot parse BEGIN_B64_FILE metadata: ${metaText}`);
  }
  const g = match.groups;
  const meta = {
    path: g.path,
    bytes: parseInt(g.bytes || "0", 10),
    sha256: String(g.sha256).toLowerCase(),
    encoding: g.encoding,
    baseRev: g.baseRev === undefined ? null : g.baseRev,
    sourceSeed: g.sourceSeed === undefined ? null : g.sourceSeed,
    fileIndex: g.fileIndex ? parseInt(g.fileIndex, 10) : null,
    fileCount: g.fileCount ? parseInt(g.fileCount, 10) : null,
  };
  return [meta, payload];
}

// Strict base64 decode matching Python base64.b64decode(payload, validate=True).
// validate=True rejects any char outside the standard base64 alphabet and
// requires the input to be a valid (correctly padded) base64 string.
function strictB64Decode(payload, pathLabel) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || /=[^=]/.test(payload)) {
    fail(`invalid base64 for ${pathLabel}: Invalid base64-encoded string`);
  }
  if (payload.length % 4 !== 0) {
    fail(`invalid base64 for ${pathLabel}: Invalid base64-encoded string of length ${payload.length}`);
  }
  const buf = Buffer.from(payload, "base64");
  // Re-encode to confirm round trip (catches lenient acceptance).
  if (buf.toString("base64") !== payload) {
    fail(`invalid base64 for ${pathLabel}: Invalid base64-encoded string`);
  }
  return buf;
}

function materialize(inputPath, outDir, strictCount) {
  const text = readInputText(inputPath);
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];

  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    const [meta, payload] = parseBlock(m[1].trim());
    if (meta.encoding !== "base64") {
      fail(`unsupported encoding for ${meta.path}: ${meta.encoding}`);
    }
    const data = strictB64Decode(payload, meta.path);

    const actualSha = crypto.createHash("sha256").update(data).digest("hex");
    const outPath = safeOutputPath(outDir, meta.path);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, data);
    const ok = data.length === meta.bytes && actualSha === meta.sha256;
    rows.push({
      path: meta.path,
      outPath: outPath,
      bytes: data.length,
      bytesExpected: meta.bytes,
      sha256: actualSha,
      sha256Expected: meta.sha256,
      ok,
      baseRev: meta.baseRev,
      sourceSeed: meta.sourceSeed,
      fileIndex: meta.fileIndex,
      fileCount: meta.fileCount,
    });
  }

  if (rows.length === 0) {
    fail("no BEGIN_B64_FILE blocks found");
  }

  if (strictCount) {
    const declaredSet = new Set();
    for (const row of rows) {
      if (row.fileCount !== null && row.fileCount !== undefined) declaredSet.add(row.fileCount);
    }
    const declared = [...declaredSet];
    if (declared.length !== 1 || declared[0] !== rows.length) {
      const sortedDeclared = [...declared].sort((a, b) => a - b);
      fail(`fileCount mismatch: declared=[${sortedDeclared.join(", ")}] actual=${rows.length}`);
    }
    const indexes = rows
      .filter((row) => row.fileIndex !== null && row.fileIndex !== undefined)
      .map((row) => row.fileIndex)
      .sort((a, b) => a - b);
    const expected = Array.from({ length: rows.length }, (_, i) => i + 1);
    if (indexes.length !== expected.length || indexes.some((v, i) => v !== expected[i])) {
      fail(`fileIndex mismatch: [${indexes.join(", ")}]`);
    }
  }

  const failed = rows.filter((row) => !row.ok);
  const manifest = {
    kind: "ops.artifactMaterialize.manifest.v1",
    inputPath: String(inputPath),
    outDir: String(outDir),
    count: rows.length,
    ok: failed.length === 0,
    rows,
  };
  fs.writeFileSync(
    path.join(outDir, "MATERIALIZE_MANIFEST.json"),
    dumps2(manifest) + "\n",
    { encoding: "utf-8" },
  );
  if (failed.length) {
    process.exit(1);
  }
  return manifest;
}

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        input: { type: "string" },
        "out-dir": { type: "string" },
        "strict-count": { type: "boolean" },
        json: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }

  if (values.input === undefined) {
    process.stderr.write("error: the following arguments are required: --input\n");
    return 2;
  }
  if (values["out-dir"] === undefined) {
    process.stderr.write("error: the following arguments are required: --out-dir\n");
    return 2;
  }

  const manifest = materialize(values.input, values["out-dir"], Boolean(values["strict-count"]));
  if (values.json) {
    process.stdout.write(dumps2(manifest) + "\n");
  } else {
    process.stdout.write(
      dumps2({
        ok: manifest.ok,
        count: manifest.count,
        manifest: path.join(values["out-dir"], "MATERIALIZE_MANIFEST.json"),
      }) + "\n",
    );
  }
  return manifest.ok ? 0 : 1;
}

const code = main(process.argv.slice(2));
process.exit(code);
