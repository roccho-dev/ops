import * as std from "qjs:std";

import { parseArgs, run } from "./lib.mjs";
import { fileSha256, fileSize, git, gitRevParse, nowIso, runCapture, writeJson } from "./host-git-ops.mjs";
import { mkdirp } from "./fs.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-source-snapshot-text.mjs --repo <repo> --outDir <dir> [--epoch <n>] [--snapshotName repo-snapshot-current.txt] [--manifestName SOURCE_MANIFEST.json] [--maxBytes <n>] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      repo: null,
      outDir: null,
      epoch: null,
      snapshotName: "repo-snapshot-current.txt",
      manifestName: "SOURCE_MANIFEST.json",
      maxBytes: 1024 * 1024,
      json: false,
    },
    flags: {
      repo: { required: true },
      outDir: { required: true },
      epoch: {},
      snapshotName: {},
      manifestName: {},
      maxBytes: { type: "number" },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function isProbablyText(s) {
  return !String(s || "").includes("\x00");
}

function main(args) {
  mkdirp(args.outDir);
  const baseRev = gitRevParse(args.repo, "HEAD");
  const files = git(args.repo, ["ls-files"]).out.split("\n").map((s) => s.trim()).filter(Boolean);
  const createdAt = nowIso();
  const epoch = args.epoch || createdAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  let text = "";
  text += `CDP_PROJECT_SOURCE_SNAPSHOT\n`;
  text += `epoch: ${epoch}\n`;
  text += `baseRev: ${baseRev}\n`;
  text += `createdAt: ${createdAt}\n`;
  text += `repo: ${args.repo}\n`;
  text += `trackedFiles: ${files.length}\n\n`;
  const included = [];
  const skipped = [];
  for (const path of files) {
    const abs = `${args.repo}/${path}`;
    let body = "";
    try { body = String(std.loadFile(abs) || ""); } catch (e) {
      skipped.push({ path, reason: String(e && e.message ? e.message : e) });
      continue;
    }
    if (!isProbablyText(body)) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    if (body.length > args.maxBytes) {
      skipped.push({ path, reason: "too_large", bytes: body.length });
      continue;
    }
    text += `--- FILE ${path} ---\n`;
    text += body;
    if (!body.endsWith("\n")) text += "\n";
    text += `--- END ${path} ---\n\n`;
    included.push({ path, bytes: body.length });
  }
  const snapshotPath = `${args.outDir}/${args.snapshotName}`;
  std.writeFile(snapshotPath, text);
  const manifest = {
    epoch,
    baseRev,
    createdAt,
    snapshotFile: args.snapshotName,
    snapshotSha256: fileSha256(snapshotPath),
    snapshotBytes: fileSize(snapshotPath),
    trackedFiles: files.length,
    includedFiles: included,
    skippedFiles: skipped,
    rule: "Project Sources are shared context only; host git repo remains the source of truth.",
  };
  const manifestPath = `${args.outDir}/${args.manifestName}`;
  writeJson(manifestPath, manifest);
  const out = { ok: true, repo: args.repo, outDir: args.outDir, snapshotPath, manifestPath, manifest };
  if (args.json) std.out.puts(JSON.stringify(out, null, 2) + "\n");
  else {
    std.out.puts(`snapshot=${snapshotPath}\n`);
    std.out.puts(`manifest=${manifestPath}\n`);
    std.out.puts(`baseRev=${baseRev}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
