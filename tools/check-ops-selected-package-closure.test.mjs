#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.join(here, "check-ops-selected-package-closure.mjs");
const result = JSON.parse(execFileSync(process.execPath, [tool, "selftest", "--json"], { encoding: "utf8" }));
if (result.status !== "pass" || result.authority !== false) {
  throw Error(JSON.stringify(result));
}
process.stdout.write("ops-selected-package-closure:selftest-pass\n");
