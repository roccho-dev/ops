#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
// Load the package only after the filesystem guards are installed and self-tested.
let
  assembleArtifact,
  canonicalJson,
  canonicalJsonText,
  parseArtifactLock,
  readArtifactLock,
  sha256File,
  sha256Tree,
  writeAssemblyReceipt;

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const mode = process.argv[2] ?? "all";
const counts = { assembly: 0, guard: 0, lock: 0, purity: 0 };

const expectThrows = (fn, pattern) => {
  assert.throws(fn, pattern);
};

const withTemp = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-assembly-test-"));
  // Keep evidence on success and failure; disposal belongs to the enclosing environment.
  return fn(root);
};

const writeOctal = (header, offset, length, value) => {
  const body = value.toString(8).padStart(length - 1, "0");
  header.write(body, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
};

const tarHeader = ({ body = Buffer.alloc(0), name, type = "0" }) => {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(Buffer.byteLength(name), 100), "utf8");
  writeOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, body.length);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = [...header].reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 32;
  return header;
};

const makeTgz = (filePath, entries) => {
  const chunks = [];
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body ?? "", "utf8");
    chunks.push(tarHeader({ ...entry, body }), body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  fs.writeFileSync(filePath, zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 }));
  return filePath;
};

const packageTgz = (root, { exportTarget = "./index.mjs", name = "@example/module", version = "1.2.3" } = {}) => {
  const target = path.join(root, `${name.replace(/[^a-z0-9]+/gi, "-")}.tgz`);
  const manifest = canonicalJson({ exports: { ".": exportTarget, "./v1": "./v1.mjs" }, name, type: "module", version });
  return makeTgz(target, [
    { name: "package/", type: "5" },
    { body: `${manifest}\n`, name: "package/package.json" },
    { body: "export const value = 1;\n", name: "package/index.mjs" },
    { body: "export const versioned = 1;\n", name: "package/v1.mjs" },
  ]);
};

const row = (overrides = {}) => ({
  id: "module-a",
  kind: "npm-tgz",
  name: "@example/module",
  note: "synthetic test input",
  owner: "upstream",
  required: true,
  revision: "0123456789abcdef0123456789abcdef01234567",
  sha256: "0".repeat(64),
  status: "locked",
  target: "modules/module-a/package",
  version: "1.2.3",
  export: ".",
  shim: "modules/module-a/index.mjs",
  ...overrides,
});

const lockText = (rows) => rows.map(canonicalJson).join("\n") + "\n";
const writeLock = (root, rows) => {
  const lockPath = path.join(root, "lock.jsonl");
  fs.writeFileSync(lockPath, lockText(rows));
  return lockPath;
};

const runLock = () => {
  const valid = row();
  assert.deepEqual(parseArtifactLock(lockText([valid])), [valid]); counts.lock += 1;
  expectThrows(() => parseArtifactLock(lockText([valid]).replace(/\n$/, "")), /final LF/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(`${canonicalJson(valid)}\n\n`), /blank line/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(`${JSON.stringify(valid)}\r\n`), /CR/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(`${JSON.stringify({ ...valid, id: valid.id }, null, 2)}\n`), /line 1|non-canonical|Unexpected/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(lockText([valid, valid])), /duplicate artifact lock id/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(lockText([{ ...valid, unexpected: true }])), /unknown field/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(lockText([valid, row({ id: "module-b", shim: "modules/module-b/index.mjs" })])), /duplicate artifact target/); counts.lock += 1;
  expectThrows(() => parseArtifactLock(lockText([valid, row({ id: "module-b", target: "modules/module-b/package" })])), /duplicate artifact shim/); counts.lock += 1;
  for (const target of ["../escape", "/absolute", "C:/drive", "bad\\path", "bad//path"]) {
    expectThrows(() => parseArtifactLock(lockText([row({ target })])), /path|absolute|backslash|unsafe/); counts.lock += 1;
  }
  expectThrows(() => parseArtifactLock(lockText([row({ sha256: null, status: "pending-digest" })]), { requireComplete: true }), /not locked|incomplete/); counts.lock += 1;
  assert.equal(parseArtifactLock(lockText([row({ required: false, sha256: null, status: "pending-digest" })]), { requireComplete: true }).length, 1); counts.lock += 1;
  expectThrows(() => parseArtifactLock(lockText([row({ kind: "directory", export: undefined, shim: undefined, target: "." }), row({ id: "directory-b", kind: "directory", export: undefined, shim: undefined, target: "." })])), /duplicate artifact target/); counts.lock += 1;
};

