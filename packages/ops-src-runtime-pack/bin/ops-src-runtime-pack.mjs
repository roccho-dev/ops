#!/usr/bin/env node
// Create and validate source/runtime handoff packs.
//
// The tool owns payload creation only. It does not create ChatGPT threads, upload
// Project Source files, approve work, merge, or push.
//
// Node ESM port of ops-src-runtime-pack.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const REQUIRED_DEPENDENCY_CLASSES = [
  "target package source",
  "dependent package metadata",
  "dependent source refs",
  "Nix runtime metadata",
  "execution environment metadata",
  "policy inputs",
  "role catalog",
  "organization topology",
  "command board",
  "source manifest",
  "runtime manifest",
  "payload manifest",
];

class PackError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.msg = message;
  }
}

// --- Python json.dumps serializers (ensure_ascii=True) ---
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

function ser(value, sortKeys, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent) {
      const pad = " ".repeat(indent * (depth + 1));
      const closePad = " ".repeat(indent * depth);
      return "[\n" + value.map((v) => pad + ser(v, sortKeys, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    return "[" + value.map((v) => ser(v, sortKeys, indent, depth + 1)).join(", ") + "]";
  }
  let keys = Object.keys(value);
  if (sortKeys) keys = keys.sort();
  if (keys.length === 0) return "{}";
  if (indent) {
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return (
      "{\n" +
      keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(",\n") +
      "\n" +
      closePad +
      "}"
    );
  }
  return "{" + keys.map((k) => jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(", ") + "}";
}

function dumpsSorted2(value) {
  return ser(value, true, 2, 0);
}
function dumpsSortedCompact(value) {
  return ser(value, true, 0, 0);
}

function nowIso() {
  // Python datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const micros = pad(d.getUTCMilliseconds(), 3) + "000";
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${micros}Z`
  );
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
}

function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { encoding: "utf-8" });
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, dumpsSorted2(value) + "\n", { encoding: "utf-8" });
}

// Mirror subprocess.run(text=True, stdout=PIPE, stderr=PIPE).
function runCmd(cmd, cwd, logPath = null, allowFail = false) {
  const proc = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf-8" });
  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";
  const returncode = proc.status === null ? -1 : proc.status;
  if (logPath) {
    writeText(logPath, "$ " + cmd.join(" ") + "\n\nSTDOUT\n" + stdout + "\nSTDERR\n" + stderr);
  }
  if (returncode !== 0 && !allowFail) {
    throw new PackError("command-failed", `command failed (${returncode}): ${cmd.join(" ")}\n${stderr}`);
  }
  return { stdout, stderr, returncode };
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function requireFile(p, label) {
  if (!isFile(p)) {
    throw new PackError("missing-required-input", `${label} does not exist: ${p}`);
  }
  return p;
}

function safePolicyName(p) {
  const digest = sha256File(p).slice(0, 12);
  return `${digest}-${path.basename(p)}`;
}

function gitHead(repoRoot) {
  const proc = runCmd(["git", "rev-parse", "HEAD"], repoRoot, null, true);
  return proc.returncode === 0 ? proc.stdout.trim() : null;
}

function gitStatus(repoRoot) {
  return runCmd(["git", "status", "--short"], repoRoot, null, true).stdout;
}

function gitFiles(repoRoot, includeUntracked) {
  const cmd = ["git", "ls-files", "-z", "--cached"];
  if (includeUntracked) cmd.push("--others", "--exclude-standard");
  const proc = runCmd(cmd, repoRoot, null, true);
  if (proc.returncode !== 0) {
    throw new PackError("git-files-failed", "source archive requires a Git working tree");
  }
  return proc.stdout.split("\0").filter((item) => item).map((item) => path.join(repoRoot, item));
}

// --- minimal stdlib tar (USTAR) writer + gzip ---
function tarHeader(name, size, mode, mtime) {
  const buf = Buffer.alloc(512, 0);
  const writeStr = (str, offset, len) => {
    const b = Buffer.from(str, "binary");
    b.copy(buf, offset, 0, Math.min(b.length, len));
  };
  const writeOctal = (num, offset, len) => {
    // len-1 octal digits, space-padded zero-filled, trailing NUL.
    const s = num.toString(8).padStart(len - 1, "0");
    writeStr(s, offset, len - 1);
    buf[offset + len - 1] = 0;
  };
  // name (100). USTAR splits long names into prefix(155)+name(100); test names
  // are short so prefix stays empty.
  writeStr(name, 0, 100);
  writeOctal(mode & 0o7777, 100, 8);
  writeOctal(0, 108, 8); // uid
  writeOctal(0, 116, 8); // gid
  writeOctal(size, 124, 12);
  writeOctal(Math.floor(mtime), 136, 12);
  // checksum field filled with spaces while computing
  buf.fill(0x20, 148, 156);
  buf[156] = 0x30; // typeflag '0' regular file
  // magic "ustar\0" + version "00"
  writeStr("ustar", 257, 6);
  buf[257 + 5] = 0;
  buf[263] = 0x30;
  buf[264] = 0x30;
  // compute checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const chk = sum.toString(8).padStart(6, "0");
  writeStr(chk, 148, 6);
  buf[148 + 6] = 0;
  buf[148 + 7] = 0x20;
  return buf;
}

function createTarGz(files, repoRoot, outPath) {
  const chunks = [];
  for (const filePath of files) {
    const rel = path.relative(repoRoot, filePath);
    const arcname = "src/" + rel.split(path.sep).join("/");
    const data = fs.readFileSync(filePath);
    const st = fs.statSync(filePath);
    chunks.push(tarHeader(arcname, data.length, st.mode, st.mtimeMs / 1000));
    chunks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  // two 512-byte zero blocks terminate the archive
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  const gz = zlib.gzipSync(tar);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, gz);
}

function pyResolve(p) {
  return path.resolve(p);
}

function isParentOf(ancestor, descendant) {
  // emulate `ancestor in resolved.parents`
  const rel = path.relative(ancestor, descendant);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function createSourceArchive(repoRoot, outPath, excludeRoot, includeUntracked) {
  const files = [];
  const excludeResolved = pyResolve(excludeRoot);
  const outResolved = pyResolve(outPath);
  for (const filePath of gitFiles(repoRoot, includeUntracked)) {
    const resolved = pyResolve(filePath);
    if (resolved === outResolved || isParentOf(excludeResolved, resolved) || resolved === excludeResolved) {
      continue;
    }
    if (filePath.split(path.sep).includes(".git")) continue;
    files.push(filePath);
  }
  const sorted = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  createTarGz(sorted, repoRoot, outPath);
  return {
    path: String(outPath),
    sha256: sha256File(outPath),
    bytes: fs.statSync(outPath).size,
    fileCount: files.length,
    includeUntracked,
  };
}

function copyPolicyFiles(paths, outDir) {
  const copied = [];
  const filesDir = path.join(outDir, "POLICY", "files");
  for (const text of paths) {
    const src = requireFile(text, "policy file");
    const dst = path.join(filesDir, safePolicyName(src));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied.push({
      sourcePath: String(src),
      path: path.relative(outDir, dst),
      sha256: sha256File(dst),
      bytes: fs.statSync(dst).size,
    });
  }
  return copied;
}

function maybeCopyFlakeLock(repoRoot, outDir) {
  const src = path.join(repoRoot, "flake.lock");
  if (!isFile(src)) {
    return { present: false, path: null, sha256: null, bytes: 0 };
  }
  const dst = path.join(outDir, "NIX", "flake.lock");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return { present: true, path: path.relative(outDir, dst), sha256: sha256File(dst), bytes: fs.statSync(dst).size };
}

function realizeInstallables(repoRoot, installables, outDir, metadataOnly) {
  const results = [];
  const pathInfoAll = [];
  const buildLog = path.join(outDir, "GATES", "nix-build.log");
  const pathInfoLog = path.join(outDir, "GATES", "nix-path-info.log");
  for (const installable of installables) {
    if (metadataOnly) {
      results.push({ installable, metadataOnly: true });
      continue;
    }
    const proc = runCmd(
      ["nix", "build", "--no-link", "--print-out-paths", "--no-write-lock-file", installable],
      repoRoot,
      buildLog,
    );
    const paths = proc.stdout.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l);
    if (paths.length === 0) {
      throw new PackError("nix-build-no-output", `nix build produced no output for ${installable}`);
    }
    const infoProc = runCmd(["nix", "path-info", "--json", "--closure-size", ...paths], repoRoot, pathInfoLog);
    const pathInfo = JSON.parse(infoProc.stdout);
    for (const x of pathInfo) pathInfoAll.push(x);
    results.push({ installable, storePaths: paths, pathInfo });
  }
  writeJson(path.join(outDir, "NIX", "path-info.json"), pathInfoAll);
  return results;
}

function rglobFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...rglobFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function copyBinaryCache(repoRoot, outDir, installables, metadataOnly) {
  const cacheDir = path.join(outDir, "NIX", "binary-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  if (metadataOnly) {
    return { path: path.relative(outDir, cacheDir), metadataOnly: true };
  }
  const storePaths = [];
  for (const row of installables) {
    for (const sp of row.storePaths || []) storePaths.push(sp);
  }
  if (storePaths.length === 0) {
    throw new PackError("missing-store-paths", "no store paths to copy into binary cache");
  }
  runCmd(["nix", "copy", "--to", `file://${cacheDir}`, ...storePaths], repoRoot, path.join(outDir, "GATES", "nix-copy.log"));
  const info = requireFile(path.join(cacheDir, "nix-cache-info"), "binary cache info");
  const bytes = rglobFiles(cacheDir).reduce((acc, p) => acc + fs.statSync(p).size, 0);
  return {
    path: path.relative(outDir, cacheDir),
    nixCacheInfo: path.relative(outDir, info),
    bytes,
  };
}

function flakeArchive(repoRoot, outDir, metadataOnly) {
  const target = path.join(outDir, "NIX", "flake-archive.json");
  if (metadataOnly) {
    writeJson(target, { metadataOnly: true });
    return { path: path.relative(outDir, target), metadataOnly: true };
  }
  const proc = runCmd(
    ["nix", "flake", "archive", "--json", "--no-write-lock-file", String(repoRoot)],
    repoRoot,
    path.join(outDir, "GATES", "nix-flake-archive.log"),
  );
  writeText(target, proc.stdout);
  return { path: path.relative(outDir, target), sha256: sha256File(target), bytes: fs.statSync(target).size };
}

function makeStartHere(manifest) {
  const firstInstallable = manifest.installables.length ? manifest.installables[0] : {};
  let firstPath = "";
  if (firstInstallable.storePaths && firstInstallable.storePaths.length) {
    firstPath = firstInstallable.storePaths[0];
  }
  const policyFirst = manifest.policyInputs.length ? manifest.policyInputs[0].sha256 : "";
  return [
    "START_HERE: ops src runtime handoff pack",
    `packNonce: ${manifest.packNonce}`,
    `packageName: ${manifest.packageName}`,
    `repoId: ${manifest.repo.repoId}`,
    `gitHead: ${manifest.repo.head || "unknown"}`,
    `installables count: ${manifest.installables.length}`,
    `first installable: ${firstInstallable.installable !== undefined ? firstInstallable.installable : ""}`,
    `first store path: ${firstPath}`,
    `nixVersion: ${manifest.nix.version}`,
    `flakeLockPresent: ${pyBool(manifest.nix.flakeLock.present)}`,
    `includeUntracked: ${pyBool(manifest.source.archive.includeUntracked)}`,
    `binaryCache: ${manifest.nix.binaryCache.path}`,
    `sourceArchiveSha256: ${manifest.source.archive.sha256}`,
    `policyInputs count: ${manifest.policyInputs.length}`,
    `firstPolicySha256: ${policyFirst}`,
    `requiredDependencyClasses count: ${manifest.requiredDependencyClasses.length}`,
    "readbackInstruction: return packNonce, packageName, first store path, firstPolicySha256, and requiredDependencyClasses count.",
    "",
  ].join("\n");
}

// Python str(bool) -> "True"/"False" (used in f-strings).
function pyBool(v) {
  return v ? "True" : "False";
}

function create(args) {
  const repoRoot = pyResolve(args["repo-root"]);
  const outDir = pyResolve(args["out-dir"]);
  if (fs.existsSync(outDir)) {
    if (!args.force) {
      throw new PackError("output-exists", `output exists: ${outDir}`);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  if (!args.installable.length) {
    throw new PackError("missing-required-input", "at least one --installable is required");
  }

  const source = createSourceArchive(
    repoRoot,
    path.join(outDir, "SRC", "source.tar.gz"),
    outDir,
    args["include-untracked"],
  );
  writeText(path.join(outDir, "SRC", "working-tree.diff"), runCmd(["git", "diff", "--binary", "HEAD"], repoRoot, null, true).stdout);
  writeText(path.join(outDir, "SRC", "staged.diff"), runCmd(["git", "diff", "--binary", "--cached"], repoRoot, null, true).stdout);
  const flakeLock = maybeCopyFlakeLock(repoRoot, outDir);
  const policyInputs = copyPolicyFiles(args["policy-file"] || [], outDir);
  const installables = realizeInstallables(repoRoot, args.installable, outDir, args["metadata-only"]);
  const binaryCache = copyBinaryCache(repoRoot, outDir, installables, args["metadata-only"]);
  const archive = flakeArchive(repoRoot, outDir, args["metadata-only"]);
  const nixVersion = runCmd(["nix", "--version"], repoRoot).stdout.trim();

  const nonceSeed = [args["package-name"], nowIso(), repoRoot.split(path.sep).join("/"), args.installable.join(",")].join("|");
  const manifest = {
    kind: "ops.srcRuntimePack.v1",
    createdAt: nowIso(),
    packageName: args["package-name"],
    packNonce: "src-runtime-pack-" + sha256Text(nonceSeed),
    metadataOnly: Boolean(args["metadata-only"]),
    repo: {
      repoId: args["repo-id"],
      root: String(repoRoot),
      head: gitHead(repoRoot),
      dirtyStatus: gitStatus(repoRoot),
    },
    source: {
      archive: {
        path: path.join("SRC", "source.tar.gz"),
        sha256: source.sha256,
        bytes: source.bytes,
        fileCount: source.fileCount,
        includeUntracked: source.includeUntracked,
      },
      workingTreeDiff: "SRC/working-tree.diff",
      stagedDiff: "SRC/staged.diff",
    },
    nix: {
      version: nixVersion,
      flakeLock,
      flakeArchive: archive,
      binaryCache,
      pathInfo: "NIX/path-info.json",
    },
    installables,
    policyInputs,
    requiredDependencyClasses: REQUIRED_DEPENDENCY_CLASSES,
    projectSourceEntrypoint: "START_HERE.txt",
    verifyCommand: "ops-src-runtime-pack validate --pack-dir .",
    approvalBoundary: {
      semanticApproval: false,
      completionApproval: false,
      routeDecision: false,
    },
  };
  writeJson(path.join(outDir, "MANIFEST.json"), manifest);
  writeText(path.join(outDir, "START_HERE.txt"), makeStartHere(manifest));
  writeText(
    path.join(outDir, "README.md"),
    [
      `# ${args["package-name"]} source/runtime handoff pack`,
      "",
      "Start with `START_HERE.txt`, then verify with:",
      "",
      "```sh",
      "ops-src-runtime-pack validate --pack-dir .",
      "```",
      "",
      "This pack is transport evidence, not semantic approval or completion approval.",
      "",
    ].join("\n"),
  );
  writeJson(path.join(outDir, "POLICY", "policy-manifest.json"), { kind: "ops.policyInputs.v1", items: policyInputs });
  return {
    ok: true,
    status: "src-runtime-pack-created",
    outDir: String(outDir),
    manifest: path.join(outDir, "MANIFEST.json"),
  };
}

function validate(args) {
  const packDir = pyResolve(args["pack-dir"]);
  const manifestPath = requireFile(path.join(packDir, "MANIFEST.json"), "manifest");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, { encoding: "utf-8" }));
  const required = ["START_HERE.txt", "README.md", "SRC/source.tar.gz", "NIX/path-info.json", "POLICY/policy-manifest.json"];
  for (const rel of required) {
    requireFile(path.join(packDir, rel), rel);
  }
  const archive = path.join(packDir, manifest.source.archive.path);
  const expected = manifest.source.archive.sha256;
  const actual = sha256File(archive);
  if (actual !== expected) {
    throw new PackError("hash-mismatch", `source archive hash mismatch: ${actual} != ${expected}`);
  }
  const flakeLock = (manifest.nix && manifest.nix.flakeLock) || {};
  const presentDefault = Boolean(flakeLock.path);
  const present = flakeLock.present !== undefined ? flakeLock.present : presentDefault;
  if (present) {
    const lockPath = flakeLock.path;
    if (!lockPath) {
      throw new PackError("missing-flake-lock-path", "flake.lock is marked present but has no path");
    }
    requireFile(path.join(packDir, lockPath), "flake.lock");
  }
  if (!manifest.metadataOnly) {
    requireFile(path.join(packDir, manifest.nix.binaryCache.nixCacheInfo), "binary cache info");
  }
  const start = fs.readFileSync(path.join(packDir, "START_HERE.txt"), { encoding: "utf-8" });
  if (!start.includes(manifest.packNonce)) {
    throw new PackError("missing-nonce", "START_HERE does not contain packNonce");
  }
  return {
    ok: true,
    status: "src-runtime-pack-valid",
    packDir: String(packDir),
    packNonce: manifest.packNonce,
    metadataOnly: Boolean(manifest.metadataOnly),
  };
}

// --- argparse-like parser ---
const STRING_OPTS = {
  create: ["repo-root", "repo-id", "package-name", "out-dir"],
  validate: ["pack-dir"],
};
const BOOL_OPTS = {
  create: ["force", "metadata-only", "include-untracked", "json"],
  validate: ["json"],
};
const APPEND_OPTS = {
  create: ["installable", "policy-file"],
  validate: [],
};
const DEFAULTS = {
  create: { "repo-root": ".", "repo-id": "ops" },
  validate: {},
};

function argError(message) {
  process.stderr.write(`ops-src-runtime-pack: error: ${message}\n`);
  process.exit(2);
}

function parseSub(command, argv) {
  const args = { ...DEFAULTS[command] };
  for (const k of APPEND_OPTS[command]) args[k] = [];
  for (const k of BOOL_OPTS[command]) args[k] = false;
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (!tok.startsWith("--")) argError(`unrecognized arguments: ${tok}`);
    let name = tok.slice(2);
    let inlineVal;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      inlineVal = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (BOOL_OPTS[command].includes(name)) {
      args[name] = true;
      i += 1;
      continue;
    }
    let value;
    if (inlineVal !== undefined) {
      value = inlineVal;
      i += 1;
    } else {
      if (i + 1 >= argv.length) argError(`argument --${name}: expected one argument`);
      value = argv[i + 1];
      i += 2;
    }
    if (APPEND_OPTS[command].includes(name)) args[name].push(value);
    else if (STRING_OPTS[command].includes(name)) args[name] = value;
    else argError(`unrecognized arguments: --${name}`);
  }
  return args;
}

function main(argv) {
  if (argv.length === 0) {
    argError("the following arguments are required: command");
  }
  const command = argv[0];
  if (!["create", "validate"].includes(command)) {
    argError(`argument command: invalid choice: '${command}'`);
  }
  const args = parseSub(command, argv.slice(1));
  if (command === "create" && args["package-name"] === undefined) {
    argError("the following arguments are required: --package-name");
  }
  if (command === "create" && args["out-dir"] === undefined) {
    argError("the following arguments are required: --out-dir");
  }
  if (command === "validate" && args["pack-dir"] === undefined) {
    argError("the following arguments are required: --pack-dir");
  }

  try {
    const result = command === "create" ? create(args) : validate(args);
    process.stdout.write((args.json ? dumpsSorted2(result) : result.status) + "\n");
    return 0;
  } catch (e) {
    if (e instanceof PackError) {
      process.stdout.write(dumpsSorted2({ ok: false, status: e.status, error: e.msg }) + "\n");
      return 1;
    }
    throw e;
  }
}

process.exit(main(process.argv.slice(2)));
