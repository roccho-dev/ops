#!/usr/bin/env node
import process from "node:process";
import { assembleArtifact, readArtifactLock, sha256Tree, writeAssemblyReceipt } from "../src/index.mjs";

const fail = (message) => {
  process.stderr.write(`artifact-assembly: ${message}\n`);
  process.exit(1);
};

const parseFlags = (args) => {
  const result = { source: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "require-complete") {
      result.requireComplete = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    index += 1;
    if (key === "source") result.source.push(value);
    else result[key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
  }
  return result;
};

const parseSources = (values) => Object.fromEntries(values.map((value) => {
  const split = value.indexOf("=");
  if (split <= 0 || split === value.length - 1) fail(`invalid --source value: ${value}`);
  return [value.slice(0, split), value.slice(split + 1)];
}));

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "check-lock") {
    const flags = parseFlags(rest);
    if (!flags.lock) fail("--lock is required");
    const rows = readArtifactLock(flags.lock, { requireComplete: flags.requireComplete === true });
    process.stdout.write(`${JSON.stringify({ rows: rows.length, status: "PASS" })}\n`);
  } else if (command === "digest-tree") {
    const [tree] = rest;
    if (!tree) fail("tree path is required");
    process.stdout.write(`${JSON.stringify(sha256Tree(tree))}\n`);
  } else if (command === "assemble") {
    const flags = parseFlags(rest);
    if (!flags.lock || !flags.output || !flags.receipt) fail("--lock, --output, and --receipt are required");
    const receipt = assembleArtifact({
      lockPath: flags.lock,
      outputDir: flags.output,
      requireComplete: flags.requireComplete === true,
      sources: parseSources(flags.source),
    });
    writeAssemblyReceipt(flags.receipt, receipt);
    process.stdout.write(`${JSON.stringify({ outputTreeSha256: receipt.outputTreeSha256, status: "PASS" })}\n`);
  } else {
    fail("usage: check-lock|digest-tree|assemble");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
