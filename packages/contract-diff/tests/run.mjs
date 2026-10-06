import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tests = fileURLToPath(new URL(".", import.meta.url));
const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", tests, "-v"], {
  env: { ...process.env, CONTRACT_DIFF_BIN: "contract-diff" },
  encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.error, undefined, "Python test process did not finish");
assert.equal(result.status, 0, "contract-diff tests failed");
assert.match(result.stderr, /Ran [1-9][0-9]* tests? in/);
assert.doesNotMatch(result.stderr, /skipped=/);
