#!/usr/bin/env node
import fs from "node:fs";
import { normalizeRows, outputHeaders, parseProjection, searchPackages, toTsv } from "../lib/find-packages-core.mjs";

function usage() {
  console.error("usage: find-packages --projection <adrs-projection.jsonl|json|tsv> [--query text] [--role role]");
  console.error("       find-packages --catalog <legacy-catalog.tsv> [--query text] [--role role]");
  process.exit(2);
}

const args = process.argv.slice(2);
let input = "";
let query = "";
let role = "";
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--projection" || a === "--catalog") input = args[++i] || "";
  else if (a === "--query") query = args[++i] || "";
  else if (a === "--role") role = args[++i] || "";
  else usage();
}
if (!input) usage();

const rows = normalizeRows(parseProjection(fs.readFileSync(input, "utf8")));
console.log(toTsv(searchPackages(rows, { query, role }), outputHeaders));
