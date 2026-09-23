import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dir, "../cli/index.mjs");

const EXIT_SUCCESS = 0;
const EXIT_INPUT_ERROR = 1;
const EXIT_AUTH_ERROR = 2;
const EXIT_PROVIDER_ERROR = 3;
const EXIT_CONTRACT_ERROR = 4;

async function runCli(input, env = {}) {
  const child = spawn("node", [cliPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
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
