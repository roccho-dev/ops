#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "find-packages-gate-"));
const projection = join(dir, "projection.jsonl");
writeFileSync(projection, [
  { repo: "ops", pkg: "find-packages", role: "discovery", eligible: true, missingGoalNonGoal: [], summary: "eligible package discovery" },
  { repo: "legacy", pkg: "old-tool", role: "discovery", eligible: false, missingGoalNonGoal: ["nonGoals"], summary: "ineligible legacy package" },
].map((row) => JSON.stringify(row)).join("\n"));

const positive = spawnSync("find-packages", ["--projection", projection, "--query", "find-packages", "--require-eligible"], { encoding: "utf8" });
assert.equal(positive.status, 0, positive.stderr);
assert.match(positive.stdout, /find-packages/);

const negative = spawnSync("find-packages", ["--projection", projection, "--query", "old-tool", "--require-eligible"], { encoding: "utf8" });
assert.equal(negative.status, 3);
assert.match(negative.stderr, /no eligible package rows/);
