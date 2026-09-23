import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dir, "../cli/index.mjs");
const setupPath = resolve(__dir, "setup-fetch-stub.mjs");

const EXIT_SUCCESS = 0;
const EXIT_INPUT_ERROR = 1;
const EXIT_AUTH_ERROR = 2;
const EXIT_PROVIDER_ERROR = 3;
const EXIT_CONTRACT_ERROR = 4;
const EXIT_FATAL = 5;

async function runCli(input, env = {}, scenario = null) {
  const finalEnv = {
    ...process.env,
    ...env,
  };

  if (scenario) {
    finalEnv.TEST_FETCH_SCENARIO = scenario;
  }

  // Convert Windows paths to file:// URLs for --import
  const fileUrlFromPath = (path) => {
    return "file://" + path.replace(/\\/g, "/");
  };

  const args = scenario ? ["--import", fileUrlFromPath(setupPath), cliPath] : [cliPath];

  const child = spawn("node", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: finalEnv,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.stdin.write(input);
  child.stdin.end();

  return new Promise((resolve) => {
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("invalid JSON returns exit 1, single stdout JSON line, no key in stderr", async () => {
  const { code, stdout, stderr } = await runCli("not json");
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "invalid_json");
  assert(!stderr.includes("JEV_API_KEY"), "API key should not appear in stderr");
});

test("missing JEV_API_KEY returns exit 2, single stdout JSON line, key value not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const { code, stdout, stderr } = await runCli(input, { JEV_API_KEY: "" });
  assert.equal(code, EXIT_AUTH_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "auth_missing");
  // Verify no actual key value is logged (use a test key to check)
  // Empty key should not appear as a Bearer token or similar
  assert(!stdout.includes("Bearer "), "API key value should not appear in stdout");
  assert(!stderr.includes("Bearer "), "API key value should not appear in stderr");
});

test("empty text returns exit 1, single stdout JSON line", async () => {
  const input = JSON.stringify({ type: "noul", text: "", question: "Q?" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "input_invalid");
});

test("empty question returns exit 1, single stdout JSON line", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "input_invalid");
});

test("non-object request returns exit 1, single stdout JSON line", async () => {
  const input = '["not", "object"]';
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "invalid_request");
});

test("unknown request type returns exit 1, single stdout JSON line", async () => {
  const input = JSON.stringify({ type: "unknown", text: "test", question: "Q?" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "input_invalid");
});

test("success path with injected fetch returns exit 0, single stdout JSON line, model and noul", async () => {
  const input = JSON.stringify({ type: "noul", text: "test input", question: "Is this valid?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "success" };
  const { code, stdout } = await runCli(input, env, "success");
  assert.equal(code, EXIT_SUCCESS);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.noul, 0.75);
});

test("provider error path with injected fetch returns exit 3, single stdout JSON line", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "provider_error" };
  const { code, stdout } = await runCli(input, env, "provider_error");
  assert.equal(code, EXIT_PROVIDER_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "provider_error");
});

test("contract error path with injected fetch returns exit 4, single stdout JSON line", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "contract_error" };
  const { code, stdout } = await runCli(input, env, "contract_error");
  assert.equal(code, EXIT_CONTRACT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "contract_error");
});

test("fetch throws returns exit 3 (provider unreachable), single stdout JSON line", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "fetch_throws" };
  const { code, stdout } = await runCli(input, env, "fetch_throws");
  assert.equal(code, EXIT_PROVIDER_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1, "Expected exactly one stdout line");
  const result = JSON.parse(lines[0]);
  assert.equal(result.error, "provider_unreachable");
});
