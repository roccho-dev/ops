#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siblingBin = path.join(here, "..", "bin", "ops-package-responses.mjs");
const cmd = fs.existsSync(siblingBin) ? [process.execPath, siblingBin] : ["ops-package-responses"];
const result = JSON.parse(execFileSync(cmd[0], [...cmd.slice(1), "selftest", "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));

assert.equal(result.ok, true);
assert.equal(result.kind, "ops.packageResponseSelftest.v2");
assert.equal(result.positive_all_packages, "pass");
assert.equal(result.missing_obligation, "blocked");
assert.equal(result.failing_required_check, "blocked");
assert.equal(result.exact_release_tamper, "rejected");
assert.equal(result.log_tamper, "rejected");
assert.equal(result.dirty_worktree, "rejected");
assert.equal(result.wrong_governance_source, "rejected");
assert.equal(result.actual_check_outputs_bound, true);
process.stdout.write("ops-package-responses: exact release obligations execute all package checks and fail closed\n");
