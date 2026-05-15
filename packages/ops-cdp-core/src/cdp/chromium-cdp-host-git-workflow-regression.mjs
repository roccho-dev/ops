import * as os from "qjs:os";
import * as std from "qjs:std";

import { parseArgs, run } from "./lib.mjs";
import { fileSha256, gitRevParse, pathExists, readJson, runCapture } from "./host-git-ops.mjs";
import { mkdirp } from "./fs.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-host-git-workflow-regression.mjs [--keep] [--tmpDir <dir>] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      keep: false,
      tmpDir: null,
      json: false,
    },
    flags: {
      keep: { type: "boolean" },
      tmpDir: {},
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function scriptPath(name) {
  const root = String(std.getenv("HQ_CDP_SCRIPT_SRC") || "");
  return root ? `${root}/${name}` : `parts/cdp/${name}`;
}

function qjsBin() {
  return String(std.getenv("HQ_CDP_QJS") || "qjs");
}

function qjsJson(name, args) {
  const r = runCapture([qjsBin(), "--std", "-m", scriptPath(name), ...args]);
  try {
    return JSON.parse(r.out);
  } catch (e) {
    throw new Error(`failed to parse JSON from ${name}: ${String(e)}\n${r.out}`);
  }
}

function assertCase(cases, name, condition, detail) {
  const ok = !!condition;
  cases.push({ name, ok, detail: detail || null });
  if (!ok) throw new Error(`regression failed: ${name}${detail ? `: ${detail}` : ""}`);
}

function write(path, text) {
  std.writeFile(path, String(text));
}

function makeRepo(root) {
  const repo = `${root}/repo`;
  mkdirp(`${repo}/src`);
  mkdirp(`${repo}/scripts`);
  runCapture(["git", "init", "-q", repo]);
  runCapture(["git", "-C", repo, "config", "user.email", "cdp-regression@example.invalid"]);
  runCapture(["git", "-C", repo, "config", "user.name", "CDP Regression"]);
  write(`${repo}/src/a.txt`, "alpha: base\n");
  write(`${repo}/src/b.txt`, "bravo: base\n");
  write(`${repo}/README.md`, "# cdp regression\n");
  write(`${repo}/scripts/test.sh`, "#!/usr/bin/env bash\nset -euo pipefail\ngrep -q '^alpha:' src/a.txt\ngrep -q '^bravo:' src/b.txt\n");
  runCapture(["chmod", "+x", `${repo}/scripts/test.sh`]);
  runCapture("printf 'abc\\000def' > " + `${repo}/src/binary.dat`);
  runCapture(["git", "-C", repo, "add", "-A"]);
  runCapture(["git", "-C", repo, "commit", "-q", "-m", "init"]);
  return repo;
}

function makeArtifacts(root, baseRev) {
  const dir = `${root}/artifacts`;
  mkdirp(dir);
  write(`${dir}/thread-a.result.json`, JSON.stringify({
    worker: "thread-a",
    baseRev,
    status: "ready",
    filesChanged: ["src/a.txt"],
  }, null, 2) + "\n");
  write(`${dir}/thread-a.changes.patch`, [
    "diff --git a/src/a.txt b/src/a.txt",
    "index 2e23f21..e48bcb8 100644",
    "--- a/src/a.txt",
    "+++ b/src/a.txt",
    "@@ -1 +1 @@",
    "-alpha: base",
    "+alpha: worker-a",
    "",
  ].join("\n"));
  write(`${dir}/thread-b.result.json`, JSON.stringify({
    worker: "thread-b",
    baseRev,
    status: "ready",
    filesChanged: ["src/b.txt"],
  }, null, 2) + "\n");
  write(`${dir}/thread-b.changes.patch`, [
    "--- a/src/b.txt",
    "+++ b/src/b.txt",
    "@@ -1 +1 @@",
    "-bravo: base",
    "+bravo: worker-b",
    "",
  ].join("\n"));
  return dir;
}

function makeAmArtifacts(root, repo, baseRev) {
  const dir = `${root}/am-artifacts`;
  const author = `${root}/am-author`;
  mkdirp(dir);
  runCapture(["git", "-C", repo, "worktree", "add", "-q", "-B", "author/am-series", author, baseRev]);
  runCapture(["git", "-C", author, "config", "user.email", "cdp-regression@example.invalid"]);
  runCapture(["git", "-C", author, "config", "user.name", "CDP Regression"]);
  write(`${author}/src/a.txt`, "alpha: am-one\n");
  runCapture(["git", "-C", author, "add", "src/a.txt"]);
  runCapture(["git", "-C", author, "commit", "-q", "-m", "Change alpha line"]);
  write(`${author}/src/b.txt`, "bravo: am-two\n");
  runCapture(["git", "-C", author, "add", "src/b.txt"]);
  runCapture(["git", "-C", author, "commit", "-q", "-m", "Change bravo line"]);
  const mbox = runCapture(["git", "-C", author, "format-patch", "--stdout", `${baseRev}..HEAD`]).out;
  write(`${dir}/thread-am.series.mbox`, mbox);
  write(`${dir}/thread-am.series.json`, JSON.stringify({
    worker: "thread-am",
    baseRev,
    newHead: gitRevParse(author, "HEAD"),
    status: "ready",
    patchFormat: "git-format-patch-mbox",
    patchCount: 2,
    filesChanged: ["src/a.txt", "src/b.txt"],
  }, null, 2) + "\n");
  return { dir };
}

function makeBundleArtifact(root, repo, baseRev) {
  const dir = `${root}/bundle-artifacts`;
  const author = `${root}/bundle-author`;
  const sourceBranch = "worker/package-bundle-source";
  mkdirp(dir);
  runCapture(["git", "-C", repo, "worktree", "add", "-q", "-B", sourceBranch, author, baseRev]);
  runCapture(["git", "-C", author, "config", "user.email", "cdp-regression@example.invalid"]);
  runCapture(["git", "-C", author, "config", "user.name", "CDP Regression"]);
  write(`${author}/src/a.txt`, "alpha: bundle\n");
  write(`${author}/src/b.txt`, "bravo: bundle\n");
  runCapture(["git", "-C", author, "add", "src/a.txt", "src/b.txt"]);
  runCapture(["git", "-C", author, "commit", "-q", "-m", "Bundle worker changes"]);
  const newHead = gitRevParse(author, "HEAD");
  const bundlePath = `${dir}/thread-bundle.repo.bundle`;
  runCapture(["git", "-C", repo, "bundle", "create", bundlePath, sourceBranch]);
  write(`${dir}/thread-bundle.result.json`, JSON.stringify({
    worker: "thread-bundle",
    baseRev,
    newHead,
    status: "ready",
    artifactFormat: "git-bundle",
    bundleRef: sourceBranch,
    filesChanged: ["src/a.txt", "src/b.txt"],
  }, null, 2) + "\n");
  return { dir, bundlePath, sourceBranch, newHead };
}

function main(args) {
  const root = args.tmpDir || `/tmp/cdp-host-git-regression-${os.getpid()}-${Date.now()}`;
  mkdirp(root);
  const cases = [];
  const repo = makeRepo(root);
  const baseRev = gitRevParse(repo, "HEAD");
  const artifacts = makeArtifacts(root, baseRev);
  const amArtifacts = makeAmArtifacts(root, repo, baseRev);
  const bundleArtifacts = makeBundleArtifact(root, repo, baseRev);
  const sources = `${root}/sources`;
  const downloads = `${root}/downloads`;
  const out = `${root}/out`;
  mkdirp(sources);
  mkdirp(downloads);
  mkdirp(out);

  const snapshot1 = qjsJson("chromium-cdp-source-snapshot-text.mjs", [
    "--repo", repo,
    "--outDir", sources,
    "--epoch", "1",
    "--snapshotName", "repo-snapshot-epoch-1.txt",
    "--manifestName", "SOURCE_MANIFEST.epoch-1.json",
    "--json",
  ]);
  assertCase(cases, "snapshot manifest uses current baseRev", snapshot1.manifest.baseRev === baseRev, snapshot1.manifest.baseRev);
  assertCase(cases, "snapshot uses epoch-specific filenames",
    snapshot1.manifest.snapshotFile === "repo-snapshot-epoch-1.txt" && snapshot1.manifestPath.endsWith("SOURCE_MANIFEST.epoch-1.json"),
    JSON.stringify({ snapshotFile: snapshot1.manifest.snapshotFile, manifestPath: snapshot1.manifestPath }));
  const snapshotText = String(std.loadFile(snapshot1.snapshotPath) || "");
  assertCase(cases, "snapshot contains text source", snapshotText.includes("--- FILE src/a.txt ---"), null);
  assertCase(cases, "snapshot skips binary source", snapshot1.manifest.skippedFiles.some((row) => row.path === "src/binary.dat"), null);

  write(`${downloads}/result.json`, "old-a\n");
  write(`${downloads}/result (1).json`, "old-b\n");
  const quarantine = qjsJson("chromium-cdp-downloads-quarantine.mjs", [
    "--downloadsDir", downloads,
    "--name", "result.json",
    "--json",
  ]);
  assertCase(cases, "stale same-name downloads are quarantined", quarantine.moved.length === 2, JSON.stringify(quarantine.moved));

  const validateA = qjsJson("chromium-cdp-worker-artifact-validate.mjs", [
    "--repo", repo,
    "--result", `${artifacts}/thread-a.result.json`,
    "--patch", `${artifacts}/thread-a.changes.patch`,
    "--expectedBaseRev", baseRev,
    "--worker", "thread-a",
    "--json",
  ]);
  assertCase(cases, "worker-a artifact validates", validateA.ok === true, JSON.stringify(validateA.errors));
  const validateB = qjsJson("chromium-cdp-worker-artifact-validate.mjs", [
    "--repo", repo,
    "--result", `${artifacts}/thread-b.result.json`,
    "--patch", `${artifacts}/thread-b.changes.patch`,
    "--expectedBaseRev", baseRev,
    "--worker", "thread-b",
    "--json",
  ]);
  assertCase(cases, "worker-b patch without diff header validates by git apply", validateB.ok === true && validateB.patch.hasDiffHeader === false, JSON.stringify(validateB));

  const amApply = qjsJson("chromium-cdp-worker-am-apply.mjs", [
    "--repo", repo,
    "--worktree", `${repo}/.worktrees/thread-am`,
    "--branch", "worker/thread-am",
    "--series", `${amArtifacts.dir}/thread-am.series.json`,
    "--mbox", `${amArtifacts.dir}/thread-am.series.mbox`,
    "--baseRef", baseRev,
    "--expectedBaseRev", baseRev,
    "--json",
  ]);
  assertCase(cases, "worker-am git format-patch series applies with git am",
    amApply.ok === true && amApply.patchCount === 2 && amApply.commits.length === 2,
    JSON.stringify(amApply));
  const amSubjects = runCapture(["git", "-C", `${repo}/.worktrees/thread-am`, "log", "--format=%s", "--reverse", `${baseRev}..HEAD`]).out.trim();
  assertCase(cases, "worker-am preserves patch series order and subjects",
    amSubjects === "Change alpha line\nChange bravo line",
    amSubjects);
  assertCase(cases, "worker-am worktree test sees both patch commits",
    String(std.loadFile(`${repo}/.worktrees/thread-am/src/a.txt`) || "").includes("am-one") &&
    String(std.loadFile(`${repo}/.worktrees/thread-am/src/b.txt`) || "").includes("am-two"),
    amApply.head);

  const packagePatch = qjsJson("chromium-cdp-package-run.mjs", [
    "--repo", repo,
    "--worktree", `${repo}/.worktrees/package-patch`,
    "--branch", "worker/package-patch",
    "--result", `${artifacts}/thread-a.result.json`,
    "--patch", `${artifacts}/thread-a.changes.patch`,
    "--expectedBaseRev", baseRev,
    "--json",
  ]);
  assertCase(cases, "package-run applies patch artifact through host orchestration",
    packagePatch.ok === true && packagePatch.format === "patch" && packagePatch.applied && packagePatch.applied.action === "applied-patch" && packagePatch.applied.commit,
    JSON.stringify(packagePatch));

  const packageMbox = qjsJson("chromium-cdp-package-run.mjs", [
    "--repo", repo,
    "--worktree", `${repo}/.worktrees/package-mbox`,
    "--branch", "worker/package-mbox",
    "--series", `${amArtifacts.dir}/thread-am.series.json`,
    "--mbox", `${amArtifacts.dir}/thread-am.series.mbox`,
    "--expectedBaseRev", baseRev,
    "--json",
  ]);
  assertCase(cases, "package-run applies mbox artifact through host orchestration",
    packageMbox.ok === true && packageMbox.format === "mbox" && packageMbox.applied && packageMbox.applied.patchCount === 2,
    JSON.stringify(packageMbox));

  const packageBundle = qjsJson("chromium-cdp-package-run.mjs", [
    "--repo", repo,
    "--worktree", `${repo}/.worktrees/package-bundle`,
    "--branch", "worker/package-bundle",
    "--result", `${bundleArtifacts.dir}/thread-bundle.result.json`,
    "--bundle", bundleArtifacts.bundlePath,
    "--expectedBaseRev", baseRev,
    "--json",
  ]);
  assertCase(cases, "package-run applies git bundle artifact through host orchestration",
    packageBundle.ok === true && packageBundle.format === "bundle" && packageBundle.applied && packageBundle.applied.head === bundleArtifacts.newHead,
    JSON.stringify(packageBundle));
  assertCase(cases, "package-run bundle worktree materializes bundle files",
    String(std.loadFile(`${repo}/.worktrees/package-bundle/src/a.txt`) || "").includes("bundle") &&
    String(std.loadFile(`${repo}/.worktrees/package-bundle/src/b.txt`) || "").includes("bundle"),
    packageBundle.applied ? packageBundle.applied.head : null);

  const applyA = qjsJson("chromium-cdp-worker-apply.mjs", [
    "--repo", repo,
    "--worktree", `${repo}/.worktrees/thread-a`,
    "--branch", "worker/thread-a",
    "--result", `${artifacts}/thread-a.result.json`,
    "--patch", `${artifacts}/thread-a.changes.patch`,
    "--expectedBaseRev", baseRev,
    "--json",
  ]);
  assertCase(cases, "worker-a applies and commits", applyA.ok === true && applyA.commit, JSON.stringify(applyA));
  const applyB = qjsJson("chromium-cdp-worker-apply.mjs", [
    "--repo", repo,
    "--worktree", `${repo}/.worktrees/thread-b`,
    "--branch", "worker/thread-b",
    "--result", `${artifacts}/thread-b.result.json`,
    "--patch", `${artifacts}/thread-b.changes.patch`,
    "--expectedBaseRev", baseRev,
    "--json",
  ]);
  assertCase(cases, "worker-b applies and commits", applyB.ok === true && applyB.commit, JSON.stringify(applyB));

  const exclude = String(std.loadFile(`${repo}/.git/info/exclude`) || "");
  assertCase(cases, "repo excludes .worktrees", exclude.includes(".worktrees/"), exclude);

  const merge = qjsJson("chromium-cdp-worker-merge-queue.mjs", [
    "--repo", repo,
    "--target", "master",
    "--branch", "worker/thread-a",
    "--branch", "worker/thread-b",
    "--json",
  ]);
  assertCase(cases, "worker branches merge into host repo", merge.ok === true && merge.merged.length === 2, JSON.stringify(merge));
  const mergedHead = gitRevParse(repo, "HEAD");
  assertCase(cases, "merged files contain both worker changes",
    String(std.loadFile(`${repo}/src/a.txt`) || "").includes("worker-a") &&
    String(std.loadFile(`${repo}/src/b.txt`) || "").includes("worker-b"),
    mergedHead);

  const snapshot2 = qjsJson("chromium-cdp-source-snapshot-text.mjs", [
    "--repo", repo,
    "--outDir", `${root}/sources2`,
    "--epoch", "2",
    "--snapshotName", "repo-snapshot-epoch-2.txt",
    "--manifestName", "SOURCE_MANIFEST.epoch-2.json",
    "--json",
  ]);
  assertCase(cases, "post-merge snapshot baseRev updates", snapshot2.manifest.baseRev === mergedHead, snapshot2.manifest.baseRev);

  const reread = qjsJson("chromium-cdp-project-source-reread.mjs", [
    "--projectUrl", "https://chatgpt.com/g/g-p-project/project",
    "--url", "https://chatgpt.com/g/g-p-project/c/thread-a",
    "--url", "https://chatgpt.com/g/g-p-project/c/thread-b",
    "--manifest", "SOURCE_MANIFEST.epoch-2.json",
    "--epoch", "2",
    "--baseRev", mergedHead,
    "--intervalMs", "0",
    "--dryRun",
    "--json",
  ]);
  assertCase(cases, "reread dry-run targets both threads", reread.ok === true && reread.count === 2, JSON.stringify(reread));
  assertCase(cases, "reread message requires Project Sources reread",
    reread.message.includes("Project Sources") && reread.message.includes("読み直") && reread.message.includes("SOURCE_MANIFEST.epoch-2.json"),
    reread.message);
  assertCase(cases, "reread message rejects similar stale source names",
    reread.message.includes("exact filename") && reread.message.includes("似た名前") && reread.message.includes("旧epoch"),
    reread.message);

  const plan = qjsJson("chromium-cdp-host-git-two-worker-smoke.mjs", [
    "--repo", repo,
    "--outDir", `${root}/plan`,
    "--json",
  ]);
  assertCase(cases, "two-worker plan uses unique artifact names",
    plan.workers[0].expectedArtifactNames.includes("thread-a.result.json") &&
    plan.workers[1].expectedArtifactNames.includes("thread-b.result.json"),
    JSON.stringify(plan.workers));
  assertCase(cases, "two-worker plan uses epoch-specific source names",
    plan.sourceFiles.snapshot === "repo-snapshot-epoch-1.txt" &&
    plan.sourceFiles.manifest === "SOURCE_MANIFEST.epoch-1.json" &&
    plan.commands.snapshot.includes("--snapshotName repo-snapshot-epoch-1.txt"),
    JSON.stringify(plan.sourceFiles));
  assertCase(cases, "two-worker plan includes artifact wait command",
    String(plan.commands.waitArtifacts || "").includes("chromium-cdp-wait-artifacts") &&
    String(plan.commands.waitArtifacts || "").includes("--intervalMs 600000") &&
    String(plan.commands.waitArtifacts || "").includes("--timeoutMs 1800000"),
    String(plan.commands.waitArtifacts || ""));
  assertCase(cases, "two-worker plan baseRev is current host head", plan.baseRev === mergedHead, plan.baseRev);

  const downloadSource = String(std.loadFile(scriptPath("download-chatgpt-artifacts.mjs")) || "");
  assertCase(cases, "download default is HOME/Downloads, not /Downloads",
    downloadSource.includes("`${home}/Downloads`") && !downloadSource.includes("home ? `/Downloads`"),
    null);

  const staleRepo = `${root}/stale-ref-repo`;
  mkdirp(staleRepo);
  runCapture(["git", "init", "-q", staleRepo]);
  runCapture(["git", "-C", staleRepo, "config", "user.email", "cdp-regression@example.invalid"]);
  runCapture(["git", "-C", staleRepo, "config", "user.name", "CDP Regression"]);
  write(`${staleRepo}/README.md`, "stale ref demo\n");
  runCapture(["git", "-C", staleRepo, "add", "README.md"]);
  runCapture(["git", "-C", staleRepo, "commit", "-q", "-m", "init"]);
  mkdirp(`${staleRepo}/.git/refs/heads`);
  write(`${staleRepo}/.git/refs/heads/stale-demo`, "0000000000000000000000000000000000000001\n");
  const staleHealthRaw = runCapture([
    qjsBin(), "--std", "-m", scriptPath("chromium-cdp-git-ref-health.mjs"),
    "--repo", staleRepo,
    "--json",
  ], { check: false });
  const staleHealth = JSON.parse(staleHealthRaw.out);
  assertCase(cases, "git ref health detects stale loose refs before git+file validation",
    staleHealthRaw.rc === 1 &&
    staleHealth.ok === false &&
    Array.isArray(staleHealth.invalidRefs) &&
    staleHealth.invalidRefs.some((row) => row.ref === "refs/heads/stale-demo") &&
    staleHealth.advice.join("\n").includes("path:$PWD#"),
    JSON.stringify(staleHealth));


  const hostWorkflowDoc = String(std.loadFile(scriptPath("docs/host-git-project-workflow.md")) || "");
  assertCase(cases, "package-run artifact contract is host orchestration",
    hostWorkflowDoc.includes("cdp/package-run") &&
    hostWorkflowDoc.includes("host orchestration") &&
    hostWorkflowDoc.includes("patch") &&
    hostWorkflowDoc.includes("mbox") &&
    hostWorkflowDoc.includes("bundle") &&
    hostWorkflowDoc.includes("result.json"),
    null);

  const result = {
    ok: cases.every((row) => row.ok),
    root,
    repo,
    baseRev,
    mergedHead,
    cases,
    keep: args.keep,
    snapshotSha256: fileSha256(snapshot2.snapshotPath),
  };

  if (!args.keep && !args.tmpDir) {
    runCapture(["rm", "-rf", root], { check: false });
    result.cleaned = true;
  }

  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else {
    for (const row of cases) std.out.puts(`${row.ok ? "PASS" : "FAIL"} ${row.name}\n`);
    std.out.puts(`ok=${result.ok}\n`);
  }
  return result.ok ? 0 : 1;
}

run(scriptArgs, { usage, buildArgs, main });
