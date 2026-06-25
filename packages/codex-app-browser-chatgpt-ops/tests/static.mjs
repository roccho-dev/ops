import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  buildPrFlow,
  buildSessionPrompt,
  reviewProposal,
  slugifyTitle,
} from "../lib/core.mjs";
import { INIT_PROJECT_URL } from "../lib/codex-app-browser.mjs";

assert.equal(
  buildSessionPrompt({ title: "envs: proposal PR template", task: "source session" }),
  "セッション名を「envs: proposal PR template」に固定してください。\nこのセッション名をGitHub PR提出名として使います。\nタスク: source session",
);
assert.equal(
  slugifyTitle("envs: proposal PR template", { date: "260625" }),
  "proposal/envs-proposal-pr-template-260625",
);
assert.ok(INIT_PROJECT_URL.includes("chatgpt.com/"));

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
assert.equal(review.ok, true, JSON.stringify(review.findings));

const cli = spawnSync("codex-app-browser-chatgpt-ops", ["review-fixture"], {
  encoding: "utf8",
});
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
assert.match(cli.stdout, /"ok": true/);

console.log(JSON.stringify({ ok: true, package: "codex-app-browser-chatgpt-ops" }));
