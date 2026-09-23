import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dir, "../cli/index.mjs");
const injectPath = resolve(__dir, "inject-fetch.mjs");

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

  const args = scenario ? ["-r", injectPath, cliPath] : [cliPath];

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

test("invalid JSON returns exit 1", async () => {
  const { code, stdout } = await runCli("not json");
  assert.equal(code, EXIT_INPUT_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "invalid_json");
});

test("missing JEV_API_KEY returns auth_missing exit 2", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "" });
  assert.equal(code, EXIT_AUTH_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "auth_missing");
});

test("empty text returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "noul", text: "", question: "Q?" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("empty question returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("non-object request returns invalid_request exit 1", async () => {
  const input = '["not", "object"]';
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "invalid_request");
});

test("unknown request type returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "unknown", text: "test", question: "Q?" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "key" });
  assert.equal(code, EXIT_INPUT_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("success path with injected fetch returns exit 0", async () => {
  const input = JSON.stringify({ type: "noul", text: "test input", question: "Is this valid?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "success" };
  const { code, stdout } = await runCli(input, env, "success");
  assert.equal(code, EXIT_SUCCESS);
  const result = JSON.parse(stdout);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.noul, 0.75);
});

test("provider error path with injected fetch returns exit 3", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "provider_error" };
  const { code, stdout } = await runCli(input, env, "provider_error");
  assert.equal(code, EXIT_PROVIDER_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "provider_error");
});

test("contract error path with injected fetch returns exit 4", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: "test-key", TEST_FETCH_SCENARIO: "contract_error" };
  const { code, stdout } = await runCli(input, env, "contract_error");
  assert.equal(code, EXIT_CONTRACT_ERROR);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "contract_error");
});
