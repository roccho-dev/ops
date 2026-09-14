import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), "uiops-exact-tree-set-selftest-"));
const contractModules = [
  "contract.mjs",
  "contract-core.mjs",
  "provider-targets.mjs",
  "provider-evidence.mjs",
  "provider-snapshot.mjs",
  "gate-input.mjs",
  "typed-ui-receipt.mjs",
  "typed-ops-receipt.mjs",
  "typed-receipts.mjs",
];
const sourceVerifier = join(here, "verify.mjs");
const sha = (digit) => digit.repeat(40);
const digest = (digit) => `sha256:${digit.repeat(64)}`;
const clone = (value) => structuredClone(value);

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createRepository(name, repository, headFiles) {
  const root = join(fixtureRoot, name);
  mkdirSync(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "UIOPS selftest");
  git(root, "config", "user.email", "uiops-selftest@example.invalid");
  git(root, "remote", "add", "origin", `https://github.com/${repository}.git`);
  write(join(root, "BASE"), `${repository}\n`);
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", "base");
  const base = { commit: git(root, "rev-parse", "HEAD"), tree: git(root, "rev-parse", "HEAD^{tree}") };
  for (const [path, content] of Object.entries(headFiles)) write(join(root, path), content);
  git(root, "add", "--all");
  git(root, "commit", "-q", "-m", "candidate");
  const terminal = { head: git(root, "rev-parse", "HEAD"), tree: git(root, "rev-parse", "HEAD^{tree}") };
  return { root, base, terminal, evaluated: { commit: terminal.head, tree: terminal.tree } };
}

const presentationStub = `#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
for (const key of ["--mobile-agent-root", "--ui-root", "--work-root"]) assert(args.has(key), \`missing \${key}\`);
const git = (root, ...rest) => execFileSync("git", ["-C", root, ...rest], { encoding: "utf8" }).trim();
const work = args.get("--work-root");
mkdirSync(work);
const receipt = {
  schema: "roccho.presentation-shared-visual-closure/1",
  status: "PASS",
  repositories: {
    mobileAgent: { head: git(args.get("--mobile-agent-root"), "rev-parse", "HEAD"), tree: git(args.get("--mobile-agent-root"), "rev-parse", "HEAD^{tree}") },
    ui: { head: git(args.get("--ui-root"), "rev-parse", "HEAD"), tree: git(args.get("--ui-root"), "rev-parse", "HEAD^{tree}") },
  },
};
writeFileSync(work + "/presentation-shared-visual.receipt.json", JSON.stringify(receipt) + "\\n", { flag: "wx" });
`;

const gateFixtureFiles = Object.fromEntries(contractModules.map((name) => [
  `verification/uiops-207-377-exact-tree-set/${name}`,
  readFileSync(join(here, name), "utf8"),
]));
const ops = createRepository("ops", "roccho-dev/ops", {
  ...gateFixtureFiles,
  "verification/uiops-207-377-exact-tree-set/verify.mjs": readFileSync(sourceVerifier, "utf8"),
  "verification/presentation-shared-visual/verify.mjs": presentationStub,
  "verification/policy-app/validate-consumer.mjs": "export const status = 'PASS';\n",
});
const ui = createRepository("ui", "roccho-dev/ui", {
  "verification/policy-app-publication/validate.mjs": "export const status = 'PASS';\n",
});
const mobile = createRepository("mobile-agent", "roccho-dev/mobile-agent", {
  "packages/app/artifact-module.js": "export const fixture = true;\n",
});

export { clone, contractModules, digest, fixtureRoot, git, here, mobile, ops, sha, sourceVerifier, ui };
