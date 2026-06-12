#!/usr/bin/env node
// Build and verify multi-repo handoff packs around ops-handoff-core.
//
// The tool is the glue that issue 003 calls missing: it derives
// source-manifest / merge-target from git instead of hand-written JSON,
// builds per-repo source packs, invokes ops-handoff-core, and adds the
// semantic guarantees that ops-handoff-core validate intentionally does not
// provide (digest recomputation, manifest cross-check, stub rejection).
//
// It does not transport, upload, merge, push, or approve work.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import zlib from "node:zlib";
import process from "node:process";
import { execFileSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const HEX40 = /^[0-9a-f]{40}$/;

class PackError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.msg = message;
  }
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function loadJson(p, label) {
  let raw;
  try {
    raw = fs.readFileSync(p, { encoding: "utf-8" });
  } catch (e) {
    throw new PackError("invalid-json", `${label} is not readable: ${p}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new PackError("invalid-json", `${label} is not valid JSON: ${p}: ${e.message}`);
  }
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", { encoding: "utf-8" });
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function requireFile(pathText, label) {
  if (!pathText) {
    throw new PackError("missing-required-input", `missing required input: ${label}`);
  }
  if (!isFile(pathText)) {
    throw new PackError("missing-required-input", `required input does not exist: ${label}: ${pathText}`);
  }
  return pathText;
}

function git(root, argv, opts = {}) {
  try {
    return execFileSync("git", ["-C", root, ...argv], {
      encoding: opts.binary ? "buffer" : "utf-8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if (opts.allowFail) return null;
    const detail = e.stderr ? String(e.stderr).trim() : e.message;
    throw new PackError("git-failed", `git ${argv.join(" ")} failed in ${root}: ${detail}`);
  }
}

// --repo spec: <repoId>=<root>@<baseBranch>[..<candidateRef>]
// candidateRef defaults to HEAD of root. Branch names containing ".." are not
// supported by this syntax.
function parseRepoSpec(spec) {
  const eq = spec.indexOf("=");
  const at = spec.lastIndexOf("@");
  if (eq <= 0 || at <= eq + 1 || at === spec.length - 1) {
    throw new PackError("invalid-repo-spec", `invalid --repo spec (want repoId=root@baseBranch[..candidateRef]): ${spec}`);
  }
  const repoId = spec.slice(0, eq);
  const root = spec.slice(eq + 1, at);
  const refs = spec.slice(at + 1);
  const dots = refs.indexOf("..");
  const baseBranch = dots >= 0 ? refs.slice(0, dots) : refs;
  const candidateRef = dots >= 0 ? refs.slice(dots + 2) : "HEAD";
  if (!repoId || !root || !baseBranch || !candidateRef) {
    throw new PackError("invalid-repo-spec", `invalid --repo spec (want repoId=root@baseBranch[..candidateRef]): ${spec}`);
  }
  return { repoId, root, baseBranch, candidateRef };
}

function resolveCommit(root, ref, label) {
  const out = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFail: true });
  if (out === null) {
    throw new PackError("unknown-ref", `${label} does not resolve to a commit: ${ref} in ${root}`);
  }
  return out.trim();
}

function buildRepoEntry(spec, srcDir) {
  const root = path.resolve(spec.root);
  if (!fs.existsSync(path.join(root))) {
    throw new PackError("missing-repo-root", `repo root does not exist: ${root}`);
  }
  const baseHead = resolveCommit(root, spec.baseBranch, `baseBranch of ${spec.repoId}`);
  const candidateHead = resolveCommit(root, spec.candidateRef, `candidateRef of ${spec.repoId}`);
  const dirty = git(root, ["status", "--short"], { allowFail: true });
  const tar = git(root, ["archive", "--format=tar", candidateHead], { binary: true });
  const packed = zlib.gzipSync(tar, { level: 9 });
  const packRel = path.join("SRC", `${spec.repoId}.tar.gz`);
  const packAbs = path.join(srcDir, `${spec.repoId}.tar.gz`);
  fs.mkdirSync(path.dirname(packAbs), { recursive: true });
  fs.writeFileSync(packAbs, packed);
  return {
    repoId: spec.repoId,
    root,
    baseBranch: spec.baseBranch,
    baseHead,
    candidateRef: spec.candidateRef,
    candidateHead,
    dirtyStatus: dirty === null ? "" : dirty.trim(),
    pack: {
      path: packRel.split(path.sep).join("/"),
      sha256: crypto.createHash("sha256").update(packed).digest("hex"),
      bytes: packed.length,
    },
  };
}

function defaultRuntimeManifest() {
  const archMap = { x64: "x86_64", arm64: "aarch64" };
  const system = `${archMap[process.arch] || process.arch}-${process.platform}`;
  return {
    kind: "runtime.manifest.v1",
    system,
    nodeVersion: process.version,
    checks: [],
  };
}

function splitCommand(text) {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

function runHandoffCore(coreCmd, argv, label, opts = {}) {
  // ops-handoff-core validate always emits JSON and rejects --json.
  const cmd = [...splitCommand(coreCmd), ...argv, ...(opts.jsonFlag ? ["--json"] : [])];
  let out;
  try {
    out = execFileSync(cmd[0], cmd.slice(1), {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const detail = (e.stdout ? String(e.stdout) : "") + (e.stderr ? String(e.stderr) : "");
    throw new PackError("handoff-core-failed", `${label} failed: ${detail.trim() || e.message}`);
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new PackError("handoff-core-failed", `${label} returned non-JSON output: ${out.slice(0, 400)}`);
  }
}

// --- semantic validation shared by create and validate ---

function validatePackDir(root, opts) {
  const errors = [];
  const manifestPath = path.join(root, "HANDOFF_MANIFEST.json");
  if (!isFile(manifestPath)) {
    return [`missing HANDOFF_MANIFEST.json: ${manifestPath}`];
  }
  const manifest = loadJson(manifestPath, "handoff manifest");
  const g = (o, k) => (o && typeof o === "object" && !Array.isArray(o) ? o[k] : undefined);

  if (g(manifest, "kind") !== "ops.handoff.v1") errors.push("manifest kind must be ops.handoff.v1");

  // Digest recomputation: byte copies made by ops-handoff-core must still
  // match the digests recorded at generate time.
  const srcRefs = g(manifest, "sourceRefs") || {};
  const byteCopies = [
    ["REQUEST.md", g(srcRefs, "request")],
    [path.join("COMMON", "organization-topology.a2ui.jsonl"), g(srcRefs, "organizationTopology")],
  ];
  for (const [relPath, ref] of byteCopies) {
    const p = path.join(root, relPath);
    if (!isFile(p)) {
      errors.push(`missing required file: ${relPath}`);
      continue;
    }
    const want = g(ref, "sha256");
    if (!want) {
      errors.push(`manifest sourceRefs missing sha256 for ${relPath}`);
    } else if (sha256File(p) !== want) {
      errors.push(`digest mismatch: ${relPath} does not match manifest sourceRefs sha256`);
    }
  }

  // Payload: stub is transport-proof only and must not reach delegation.
  const payloadPath = path.join(root, "PAYLOAD", "MANIFEST.json");
  let payload = {};
  if (!isFile(payloadPath)) {
    errors.push("missing PAYLOAD/MANIFEST.json");
  } else {
    payload = loadJson(payloadPath, "payload manifest");
    const payloadKind = String(g(payload, "payloadKind") || "");
    if (payloadKind === "stub" && !opts.allowStub) {
      errors.push("stub payload is not allowed for delegation (pass --allow-stub for transport proofs)");
    }
    const manifestPayloadKind = String(g(g(manifest, "payload"), "payloadKind") || "");
    if (manifestPayloadKind !== payloadKind) {
      errors.push(`payloadKind mismatch: manifest=${manifestPayloadKind} payload=${payloadKind}`);
    }
    const packs = g(payload, "packs");
    if (Array.isArray(packs)) {
      for (const entry of packs) {
        const relPath = String(g(entry, "path") || "");
        const p = path.join(root, relPath);
        if (!relPath || !isFile(p)) {
          errors.push(`payload pack missing: ${relPath || "<no path>"}`);
          continue;
        }
        if (sha256File(p) !== g(entry, "sha256")) {
          errors.push(`digest mismatch: payload pack ${relPath}`);
        }
        if (g(entry, "bytes") !== fs.statSync(p).size) {
          errors.push(`size mismatch: payload pack ${relPath}`);
        }
      }
    }
  }

  // source.manifest.v2 shape + pack digests.
  const srcManifestPath = path.join(root, "COMMON", "source-manifest.json");
  let srcRepos = [];
  if (!isFile(srcManifestPath)) {
    errors.push("missing COMMON/source-manifest.json");
  } else {
    const sm = loadJson(srcManifestPath, "source manifest");
    if (g(sm, "kind") !== "source.manifest.v2") {
      errors.push("source manifest kind must be source.manifest.v2");
    }
    const repos = g(sm, "repos");
    if (!Array.isArray(repos) || repos.length === 0) {
      errors.push("source manifest must declare repos[] (non-empty)");
    } else {
      srcRepos = repos;
      for (const r of repos) {
        const id = String(g(r, "repoId") || "<missing repoId>");
        for (const field of ["repoId", "baseBranch", "baseHead", "candidateHead"]) {
          if (!g(r, field)) errors.push(`source manifest repo ${id}: missing ${field}`);
        }
        for (const field of ["baseHead", "candidateHead"]) {
          const v = g(r, field);
          if (v && !HEX40.test(String(v))) errors.push(`source manifest repo ${id}: ${field} is not a full commit hash`);
        }
        const pack = g(r, "pack") || {};
        const relPath = String(g(pack, "path") || "");
        const p = path.join(root, relPath);
        if (!relPath || !isFile(p)) {
          errors.push(`source manifest repo ${id}: pack missing: ${relPath || "<no path>"}`);
        } else if (sha256File(p) !== g(pack, "sha256")) {
          errors.push(`digest mismatch: source pack for ${id}`);
        }
      }
    }
  }

  // merge.target.v2 shape + cross-check against source manifest.
  const mtPath = path.join(root, "COMMON", "merge-target.json");
  if (!isFile(mtPath)) {
    errors.push("missing COMMON/merge-target.json");
  } else {
    const mt = loadJson(mtPath, "merge target");
    if (g(mt, "kind") !== "merge.target.v2") {
      errors.push("merge target kind must be merge.target.v2");
    }
    if (g(mt, "canonicalMergeAuthorized") !== false) errors.push("merge target must set canonicalMergeAuthorized=false");
    if (g(mt, "pushAuthorized") !== false) errors.push("merge target must set pushAuthorized=false");
    const mtRepos = Array.isArray(g(mt, "repos")) ? g(mt, "repos") : [];
    const srcById = new Map(srcRepos.map((r) => [String(g(r, "repoId")), r]));
    const mtById = new Map(mtRepos.map((r) => [String(g(r, "repoId")), r]));
    for (const id of srcById.keys()) {
      if (!mtById.has(id)) errors.push(`merge target missing repo declared in source manifest: ${id}`);
    }
    for (const [id, r] of mtById) {
      const s = srcById.get(id);
      if (!s) {
        errors.push(`merge target declares repo absent from source manifest: ${id}`);
        continue;
      }
      if (g(r, "baseBranch") !== g(s, "baseBranch")) {
        errors.push(`base branch mismatch for ${id}: merge-target=${g(r, "baseBranch")} source-manifest=${g(s, "baseBranch")}`);
      }
      if (g(r, "baseHead") !== g(s, "baseHead")) {
        errors.push(`base head mismatch for ${id}: merge-target=${g(r, "baseHead")} source-manifest=${g(s, "baseHead")}`);
      }
    }
  }

  // Optional live re-verification against local repos (sender side).
  for (const liveSpec of opts.liveRepos || []) {
    const eq = liveSpec.indexOf("=");
    if (eq <= 0) {
      errors.push(`invalid --repo spec for live check (want repoId=root): ${liveSpec}`);
      continue;
    }
    const id = liveSpec.slice(0, eq);
    const repoRoot = path.resolve(liveSpec.slice(eq + 1));
    const s = srcRepos.find((r) => String(g(r, "repoId")) === id);
    if (!s) {
      errors.push(`live check: repo not in source manifest: ${id}`);
      continue;
    }
    let live;
    try {
      live = resolveCommit(repoRoot, String(g(s, "baseBranch")), `live baseBranch of ${id}`);
    } catch (e) {
      errors.push(e instanceof PackError ? e.msg : String(e));
      continue;
    }
    if (live !== g(s, "baseHead")) {
      errors.push(`live base head drift for ${id}: manifest=${g(s, "baseHead")} live=${live}`);
    }
  }

  return errors;
}

// --- subcommands ---

function create(args) {
  const repoSpecs = (args.repo || []).map(parseRepoSpec);
  if (repoSpecs.length === 0) {
    throw new PackError("missing-required-input", "at least one --repo is required");
  }
  const ids = repoSpecs.map((s) => s.repoId);
  if (new Set(ids).size !== ids.length) {
    throw new PackError("invalid-repo-spec", `duplicate repoId in --repo specs: ${ids.join(", ")}`);
  }

  const roleCatalog = requireFile(args["role-catalog"], "role catalog");
  const topology = requireFile(args.topology, "organization topology");
  const commandBoard = requireFile(args["command-board"], "command board or request record");
  const request = requireFile(args.request, "request");
  const threadRoster = requireFile(args["thread-roster"], "thread roster");

  const outDir = path.resolve(args["out-dir"]);
  if (fs.existsSync(outDir)) {
    if (!args.force) throw new PackError("output-exists", `output directory already exists: ${outDir}`);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  const workDir = path.join(outDir, "work");
  const handoffDir = path.join(outDir, "handoff");
  const srcDir = path.join(workDir, "SRC");
  fs.mkdirSync(srcDir, { recursive: true });

  const repos = repoSpecs.map((spec) => buildRepoEntry(spec, srcDir));

  const sourceManifest = {
    kind: "source.manifest.v2",
    generatedBy: "ops-handoff-pack",
    repos,
  };
  const mergeTarget = {
    kind: "merge.target.v2",
    repos: repos.map((r) => ({
      repoId: r.repoId,
      baseBranch: r.baseBranch,
      baseHead: r.baseHead,
      candidateBranch: r.candidateRef,
    })),
    canonicalMergeAuthorized: false,
    pushAuthorized: false,
  };
  const payloadManifest = {
    kind: "ops.handoff.payloadManifest.v1",
    payloadKind: "src-pack",
    provider: "ops-handoff-pack",
    sourceManifest: "COMMON/source-manifest.json",
    runtimeManifest: "COMMON/runtime-manifest.json",
    packs: repos.map((r) => ({
      repoId: r.repoId,
      path: r.pack.path,
      sha256: r.pack.sha256,
      bytes: r.pack.bytes,
      candidateHead: r.candidateHead,
    })),
  };

  const sourceManifestPath = path.join(workDir, "source-manifest.json");
  const mergeTargetPath = path.join(workDir, "merge-target.json");
  const payloadManifestPath = path.join(workDir, "payload-manifest.json");
  writeJson(sourceManifestPath, sourceManifest);
  writeJson(mergeTargetPath, mergeTarget);
  writeJson(payloadManifestPath, payloadManifest);

  let runtimeManifestPath = args["runtime-manifest"];
  if (runtimeManifestPath) {
    requireFile(runtimeManifestPath, "runtime manifest");
  } else {
    runtimeManifestPath = path.join(workDir, "runtime-manifest.json");
    writeJson(runtimeManifestPath, defaultRuntimeManifest());
  }

  const coreCmd = args["handoff-core"] || "ops-handoff-core";
  const generated = runHandoffCore(
    coreCmd,
    [
      "generate",
      "--role-catalog", roleCatalog,
      "--topology", topology,
      "--command-board", commandBoard,
      "--request", request,
      "--source-manifest", sourceManifestPath,
      "--runtime-manifest", runtimeManifestPath,
      "--merge-target", mergeTargetPath,
      "--thread-roster", threadRoster,
      "--payload-manifest", payloadManifestPath,
      "--out-dir", handoffDir,
    ],
    "ops-handoff-core generate",
    { jsonFlag: true },
  );
  if (generated.status !== "handoff-generated") {
    throw new PackError("handoff-core-failed", `unexpected generate status: ${generated.status}`);
  }

  // Embed the source packs so the handoff directory is self-contained.
  fs.renameSync(srcDir, path.join(handoffDir, "SRC"));

  const coreValidated = runHandoffCore(coreCmd, ["validate", "--handoff-dir", handoffDir], "ops-handoff-core validate");
  if (coreValidated.status !== "handoff-valid") {
    throw new PackError("handoff-core-invalid", `ops-handoff-core validate failed: ${JSON.stringify(coreValidated)}`);
  }

  const errors = validatePackDir(handoffDir, { allowStub: false, liveRepos: [] });
  if (errors.length) {
    process.stdout.write(JSON.stringify({ ok: false, status: "handoff-pack-invalid", errors }, null, 2) + "\n");
    return 1;
  }

  const result = {
    ok: true,
    status: "handoff-pack-created",
    handoffDir,
    coreStatus: "handoff-valid",
    packStatus: "handoff-pack-valid",
    repos: repos.map((r) => ({
      repoId: r.repoId,
      baseBranch: r.baseBranch,
      baseHead: r.baseHead,
      candidateRef: r.candidateRef,
      candidateHead: r.candidateHead,
      pack: r.pack,
    })),
  };
  process.stdout.write((args.json ? JSON.stringify(result, null, 2) : `handoff pack created: ${handoffDir}`) + "\n");
  return 0;
}

function validate(args) {
  const root = path.resolve(args["handoff-dir"]);
  const errors = validatePackDir(root, {
    allowStub: Boolean(args["allow-stub"]),
    liveRepos: args.repo || [],
  });
  if (errors.length) {
    process.stdout.write(JSON.stringify({ ok: false, status: "handoff-pack-invalid", errors }, null, 2) + "\n");
    return 1;
  }
  process.stdout.write(JSON.stringify({ ok: true, status: "handoff-pack-valid", handoffDir: root }, null, 2) + "\n");
  return 0;
}

// --- minimal argv parser (same shape as ops-handoff-core) ---

const STRING_OPTS = {
  create: [
    "role-catalog",
    "topology",
    "command-board",
    "request",
    "thread-roster",
    "runtime-manifest",
    "out-dir",
    "handoff-core",
  ],
  validate: ["handoff-dir"],
};
const BOOL_OPTS = {
  create: ["force", "json"],
  validate: ["allow-stub", "json"],
};
const APPEND_OPTS = {
  create: ["repo"],
  validate: ["repo"],
};

function argError(message) {
  process.stderr.write(`ops-handoff-pack: error: ${message}\n`);
  process.exit(2);
}

function parseSub(command, argv) {
  const args = {};
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
    if (APPEND_OPTS[command].includes(name)) {
      args[name].push(value);
    } else if (STRING_OPTS[command].includes(name)) {
      args[name] = value;
    } else {
      argError(`unrecognized arguments: --${name}`);
    }
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
  if (command === "create" && args["out-dir"] === undefined) {
    argError("the following arguments are required: --out-dir");
  }
  if (command === "validate" && args["handoff-dir"] === undefined) {
    argError("the following arguments are required: --handoff-dir");
  }
  try {
    if (command === "create") return create(args);
    return validate(args);
  } catch (e) {
    if (e instanceof PackError) {
      process.stdout.write(JSON.stringify({ ok: false, status: e.status, error: e.msg }, null, 2) + "\n");
      return 2;
    }
    throw e;
  }
}

process.exit(main(process.argv.slice(2)));
