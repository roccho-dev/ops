#!/usr/bin/env node
import process from "node:process";
import { main } from "../src/collector.mjs";

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exit(1);
});

main(process.argv.slice(2)).then((code) => process.exit(Number(code || 0)));
