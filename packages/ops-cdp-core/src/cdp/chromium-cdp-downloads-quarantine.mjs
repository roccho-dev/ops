import * as std from "qjs:std";

import { getDefaultAddr, parseArgs, run } from "./lib.mjs";
import { quarantineDownloadNames, nowIso } from "./host-git-ops.mjs";

function usage() {
  std.err.puts(
    "usage: qjs --std -m chromium-cdp-downloads-quarantine.mjs --downloadsDir <dir> --name <artifact> [--name <artifact> ...] [--archiveDir <dir>] [--json]\n",
  );
  std.err.flush();
}

function buildArgs(argv) {
  return parseArgs(argv, {
    defaults: {
      downloadsDir: null,
      archiveDir: null,
      names: [],
      json: false,
      addr: getDefaultAddr(),
    },
    flags: {
      downloadsDir: { required: true },
      archiveDir: {},
      names: { names: ["--name"], multiple: true },
      json: { type: "boolean" },
    },
    onError: "null",
    reportError: true,
    finalize: (out) => out.names.length > 0 ? out : null,
  });
}

function main(args) {
  const archiveDir = args.archiveDir || `${args.downloadsDir}/cdp-quarantine-${nowIso().replace(/[:.]/g, "-")}`;
  const moved = quarantineDownloadNames(args.downloadsDir, archiveDir, args.names);
  const result = { ok: true, downloadsDir: args.downloadsDir, archiveDir, names: args.names, moved };
  if (args.json) std.out.puts(JSON.stringify(result, null, 2) + "\n");
  else {
    std.out.puts(`moved=${moved.length}\n`);
    std.out.puts(`archiveDir=${archiveDir}\n`);
  }
  return 0;
}

run(scriptArgs, { usage, buildArgs, main });
