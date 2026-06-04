import * as std from "./qjs-compat/std.mjs";

import { parseArgs, run } from "./lib.mjs";
import { gitRevParse, nowIso, writeJson } from "./core/host-git.mjs";
import { mkdirp } from "./core/io.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-host-git-two-worker-smoke.mjs --repo <repo> --outDir <dir> [--projectUrl <url>] [--workerA thread-a] [--workerB thread-b] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      repo: null,
      outDir: null,
      projectUrl: null,
      workerA: "thread-a",
      workerB: "thread-b",
      json: false,
    },
    flags: {
      repo: { required: true },
      outDir: { required: true },
      projectUrl: {},
      workerA: {},
      workerB: {},
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
  });
}

function sourceNames(epoch) {
  return {
    snapshot: `repo-snapshot-epoch-${epoch}.txt`,
    manifest: `SOURCE_MANIFEST.epoch-${epoch}.json`,
  };
}

function workerPrompt(worker, file, value, baseRev, names) {
  return [
    `あなたは ${worker} です。`,
    "同じProject内のProject Sourcesを必ず読み直してください。",
    "MCPは使わず、Project Sourcesのsnapshotだけを背景にしてください。",
    `必ず ${names.manifest} と ${names.snapshot} だけを使ってください。同名や旧epochのsourceは無視してください。`,
    `baseRev は ${baseRev} です。`,
    `担当: ${file} の1行を ${value} に変更するpatchだけを作ってください。`,
    "成果artifact名は必ず一意にしてください。",
    `- ${worker}.result.json`,
    `- ${worker}.changes.patch`,
    "result.jsonには worker, baseRev, status, filesChanged を入れてください。",
    "changes.patchは git apply 可能なpatchにしてください。",
  ].join("\n");
}

function main(args) {
  mkdirp(args.outDir);
  const baseRev = gitRevParse(args.repo, "HEAD");
  const createdAt = nowIso();
  const initialEpoch = 1;
  const names = sourceNames(initialEpoch);
  const plan = {
    ok: true,
    createdAt,
    repo: args.repo,
    projectUrl: args.projectUrl || null,
    baseRev,
    dirs: {
      downloads: `${args.outDir}/downloads`,
      inbox: `${args.outDir}/inbox`,
      sources: `${args.outDir}/sources`,
      worktreeA: `${args.repo}/.worktrees/${args.workerA}`,
      worktreeB: `${args.repo}/.worktrees/${args.workerB}`,
    },
    workers: [
      {
        name: args.workerA,
        branch: `worker/${args.workerA}`,
        file: "src/a.txt",
        expectedArtifactNames: [`${args.workerA}.result.json`, `${args.workerA}.changes.patch`],
        promptPath: `${args.outDir}/${args.workerA}.prompt.txt`,
      },
      {
        name: args.workerB,
        branch: `worker/${args.workerB}`,
        file: "src/b.txt",
        expectedArtifactNames: [`${args.workerB}.result.json`, `${args.workerB}.changes.patch`],
        promptPath: `${args.outDir}/${args.workerB}.prompt.txt`,
      },
    ],
    commands: {
      snapshot: `chromium-cdp-source-snapshot-text --repo ${args.repo} --outDir ${args.outDir}/sources --epoch ${initialEpoch} --snapshotName ${names.snapshot} --manifestName ${names.manifest}`,
      uploadSources: args.projectUrl
        ? [
            `chromium-cdp-upload-project-source-text --projectUrl ${args.projectUrl} --file ${args.outDir}/sources/${names.snapshot}`,
            `chromium-cdp-upload-project-source-text --projectUrl ${args.projectUrl} --file ${args.outDir}/sources/${names.manifest}`,
          ]
        : [],
      waitArtifacts: "chromium-cdp-wait-artifacts --url <thread-url> --name <worker>.result.json --name <worker>.changes.patch --intervalMs 600000 --timeoutMs 1800000",
      fetchStrict: "chromium-cdp-fetch-artifact-strict --url <thread-url> --name <unique-artifact-name> --outDir <worker-download-dir>",
      validate: "chromium-cdp-worker-artifact-validate --repo <worktree-or-repo> --result <result.json> --patch <changes.patch> --expectedBaseRev <baseRev>",
      apply: "chromium-cdp-worker-apply --repo <repo> --worktree <repo>/.worktrees/<worker> --branch worker/<worker> --result <result.json> --patch <changes.patch> --expectedBaseRev <baseRev>",
      merge: "chromium-cdp-worker-merge-queue --repo <repo> --branch worker/thread-a --branch worker/thread-b",
      reread: "chromium-cdp-project-source-reread --projectUrl <project-url> --url <thread-url> --manifest SOURCE_MANIFEST.epoch-<new-epoch>.json --epoch <new-epoch> --baseRev <merged-head>",
    },
    sourceFiles: {
      rule: "Project Sources are append-like in practice. Use epoch-specific filenames and tell workers the exact manifest/snapshot names.",
      initialEpoch,
      snapshot: names.snapshot,
      manifest: names.manifest,
    },
  };
  std.writeFile(plan.workers[0].promptPath, workerPrompt(args.workerA, "src/a.txt", "alpha: worker-a", baseRev, names));
  std.writeFile(plan.workers[1].promptPath, workerPrompt(args.workerB, "src/b.txt", "bravo: worker-b", baseRev, names));
  writeJson(`${args.outDir}/two-worker-plan.json`, plan);
  if (args.json) std.out.puts(JSON.stringify(plan, null, 2) + "\n");
  else {
    std.out.puts(`plan=${args.outDir}/two-worker-plan.json\n`);
    std.out.puts(`promptA=${plan.workers[0].promptPath}\n`);
    std.out.puts(`promptB=${plan.workers[1].promptPath}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
