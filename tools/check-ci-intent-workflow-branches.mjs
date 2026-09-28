#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? ".");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const loadJsonl = (relative) => read(relative)
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${relative}:${index + 1}: ${error.message}`);
    }
  });

const records = loadJsonl("ci.intent.v1.jsonl")
  .filter((record) => record.kind === "ci.intent.v1" && record.provider === "github-actions");
const boundaries = loadJsonl("contracts/secret-effect-boundary.v1.jsonl")
  .filter((record) => record.kind === "ops.secretEffectBoundary.v1");
const boundaryByPath = new Map(boundaries.map((record) => [record.path, record]));
const failures = [];
const indent = (line) => line.match(/^(\s*)/)[1].length;
const SHA40 = /^[0-9a-f]{40}$/;

function triggerBlock(text, trigger) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^(\\s*)${trigger}:\\s*(?:#.*)?$`));
    if (!match) continue;
    const base = match[1].length;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (indent(line) <= base) break;
      body.push(line);
    }
    return body;
  }
  return null;
}

function inlineArray(value, label) {
  const match = value.trim().match(/^\[(.*)\]$/);
  if (!match) throw new Error(`${label}: expected inline array`);
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);
}

function pushBranches(text, relative) {
  const body = triggerBlock(text, "push");
  if (!body) return null;
  for (let index = 0; index < body.length; index += 1) {
    const match = body[index].match(/^(\s*)branches:\s*(.*?)\s*$/);
    if (!match) continue;
    if (match[2]) return inlineArray(match[2], `${relative}:push.branches`);
    const base = match[1].length;
    const values = [];
    for (let cursor = index + 1; cursor < body.length; cursor += 1) {
      const line = body[cursor];
      if (indent(line) <= base) break;
      const item = line.match(/^\s*-\s*['\"]?([^'\"#]+?)['\"]?\s*(?:#.*)?$/);
      if (!item) throw new Error(`${relative}:push.branches contains an unsupported line: ${line.trim()}`);
      values.push(item[1].trim());
    }
    return values;
  }
  return ["*"];
}

const sameSet = (left, right) => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

function jobBlocks(text) {
  const lines = text.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex < 0) return [];
  const blocks = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (!match) continue;
    const body = [lines[index]];
    let cursor = index + 1;
    while (cursor < lines.length && (!lines[cursor].trim() || indent(lines[cursor]) > 2)) {
      body.push(lines[cursor]);
      cursor += 1;
    }
    blocks.push({ name: match[1], text: body.join("\n") });
    index = cursor - 1;
  }
  return blocks;
}

function stepBlocks(job) {
  const lines = job.split(/\r?\n/);
  const stepsIndex = lines.findIndex((line) => /^    steps:\s*$/.test(line));
  if (stepsIndex < 0) return [];
  const blocks = [];
  for (let index = stepsIndex + 1; index < lines.length; index += 1) {
    if (!/^      -\s+/.test(lines[index])) continue;
    const body = [lines[index]];
    let cursor = index + 1;
    while (cursor < lines.length && (!lines[cursor].trim() || indent(lines[cursor]) > 6)) {
      body.push(lines[cursor]);
      cursor += 1;
    }
    blocks.push(body.join("\n"));
    index = cursor - 1;
  }
  return blocks;
}

const hasProviderSecret = (text) => /\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}/.test(text);

