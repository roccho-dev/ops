import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dir, "../cli/index.mjs");

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
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "invalid_json");
});

test("missing JEV_API_KEY returns auth_missing exit 1", async () => {
  const input = JSON.stringify({ type: "noul", text: "test" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "auth_missing");
});

test("empty text returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "noul", text: "" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "fake-key" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("non-object request returns input_invalid exit 1", async () => {
  const input = '["not", "object"]';
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "fake-key" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "invalid_request");
});

test("unknown request type returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "unknown", text: "test" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "fake-key" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("choice without choices object returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "choice", text: "test" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "fake-key" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("choice without name returns input_invalid exit 1", async () => {
  const input = JSON.stringify({ type: "choice", text: "test", choices: { keys: ["a", "b"] } });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "fake-key" });
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.error, "input_invalid");
});

test("API key not logged to stdout", async () => {
  const input = JSON.stringify({ type: "noul", text: "test" });
  const { code, stdout } = await runCli(input, { JEV_API_KEY: "secret-key-12345" });
  // Should fail due to network, but should not expose the key
  assert(!stdout.includes("secret-key-12345"), "API key leaked to stdout");
  assert(!stdout.includes("12345"), "Partial key leaked to stdout");
});