const positiveInputs = (root) => {
  const app = path.join(root, "app");
  fs.mkdirSync(path.join(app, "assets"), { recursive: true });
  fs.writeFileSync(path.join(app, "index.html"), "<!doctype html>\n");
  fs.writeFileSync(path.join(app, "assets", "app.mjs"), "export const app = true;\n");
  const first = packageTgz(root, { name: "@example/first", version: "1.0.0" });
  const second = packageTgz(root, { name: "@example/second", version: "2.0.0" });
  const rows = [
    row({ export: undefined, id: "app", kind: "directory", name: "@example/app", owner: "ui", revision: "a".repeat(40), sha256: sha256Tree(app).sha256, shim: undefined, target: ".", version: "0.1.0" }),
    row({ id: "first", name: "@example/first", revision: "b".repeat(40), sha256: sha256File(first), target: "modules/first/package", version: "1.0.0", shim: "modules/first/index.mjs" }),
    row({ export: "./v1", id: "second", name: "@example/second", revision: "c".repeat(40), sha256: sha256File(second), target: "modules/second/package", version: "2.0.0", shim: "modules/second/v1.mjs" }),
  ];
  return { app, first, lockPath: writeLock(root, rows), rows, second, sources: { app, first, second } };
};

const runAssembly = () => {
  // A fixed receipt can already exist before the first call, as in a fresh checkout.
  withTemp((root) => {
    const source = path.join(root, "input.html");
    fs.writeFileSync(source, "<!doctype html>\n", { flag: "wx" });
    const fileRow = row({ kind: "file", target: "index.html", export: undefined, shim: undefined, sha256: sha256File(source) });
    const lockPath = writeLock(root, [fileRow]);
    const existing = path.join(root, "tracked-receipt.json");
    fs.writeFileSync(existing, "{\"retained\":true}\n", { flag: "wx" });
    const oldBytes = fs.readFileSync(existing);
    const oldInode = fs.lstatSync(existing).ino;
    const receipt = assembleArtifact({ lockPath, outputDir: path.join(root, "out"), sources: { "module-a": source } });
    expectThrows(() => writeAssemblyReceipt(existing, receipt), /EEXIST/);
    assert.deepEqual(fs.readFileSync(existing), oldBytes);
    assert.equal(fs.lstatSync(existing).ino, oldInode);
    const fresh = path.join(root, "new-receipt.json");
    writeAssemblyReceipt(fresh, receipt);
    assert.equal(fs.readFileSync(fresh, "utf8"), canonicalJsonText(receipt));
    assert.equal(receipt.status, "PASS");
    assert.equal(sha256File(path.join(root, "out", "index.html")), fileRow.sha256);
    counts.assembly += 2;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(root, "out");
    const receipt = assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources });
    assert.equal(receipt.schema, "roccho.artifact.assembly-receipt/2");
    assert.equal(receipt.authority, false);
    assert.equal(receipt.status, "PASS");
    assert.equal(receipt.inputs.length, 3);
    assert.equal(receipt.locks.length, 3);
    assert.equal(receipt.outputTreeSha256, sha256Tree(output).sha256);
    assert.equal(fs.readFileSync(path.join(output, "index.html"), "utf8"), "<!doctype html>\n");
    assert.match(fs.readFileSync(path.join(output, "modules/first/index.mjs"), "utf8"), /export \* from/);
    assert.match(fs.readFileSync(path.join(output, "modules/second/v1.mjs"), "utf8"), /v1\.mjs/);
    const receiptPath = path.join(root, "receipts", "assembly.json");
    writeAssemblyReceipt(receiptPath, receipt);
    assert.equal(fs.readFileSync(receiptPath, "utf8"), canonicalJsonText(receipt));
    expectThrows(() => writeAssemblyReceipt(receiptPath, { status: "CHANGED" }), /EEXIST/);
    assert.equal(fs.readFileSync(receiptPath, "utf8"), canonicalJsonText(receipt));
    assert.equal(fs.existsSync(path.join(output, "assembly.json")), false);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const firstOutput = path.join(root, "out-a");
    const secondOutput = path.join(root, "out-b");
    const left = assembleArtifact({ lockPath: input.lockPath, outputDir: firstOutput, sources: input.sources });
    const right = assembleArtifact({ lockPath: input.lockPath, outputDir: secondOutput, sources: input.sources });
    assert.equal(left.outputTreeSha256, right.outputTreeSha256);
    assert.deepEqual(left.files, right.files);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(root, "out");
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, "old.txt"), "old\n");
    const before = fs.readdirSync(root).sort();
    expectThrows(() => assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources }), /output path must not exist/);
    assert.equal(fs.readFileSync(path.join(output, "old.txt"), "utf8"), "old\n");
    expectThrows(() => assembleArtifact({ failAt: "before-promote", lockPath: input.lockPath, outputDir: output, sources: input.sources }), /output path must not exist/);
    assert.equal(fs.readFileSync(path.join(output, "old.txt"), "utf8"), "old\n");
    assert.deepEqual(fs.readdirSync(root).sort(), before);
    counts.assembly += 2;
  });

  for (const kind of ["empty-directory", "file", "symlink", "dangling-symlink"]) withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(root, "out");
    if (kind === "empty-directory") fs.mkdirSync(output);
    else if (kind === "file") fs.writeFileSync(output, "old\n");
    else fs.symlinkSync(kind === "symlink" ? input.app : path.join(root, "missing"), output);
    const before = fs.lstatSync(output);
    const entries = fs.readdirSync(root).sort();
    expectThrows(() => assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources }), /output path must not exist/);
    assert.equal(fs.lstatSync(output).ino, before.ino);
    assert.deepEqual(fs.readdirSync(root).sort(), entries);
    if (kind === "file") assert.equal(fs.readFileSync(output, "utf8"), "old\n");
    if (kind.endsWith("symlink")) assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
    assert.equal(sha256Tree(input.app).sha256, input.rows[0].sha256);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(root, "out");
    expectThrows(() => assembleArtifact({ failAt: "after-backup", lockPath: input.lockPath, outputDir: output, sources: input.sources }), /unsupported failAt/);
    assert.equal(fs.existsSync(output), false);
    expectThrows(() => assembleArtifact({ failAt: "before-promote", lockPath: input.lockPath, outputDir: output, sources: input.sources }), /injected failure/);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith(".out.stage-")), true);
    assert.equal(sha256Tree(input.app).sha256, input.rows[0].sha256);
    counts.assembly += 2;
  });

  // A destination appearing after the preflight must not be replaced, even when empty.
  for (const populated of [false, true]) withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(root, "out");
    const mkdir = fs.mkdirSync;
    let inserted = false;
    let inode;
    fs.mkdirSync = (target, options) => {
      if (!inserted && path.resolve(target) === output) {
        inserted = true;
        mkdir(output);
        if (populated) fs.writeFileSync(path.join(output, "competitor.txt"), "keep\n");
        inode = fs.lstatSync(output).ino;
      }
      return mkdir(target, options);
    };
    try {
      expectThrows(() => assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources }), /EEXIST/);
    } finally {
      fs.mkdirSync = mkdir;
    }
    assert.equal(inserted, true);
    assert.equal(fs.lstatSync(output).ino, inode);
    assert.deepEqual(fs.readdirSync(output), populated ? ["competitor.txt"] : []);
    if (populated) assert.equal(fs.readFileSync(path.join(output, "competitor.txt"), "utf8"), "keep\n");
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(root, "out");
    const copy = fs.copyFileSync;
    let copies = 0;
    fs.copyFileSync = (source, target, flags) => {
      if (path.resolve(target).startsWith(`${output}${path.sep}`) && ++copies === 2) throw new Error("injected output copy failure");
      return copy(source, target, flags);
    };
    let receipt;
    try {
      expectThrows(() => { receipt = assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources }); }, /injected output copy failure/);
    } finally {
      fs.copyFileSync = copy;
    }
    assert.equal(receipt, undefined);
    assert.equal(copies, 2);
    const partial = sha256Tree(output);
    assert.equal(partial.files.length, 1);
    expectThrows(() => assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources }), /output path must not exist/);
    assert.deepEqual(sha256Tree(output), partial);
    assert.equal(sha256Tree(input.app).sha256, input.rows[0].sha256);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const output = path.join(input.app, "not-created", "out");
    const before = sha256Tree(input.app);
    expectThrows(() => assembleArtifact({ lockPath: input.lockPath, outputDir: output, sources: input.sources }), /workspace overlaps directory input/);
    assert.equal(fs.existsSync(path.dirname(output)), false);
    assert.deepEqual(sha256Tree(input.app), before);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    const badRows = input.rows.map((item) => item.id === "first" ? { ...item, sha256: "f".repeat(64) } : item);
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, badRows), outputDir: path.join(root, "out"), sources: input.sources }), /digest mismatch/);
    assert.equal(fs.existsSync(path.join(root, "out")), false);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const app = path.join(root, "app");
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, "ok.txt"), "ok\n");
    fs.symlinkSync("ok.txt", path.join(app, "link.txt"));
    expectThrows(() => sha256Tree(app), /symlink/);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const bad = packageTgz(root, { name: "@example/actual" });
    const badRow = row({ name: "@example/expected", sha256: sha256File(bad) });
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, [badRow]), outputDir: path.join(root, "out"), sources: { "module-a": bad } }), /package name mismatch/);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const bad = packageTgz(root, { version: "9.9.9" });
    const badRow = row({ sha256: sha256File(bad) });
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, [badRow]), outputDir: path.join(root, "out"), sources: { "module-a": bad } }), /package version mismatch/);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const bad = packageTgz(root, { exportTarget: "./missing.mjs" });
    const badRow = row({ sha256: sha256File(bad) });
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, [badRow]), outputDir: path.join(root, "out"), sources: { "module-a": bad } }), /ENOENT|export/);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const bad = packageTgz(root, { exportTarget: "../outside.mjs" });
    const badRow = row({ sha256: sha256File(bad) });
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, [badRow]), outputDir: path.join(root, "out"), sources: { "module-a": bad } }), /relative \.\/|unsafe|export/);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const traversal = makeTgz(path.join(root, "traversal.tgz"), [{ body: "bad", name: "package/../../escape" }]);
    const badRow = row({ sha256: sha256File(traversal) });
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, [badRow]), outputDir: path.join(root, "out"), sources: { "module-a": traversal } }), /unsafe path/);
    assert.equal(fs.existsSync(path.join(root, "escape")), false);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const symlink = makeTgz(path.join(root, "symlink.tgz"), [{ name: "package/link", type: "2" }]);
    const badRow = row({ sha256: sha256File(symlink) });
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, [badRow]), outputDir: path.join(root, "out"), sources: { "module-a": symlink } }), /link\/device/);
    counts.assembly += 1;
  });

  withTemp((root) => {
    const input = positiveInputs(root);
    fs.writeFileSync(path.join(input.app, "modules"), "collision\n");
    const rows = input.rows.map((item) => item.id === "app" ? { ...item, sha256: sha256Tree(input.app).sha256 } : item);
    expectThrows(() => assembleArtifact({ lockPath: writeLock(root, rows), outputDir: path.join(root, "out"), sources: input.sources }), /ENOTDIR|collision/);
    counts.assembly += 1;
  });
};