function checkoutRefs(job) {
  const refs = [];
  for (const step of stepBlocks(job)) {
    if (!/uses:\s*actions\/checkout@/.test(step)) continue;
    const match = step.match(/^\s+ref:\s*(.+?)\s*$/m);
    refs.push(match ? match[1].replace(/^['\"]|['\"]$/g, "") : "github.sha");
  }
  return refs;
}

function exactSourceRef(value) {
  if (SHA40.test(value)) return true;
  return /github\.sha|source_sha|source-sha|candidate_sha|candidate-sha|head_sha|head-sha/.test(value);
}

function analyzeEffectWorkflow(relative, text, boundary) {
  const issues = [];
  if (/pull_request_target\s*:/.test(text)) issues.push("pull_request_target is forbidden");
  if (/secrets\s*:\s*inherit/.test(text)) issues.push("secrets: inherit is forbidden");
  if (/envs-old|envctl\s+auth\s+exec|auth[-_]bundle|old private artifact/i.test(text)) {
    issues.push("old envs/auth fallback marker is forbidden");
  }

  const allJobs = jobBlocks(text);
  const jobs = allJobs.filter((job) => hasProviderSecret(job.text));
  if (jobs.length === 0) issues.push("declared effect workflow has no provider-secret job");

  // Every checkout/action in an effect-bearing workflow can feed a later secret effect.
  // Bind the complete workflow closure, not only the step that directly reads the secret.
  for (const job of allJobs) {
    for (const ref of checkoutRefs(job.text)) {
      if (!exactSourceRef(ref)) issues.push(`${job.name}: effect-workflow checkout is not bound to an exact source identity: ${ref}`);
      if (/\bproposals\b|\bmain\b/.test(ref)) issues.push(`${job.name}: mutable branch checkout is forbidden in an effect workflow: ${ref}`);
    }
    for (const step of stepBlocks(job.text)) {
      const uses = step.match(/uses:\s*([^\s]+)/);
      if (!uses || uses[1].startsWith("./")) continue;
      const ref = uses[1].split("@")[1] ?? "";
      if (!SHA40.test(ref)) issues.push(`${job.name}: third-party action in effect workflow is not pinned by full SHA: ${uses[1]}`);
    }
  }

  for (const job of jobs) {
    const header = job.text.split(/^    steps:\s*$/m)[0];
    if (hasProviderSecret(header)) issues.push(`${job.name}: provider secret is exposed at job scope`);

    const allowed = boundary.allowedEvents ?? [];
    if (allowed.length === 0) issues.push(`${job.name}: allowedEvents is empty`);
    const eventGuarded = allowed.some((event) =>
      new RegExp(`github\\.event_name\\s*==\\s*['\"]${event}['\"]`).test(job.text)
      || (triggerBlock(text, event) !== null && ["issue_comment", "workflow_dispatch"].includes(event)
        && triggerBlock(text, "pull_request") === null && triggerBlock(text, "push") === null
        && triggerBlock(text, "workflow_run") === null));
    if (!eventGuarded) issues.push(`${job.name}: provider-secret job is not limited to ${allowed.join("/")}`);
    if (/github\.event_name\s*==\s*['\"](?:pull_request|push|workflow_run)['\"]/.test(job.text)) {
      issues.push(`${job.name}: automatic event reaches provider-secret job`);
    }

    const environment = boundary.environment;
    const environmentPattern = new RegExp(`environment:\\s*(?:\\n\\s+name:\\s*)?${environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);
    if (!environmentPattern.test(job.text)) issues.push(`${job.name}: static environment ${environment} is missing`);
    if (/environment:\s*(?:\n\s+name:\s*)?\$\{\{/.test(job.text)) issues.push(`${job.name}: dynamic environment is forbidden`);

    for (const ref of checkoutRefs(job.text)) {
      if (!exactSourceRef(ref)) issues.push(`${job.name}: checkout is not bound to an exact source identity: ${ref}`);
      if (/pull_request\.head|\bproposals\b|\bmain\b/.test(ref)) issues.push(`${job.name}: branch/PR-head checkout is forbidden after effect admission: ${ref}`);
    }

    for (const step of stepBlocks(job.text)) {
      if (!hasProviderSecret(step)) continue;
      const uses = step.match(/uses:\s*([^\s]+)/);
      if (uses && !uses[1].startsWith("./")) {
        const ref = uses[1].split("@")[1] ?? "";
        if (!SHA40.test(ref)) issues.push(`${job.name}: third-party action receiving a secret is not pinned by full SHA: ${uses[1]}`);
      }
      if (!/\brun:\s*[|>]?/.test(step) && !uses) issues.push(`${job.name}: secret-bearing step has no explicit executable`);
    }
  }
  return issues.map((message) => `${relative}: ${message}`);
}

function selftest() {
  const contract = { allowedEvents: ["workflow_dispatch"], environment: "cloudflare-production" };
  const unsafe = `on:\n  pull_request:\njobs:\n  effect:\n    environment: cloudflare-production\n    env:\n      TOKEN: \${{ secrets.TOKEN }}\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo effect\n`;
  assert.ok(analyzeEffectWorkflow("unsafe.yml", unsafe, contract).length > 0);

  const safe = `on:\n  pull_request:\n  workflow_dispatch:\njobs:\n  effect:\n    if: github.event_name == 'workflow_dispatch'\n    environment: cloudflare-production\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          ref: \${{ github.sha }}\n      - env:\n          TOKEN: \${{ secrets.TOKEN }}\n        run: echo effect\n`;
  assert.deepEqual(analyzeEffectWorkflow("safe.yml", safe, contract), []);

  const transitiveUnsafe = "on:\\n  workflow_dispatch:\\njobs:\\n  materialize:\\n    steps:\\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\\n        with:\\n          ref: proposals\\n  effect:\\n    needs: materialize\\n    environment: cloudflare-production\\n    steps:\\n      - env:\\n          TOKEN: ${{ secrets.TOKEN }}\\n        run: echo effect\\n";
  assert.ok(analyzeEffectWorkflow("transitive-unsafe.yml", transitiveUnsafe, contract).some((value) => value.includes("mutable branch checkout")));
  const fallback = safe.replace("echo effect", "envctl auth exec echo effect");
  assert.ok(analyzeEffectWorkflow("fallback.yml", fallback, contract).some((value) => value.includes("fallback")));
}

selftest();

const workflowDirectory = path.join(root, ".github/workflows");
const activeWorkflows = fs.readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => `.github/workflows/${name}`)
  .sort();
const activeSet = new Set(activeWorkflows);
const intentSet = new Set(records.map((record) => record.path));
const obsoleteSet = new Set(boundaries
  .filter((record) => record.classification === "obsolete")
  .map((record) => record.path));

for (const [relative, boundary] of boundaryByPath) {
  if (!relative || !["obsolete", "secret_bearing_effect"].includes(boundary.classification)) {
    failures.push(`${relative || "<missing>"}: invalid secret-effect classification`);
  }
  if (boundary.classification === "obsolete" && activeSet.has(relative)) {
    failures.push(`${relative}: obsolete workflow remains active`);
  }
  if (boundary.classification === "secret_bearing_effect" && !activeSet.has(relative)) {
    failures.push(`${relative}: declared effect workflow is missing`);
  }
}

for (const relative of activeWorkflows) {
  if (!intentSet.has(relative)) failures.push(`${relative}: active workflow has no ci.intent.v1 record`);
  const text = read(relative);
  const boundary = boundaryByPath.get(relative);
  if (hasProviderSecret(text)) {
    if (boundary?.classification !== "secret_bearing_effect") {
      failures.push(`${relative}: provider-secret workflow is unclassified`);
    } else {
      failures.push(...analyzeEffectWorkflow(relative, text, boundary));
    }
  } else if (boundary?.classification === "secret_bearing_effect") {
    failures.push(`${relative}: effect classification exists but provider secret is absent`);
  }
}

for (const record of records) {
  if (!record.path) {
    failures.push("ci.intent.v1 record missing path");
    continue;
  }
  if (!activeSet.has(record.path)) {
    if (!obsoleteSet.has(record.path)) failures.push(`${record.path}: workflow file not readable and not classified obsolete`);
    continue;
  }
  const workflow = read(record.path);
  const dispatch = Array.isArray(record.dispatch) ? record.dispatch : [];
  for (const trigger of ["pull_request", "workflow_dispatch"]) {
    if (dispatch.includes(trigger) && triggerBlock(workflow, trigger) === null) {
      failures.push(`${record.path}: intent declares ${trigger} but workflow lacks ${trigger} trigger`);
    }
  }
  if (dispatch.includes("push")) {
    const actual = pushBranches(workflow, record.path);
    if (actual === null) {
      failures.push(`${record.path}: intent declares push but workflow lacks push trigger`);
      continue;
    }
    if (!Array.isArray(record.push_branches)) {
      failures.push(`${record.path}: intent declares push but missing push_branches array; use ["*"] for no branch filter`);
      continue;
    }
    if (!sameSet(record.push_branches, actual)) {
      failures.push(`${record.path}: push branch mismatch: intent=${JSON.stringify(record.push_branches)} workflow=${JSON.stringify(actual)}`);
    }
  }
}

if (failures.length) {
  console.error("ci intent / secret-effect boundary check failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const classified = activeWorkflows.map((relative) => ({
  path: relative,
  classification: hasProviderSecret(read(relative)) ? "secret_bearing_effect" : "secret_free_verify",
}));
console.log(JSON.stringify({
  kind: "ops.secretEffectBoundary.check.v1",
  status: "PASS",
  active: classified.length,
  secretBearingEffects: classified.filter((item) => item.classification === "secret_bearing_effect").length,
  obsolete: obsoleteSet.size,
  unclassified: 0,
  workflows: classified,
}));
