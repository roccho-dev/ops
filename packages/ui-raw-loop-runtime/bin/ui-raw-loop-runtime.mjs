#!/usr/bin/env node
import fs from "node:fs";
import { appendRawLine, projectUiReadModel, readRaw, startServer } from "../lib/core.mjs";

function usage() {
  console.error("usage: ui-raw-loop-runtime --raw <path> [--post <record.json> | --project | --serve [--host 127.0.0.1] [--port 19080]]");
  process.exit(2);
}

const args = process.argv.slice(2);
let rawPath = "";
let postPath = "";
let project = false;
let serve = false;
let host = "127.0.0.1";
let port = 19080;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--raw") rawPath = args[++i] || "";
  else if (a === "--post") postPath = args[++i] || "";
  else if (a === "--project") project = true;
  else if (a === "--serve") serve = true;
  else if (a === "--host") host = args[++i] || host;
  else if (a === "--port") port = Number(args[++i] || port);
  else usage();
}
if (!rawPath) usage();

if (postPath) {
  const record = JSON.parse(fs.readFileSync(postPath, "utf8"));
  const append = appendRawLine(rawPath, record);
  console.log(JSON.stringify({ kind: "ui.raw.loop.receipt.v1", append, projection: projectUiReadModel(readRaw(rawPath)) }));
} else if (project) {
  console.log(JSON.stringify(projectUiReadModel(readRaw(rawPath))));
} else if (serve) {
  const server = await startServer({ rawPath, host, port });
  const address = server.address();
  console.error(`ui-raw-loop-runtime listening on http://${address.address}:${address.port}`);
} else usage();