const walkFiles = (root) => {
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(root);
  return result;
};

const runPurity = () => {
  const executable = walkFiles(packageRoot).filter((file) => /\.(mjs|cjs|js)$/.test(file));
  assert.ok(executable.length >= 8);
  assert.equal(executable.filter((file) => !file.endsWith(".mjs")).length, 0);
  const sourceText = walkFiles(path.join(packageRoot, "src")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const forbidden of [/\bclass\s+[A-Za-z_$]/, /\bextends\s+[A-Za-z_$]/, /\brequire\s*\(/, /module\.exports/, /\.prototype\s*[.=]/]) {
    assert.doesNotMatch(sourceText, forbidden);
  }
  for (const productToken of [
    "semantic-map-package",
    "a2ui-web-core",
    "semantic-map-a2ui-app",
    "accounting-a2ui-app",
    "TAccount",
    "TAccountGrid",
    "FinancialStatements",
    "urn:roccho:a2ui:catalog:accounting:1",
    "document.createElement",
    "projectSemanticMap",
    "projectAccountingToA2ui",
    "reduceOperations",
  ]) {
    assert.equal(sourceText.includes(productToken), false, `generic source leaked product/domain token: ${productToken}`);
  }
  const packageRows = fs.readFileSync(path.join(repoRoot, "build/packages.jsonl"), "utf8").trimEnd().split("\n").map(JSON.parse);
  assert.equal(packageRows.filter((item) => item.name === "artifact-assembly").length, 1);
  const checkRows = fs.readFileSync(path.join(repoRoot, "build/checks.jsonl"), "utf8").trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(checkRows.filter((item) => item.name.startsWith("artifact-assembly-")).map((item) => item.name).sort(), ["artifact-assembly-assembly", "artifact-assembly-lock", "artifact-assembly-purity"]);
  const lock = readArtifactLock(path.join(repoRoot, "locks/semantic-map-a2ui.jsonl"));
  assert.equal(lock.length, 3);
  const accountingLock = readArtifactLock(path.join(repoRoot, "locks/accounting-a2ui.jsonl"));
  assert.equal(accountingLock.length, 2);
  assert.equal(accountingLock.find(row => row.id === "accounting-a2ui-app").status, "locked");
  counts.purity += 1;
};

if (!["all", "lock", "assembly", "purity"].includes(mode)) throw new Error(`unknown test mode: ${mode}`);
// This package's implementation uses this one fs import spelling. Reject other
// import routes before evaluating it; runtime stubs also cover property aliases.
const assertFsRoutes = (text, label) => {
  const withoutFsImport = text.replaceAll('import fs from "node:fs";', "");
  assert.doesNotMatch(withoutFsImport, /["'](?:node:)?fs(?:\/promises)?["']/, `E_FS_ROUTE: ${label}`);
  assert.doesNotMatch(text, /\b(?:import|require)\s*\(|\b(?:from|import)\s*["'](?:node:)?(?:module|child_process|worker_threads|vm)["']/, `E_FS_ROUTE: ${label}`);
  assert.doesNotMatch(text, /\b(?:rm|rmdir|unlink)(?:Sync)?\b/, `automated deletion is forbidden: ${label}`);
};

const forbiddenRoutes = [
  'import { rmSync as removeTree } from "node:fs"; removeTree(undefined);',
  'import {\n rmSync as removeTree\n} from "node:fs";',
  'import fs from "node:fs/promises";',
  'import { rm as removeTree } from "node:fs/promises";',
  'import * as filesystem from "node:fs";',
  'import("node:fs");',
  'require("fs");',
  'import { createRequire } from "node:module";',
];
for (const text of forbiddenRoutes) {
  expectThrows(() => assertFsRoutes(text, "in-memory negative"), /E_FS_ROUTE/);
  counts.guard += 1;
}
assertFsRoutes('import fs from "node:fs"; const type = "module"; fs.readFileSync("input");', "positive");
counts.guard += 1;
expectThrows(() => assertFsRoutes('import fs from "node:fs"; const removeTree = fs.rmSync;', "property alias"), /automated deletion/);
counts.guard += 1;
for (const directory of ["src", "bin"]) {
  for (const file of walkFiles(path.join(packageRoot, directory))) {
    if (/\.(mjs|cjs|js)$/.test(file)) assertFsRoutes(fs.readFileSync(file, "utf8"), file);
  }
}

const deletionCalls = [];
const guarded = [
  ...["rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync"].map((name) => ({ target: fs, name, async: false })),
  ...["rm", "rmdir", "unlink"].map((name) => ({ target: fsPromises, name, async: true })),
];
for (const entry of guarded) {
  entry.original = entry.target[entry.name];
  entry.deny = () => {
    deletionCalls.push(`${entry.async ? "promises." : ""}${entry.name}`);
    throw Object.assign(new Error(`deletion forbidden: ${entry.name}`), { code: "E_FS_DELETE" });
  };
  entry.stub = entry.async ? async () => entry.deny() : entry.deny;
  entry.target[entry.name] = entry.stub;
}
syncBuiltinESMExports();
try {
  // Real ESM named aliases and promises bindings, but only harmless stubs run.
  const aliases = await import(`data:text/javascript,${encodeURIComponent(
    'import { rm as a, rmSync as b, rmdir as c, rmdirSync as d, unlink as e, unlinkSync as f } from "node:fs";\n' +
    'import { rm as g, rmdir as h, unlink as i } from "node:fs/promises";\n' +
    'export const operations = [a, b, c, d, e, f, g, h, i];'
  )}`);
  assert.equal(aliases.operations.length, 9);
  assert.equal(guarded.length, aliases.operations.length);
  assert.equal(fs.promises, fsPromises);
  for (const [index, entry] of guarded.entries()) {
    const alias = aliases.operations[index];
    // Never invoke a native function if installation or export synchronization failed.
    assert.equal(entry.target[entry.name], entry.stub);
    assert.equal(alias, entry.stub);
    if (entry.async) await assert.rejects(alias(), { code: "E_FS_DELETE" });
    else assert.throws(alias, { code: "E_FS_DELETE" });
    counts.guard += 1;
  }
  assert.equal(deletionCalls.length, guarded.length);
  deletionCalls.length = 0; // Expected self-test interceptions, not package activity.
  ({ assembleArtifact, canonicalJson, canonicalJsonText, parseArtifactLock, readArtifactLock, sha256File, sha256Tree, writeAssemblyReceipt } = await import("../src/index.mjs"));
  assert.deepEqual(deletionCalls, []); // Also catches swallowed calls during module evaluation.
  if (mode === "all" || mode === "lock") runLock();
  if (mode === "all" || mode === "assembly") runAssembly();
  if (mode === "all" || mode === "purity") runPurity();
  assert.deepEqual(deletionCalls, []);
} finally {
  for (const { target, name, original } of guarded) target[name] = original;
  syncBuiltinESMExports();
}
process.stdout.write(`${JSON.stringify({ counts, mode, status: "artifact-assembly-tests-pass" })}\n`);
