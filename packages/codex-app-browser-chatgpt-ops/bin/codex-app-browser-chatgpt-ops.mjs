#!/usr/bin/env node
import {
  buildSessionPrompt,
  buildPrFlow,
  parseArgs,
  reviewProposal,
  slugifyTitle,
} from "../lib/core.mjs";

function usage() {
  console.error(`usage:
  codex-app-browser-chatgpt-ops prompt --title <title> [--task <text>]
  codex-app-browser-chatgpt-ops slug --title <title> [--date yymmdd]
  codex-app-browser-chatgpt-ops pr-flow --session-title <title> --session-url <url> --repository <owner/repo> [--base-branch proposals] [--head-branch branch]
  codex-app-browser-chatgpt-ops review-fixture`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (command === "prompt") {
  requireArg(args, "title");
  console.log(buildSessionPrompt({ title: args.title, task: args.task }));
} else if (command === "slug") {
  requireArg(args, "title");
  console.log(slugifyTitle(args.title, { date: args.date }));
} else if (command === "pr-flow") {
  for (const key of ["session-title", "session-url", "repository"]) {
    requireArg(args, key);
  }
  console.log(JSON.stringify(buildPrFlow({
    sessionTitle: args["session-title"],
    sessionUrl: args["session-url"],
    repository: args.repository,
    baseBranch: args["base-branch"],
    headBranch: args["head-branch"],
    summary: args.summary,
    changes: args.changes,
  }), null, 2));
} else if (command === "review-fixture") {
  const flow = buildPrFlow({
    sessionTitle: "envs: proposal PR template",
    sessionUrl: "https://chatgpt.com/example",
    repository: "roccho-dev/envs",
    baseBranch: "proposals",
    headBranch: "proposal/envs-proposal-pr-template-260625",
    summary: "Add an envs pull request template.",
    changes: ["Add .github/pull_request_template.md."],
  });
  const review = reviewProposal({
    title: flow.title,
    body: flow.body,
    baseBranch: flow.baseBranch,
    headBranch: flow.headBranch,
    sessionTitle: flow.title,
  });
  console.log(JSON.stringify(review, null, 2));
  process.exit(review.ok ? 0 : 1);
} else {
  usage();
}

function requireArg(values, key) {
  if (!values[key]) {
    console.error(`missing --${key}`);
    usage();
  }
}
