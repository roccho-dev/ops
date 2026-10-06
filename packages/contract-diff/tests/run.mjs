import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Nix supplies the declared package, including its Python interpreter and tests.
// Test the installed entry; never select a second ambient runtime here.
const result = spawnSync("contract-diff", ["--selftest"], {
  env: { ...process.env, CONTRACT_DIFF_BIN: "contract-diff" },
  encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.error, undefined, "Installed test process did not finish");
assert.equal(result.status, 0, "contract-diff tests failed");
assert.match(result.stderr, /Ran [1-9][0-9]* tests? in/);
assert.doesNotMatch(result.stderr, /skipped=/);
