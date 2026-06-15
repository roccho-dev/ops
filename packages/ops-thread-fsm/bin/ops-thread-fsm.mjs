#!/usr/bin/env node
// CLI wrapper for the ops-thread-fsm controller package.
//
// The implementation lives under ../lib so the binary stays small enough for
// artifact transfer while remaining runnable through:
//   node packages/ops-thread-fsm/bin/ops-thread-fsm.mjs ...
//   ops-thread-fsm ...
//
// Node ESM port of bin/ops-thread-fsm (stdlib only, behavior-identical).

import process from "node:process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

async function run() {
  const cliUrl = new URL("../lib/cli.mjs", import.meta.url);
  let main;
  try {
    ({ main } = await import(cliUrl.href));
  } catch (exc) {
    process.stderr.write(
      "ops-thread-fsm: missing implementation module " +
        "ops_thread_fsm.cli under packages/ops-thread-fsm/lib\n",
    );
    process.stderr.write(`${exc}\n`);
    return 2;
  }
  const result = main(process.argv.slice(2));
  return Number(result || 0);
}

run().then((code) => {
  process.exit(code);
});
