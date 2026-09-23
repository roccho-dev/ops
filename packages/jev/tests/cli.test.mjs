import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dir, "../cli/index.mjs");
const setupPath = resolve(__dir, "setup-fetch-stub.mjs");

const EXIT_SUCCESS = 0;
const EXIT_INPUT_ERROR = 1;
const EXIT_AUTH_ERROR = 2;
const EXIT_PROVIDER_ERROR = 3;
const EXIT_CONTRACT_ERROR = 4;

const TEST_API_KEY = "fake-test-key-12345-xyz";

async function runCli(input, env = {}, scenario = null) {
  const finalEnv = {
    ...process.env,
    ...env,
  };

  if (scenario) {
    finalEnv.TEST_FETCH_SCENARIO = scenario;
  }

  // Always preload fetch stub with --import using pathToFileURL
  const setupUrl = pathToFileURL(setupPath).href;
  const args = ["--import", setupUrl, cliPath];

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

test("invalid JSON returns exit 1, single stdout line, key not logged", async () => {
  const { code, stdout, stderr } = await runCli("not json", { JEV_API_KEY: TEST_API_KEY });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(JSON.parse(lines[0]));
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("missing JEV_API_KEY returns exit 2, single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const { code, stdout, stderr } = await runCli(input, { JEV_API_KEY: "" });
  assert.equal(code, EXIT_AUTH_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(JSON.parse(lines[0]));
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("empty text returns exit 1, single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "", question: "Q?" });
  const { code, stdout, stderr } = await runCli(input, { JEV_API_KEY: TEST_API_KEY });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("empty question returns exit 1, single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "" });
  const { code, stdout, stderr } = await runCli(input, { JEV_API_KEY: TEST_API_KEY });
  assert.equal(code, EXIT_INPUT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("success path returns exit 0, single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test input", question: "Q?" });
  const env = { JEV_API_KEY: TEST_API_KEY, TEST_FETCH_SCENARIO: "success" };
  const { code, stdout, stderr } = await runCli(input, env, "success");
  assert.equal(code, EXIT_SUCCESS);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  const result = JSON.parse(lines[0]);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.noul, 0.75);
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("provider error path returns exit 3, single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: TEST_API_KEY, TEST_FETCH_SCENARIO: "provider_error" };
  const { code, stdout, stderr } = await runCli(input, env, "provider_error");
  assert.equal(code, EXIT_PROVIDER_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("contract error path returns exit 4, single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: TEST_API_KEY, TEST_FETCH_SCENARIO: "contract_error" };
  const { code, stdout, stderr } = await runCli(input, env, "contract_error");
  assert.equal(code, EXIT_CONTRACT_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});

test("fetch throws returns exit 3 (provider unreachable), single stdout line, key not logged", async () => {
  const input = JSON.stringify({ type: "noul", text: "test", question: "Q?" });
  const env = { JEV_API_KEY: TEST_API_KEY, TEST_FETCH_SCENARIO: "fetch_throws" };
  const { code, stdout, stderr } = await runCli(input, env, "fetch_throws");
  assert.equal(code, EXIT_PROVIDER_ERROR);
  const lines = stdout.trim().split("\n").filter(l => l);
  assert.equal(lines.length, 1);
  assert(!stdout.includes(TEST_API_KEY), "API key should not appear in stdout");
  assert(!stderr.includes(TEST_API_KEY), "API key should not appear in stderr");
});
