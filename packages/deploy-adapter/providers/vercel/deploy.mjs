#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VERCEL_CLI = "59.23.1";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function valueAfter(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= args.length) fail(`missing value for ${name}`);
  return args[index + 1];
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) fail(`missing required environment variable: ${name}`);
  return value;
}

const args = process.argv.slice(2);
const rootArg = valueAfter(args, "--root");
const sourceRevision = valueAfter(args, "--source-revision");
const probePath = valueAfter(args, "--probe-path", "/");
const target = valueAfter(args, "--target", "preview");

if (!rootArg) fail("--root is required");
if (!sourceRevision?.trim()) fail("--source-revision is required");
if (!probePath.startsWith("/")) fail("--probe-path must begin with /");
if (!["preview", "production"].includes(target)) fail("--target must be preview or production");

const root = path.resolve(rootArg);
if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  fail(`root is not a directory: ${root}`);
}

const token = requireEnv("VERCEL_TOKEN");
requireEnv("VERCEL_ORG_ID");
requireEnv("VERCEL_PROJECT_ID");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const deployArgs = [
  "--yes",
  `vercel@${VERCEL_CLI}`,
  "deploy",
  "--yes",
  "--cwd",
  root,
  "--token",
  token,
];
if (target === "production") deployArgs.push("--prod");

const deployed = spawnSync(npx, deployArgs, {
  cwd: root,
  env: process.env,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
if (deployed.stderr) process.stderr.write(deployed.stderr);
if (deployed.error) fail(`failed to execute Vercel CLI: ${deployed.error.message}`);
if (deployed.status !== 0) fail(`vercel deploy failed with exit code ${deployed.status}`);

const lines = deployed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (lines.length !== 1) fail(`expected exactly one deployment URL on stdout, got ${lines.length}`);

let deploymentUrl;
try {
  deploymentUrl = new URL(lines[0]);
} catch {
  fail("Vercel returned an invalid deployment URL");
}
if (deploymentUrl.protocol !== "https:") fail("Vercel deployment URL must use https");

const probeUrl = new URL(probePath, deploymentUrl);
let probeStatus = null;
let lastError = "no response";

for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    const response = await fetch(probeUrl, {
      headers: { "user-agent": "roccho-deploy-adapter/1" },
      signal: AbortSignal.timeout(15_000),
    });
    probeStatus = response.status;
    await response.arrayBuffer();
    if (probeStatus >= 200 && probeStatus <= 299) break;
    lastError = `HTTP ${probeStatus}`;
  } catch (error) {
    lastError = error.message;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (probeStatus === null || probeStatus < 200 || probeStatus > 299) {
  fail(`public readback failed: ${lastError}`);
}

const receipt = {
  schema: "ops.deploy-effect.receipt/1",
  authority: false,
  status: "PASS",
  provider: "vercel",
  target,
  sourceRevision,
  deploymentUrl: deploymentUrl.toString().replace(/\/$/, ""),
  probe: { path: probePath, status: probeStatus },
};

process.stdout.write(JSON.stringify(receipt) + "\n");
