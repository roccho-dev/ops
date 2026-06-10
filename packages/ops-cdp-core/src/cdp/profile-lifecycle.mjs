// profile-lifecycle: chromium-cdp 用プロファイルの seed / login-complete / publish /
// runtime-copy を扱う CLI。profile-lifecycle.py (argparse 4 サブコマンド) の node 移植。
//
// JSON 出力 schema: ops.cdpProfileLifecycleResult.v1 / marker: ops.cdpProfileLifecycleMarker.v1。
// publish は --allow-copy gate を要求。profile-copy は runtime 専用ファイルを ignore。
// secret material は一切 print しない(secretMaterialPrinted:false)。
//
// I/O は既存 chromium-cdp-*.mjs と同様、qjs 互換層 core/std.mjs(stdout/exit)+ 再帰
// ファイル操作は node:fs(shim が捌かない copytree/ignore/chmod/rmtree のため)を併用。
//
// Usage:
//   qjs --std -m profile-lifecycle.mjs seed --profile-dir <dir>
//   qjs --std -m profile-lifecycle.mjs login-complete --profile-dir <dir>
//   qjs --std -m profile-lifecycle.mjs publish --profile-dir <dir> --snapshot-dir <dir> --allow-copy [--replace]
//   qjs --std -m profile-lifecycle.mjs runtime-copy --snapshot-dir <dir> --runtime-dir <dir> [--replace]

import * as std from "./core/std.mjs";
import * as fs from "node:fs";
import { resolve, join } from "node:path";

const DECISION_FLAGS = {
  semanticApproval: false,
  completionApproval: false,
  routeDecision: false,
};

const PROFILE_COPY_IGNORE_NAMES = new Set([
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
]);

const PROFILE_COPY_IGNORE_PREFIXES = [
  ".org.chromium.",
];

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function result(command, extra) {
  return {
    kind: "ops.cdpProfileLifecycleResult.v1",
    command,
    createdAt: nowIso(),
    ...DECISION_FLAGS,
    ...extra,
  };
}

function write(value) {
  // python: json.dumps(indent=2, sort_keys=True)
  std.out.puts(stableJson(value) + "\n");
  return value.ok ? 0 : 1;
}

// JSON.stringify を key ソートして出力(python sort_keys=True 等価)。
function stableJson(value) {
  return JSON.stringify(value, sortedReplacer(value), 2);
}

function sortedReplacer() {
  return (key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted = {};
      for (const k of Object.keys(val).sort()) sorted[k] = val[k];
      return sorted;
    }
    return val;
  };
}

function expanduser(raw) {
  const s = String(raw);
  const home = std.getenv("HOME") || "";
  if (s === "~") return home;
  if (s.startsWith("~/")) return join(home, s.slice(2));
  return s;
}

function safePath(raw) {
  const expanded = expanduser(raw);
  return resolve(process.cwd(), expanded);
}

function chmodPrivate(path) {
  try {
    fs.chmodSync(path, 0o700); // stat.S_IRWXU
  } catch {
    // OSError 相当は無視(python: except OSError: pass)
  }
}

function isDir(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function pathExists(path) {
  try {
    fs.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function shouldIgnore(name) {
  if (PROFILE_COPY_IGNORE_NAMES.has(name)) return true;
  return PROFILE_COPY_IGNORE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function copyProfileTree(src, dst, replace) {
  // python: src.resolve() == dst.resolve() -> error
  if (resolve(src) === resolve(dst)) {
    throw new Error("source and destination must differ");
  }
  if (pathExists(dst)) {
    if (!replace) {
      throw new Error(`destination exists: ${dst}`);
    }
    fs.rmSync(dst, { recursive: true, force: true });
  }
  // shutil.copytree(symlinks=False, ignore=ignore_runtime_profile_files)
  fs.mkdirSync(dst, { recursive: true });
  copyTreeRecursive(src, dst);
  chmodPrivate(dst);
}

function copyTreeRecursive(src, dst) {
  const names = fs.readdirSync(src);
  const ignored = new Set(names.filter(shouldIgnore));
  for (const name of names) {
    if (ignored.has(name)) continue;
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = fs.lstatSync(srcPath);
    if (st.isSymbolicLink()) {
      // symlinks=False: シンボリックリンクの指す実体をコピー
      const realSt = fs.statSync(srcPath);
      if (realSt.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        copyTreeRecursive(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    } else if (st.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyTreeRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function hasLoginMaterial(profileDir) {
  return pathExists(join(profileDir, "Local State")) || pathExists(join(profileDir, "Default"));
}

function cmdSeed(args) {
  const profileDir = safePath(args.profileDir);
  fs.mkdirSync(profileDir, { recursive: true });
  chmodPrivate(profileDir);
  const marker = join(profileDir, "OPS_CDP_PROFILE_LIFECYCLE.json");
  fs.writeFileSync(marker, stableJson({
    kind: "ops.cdpProfileLifecycleMarker.v1",
    profileKind: "seed",
    createdAt: nowIso(),
    credentialCapture: false,
    otpAutomation: false,
  }) + "\n", "utf8");
  return write(result("chromium-cdp-profile-seed", {
    ok: true,
    status: "profile-seed-ready",
    profileDir: String(profileDir),
    secretMaterialPrinted: false,
    nextCommand: [
      "HQ_CHROME_PROFILE_DIR=" + String(profileDir),
      "chromium-cdp",
      "<target Project URL>",
    ],
  }));
}

function cmdLoginComplete(args) {
  const profileDir = safePath(args.profileDir);
  const ok = isDir(profileDir) && hasLoginMaterial(profileDir);
  return write(result("chromium-cdp-profile-login-complete", {
    ok,
    status: ok ? "profile-login-complete-observed" : "profile-login-not-detected",
    profileDir: String(profileDir),
    observedFiles: ["Local State", "Default"].filter((name) => pathExists(join(profileDir, name))),
    credentialCapture: false,
    credentialReplay: false,
    otpAutomation: false,
    secretMaterialPrinted: false,
  }));
}

function cmdPublish(args) {
  const profileDir = safePath(args.profileDir);
  const snapshotDir = safePath(args.snapshotDir);
  if (!args.allowCopy) {
    return write(result("chromium-cdp-profile-publish", {
      ok: false,
      status: "publish-not-authorized",
      reason: "--allow-copy is required",
      profileDir: String(profileDir),
      snapshotDir: String(snapshotDir),
    }));
  }
  if (!isDir(profileDir)) {
    return write(result("chromium-cdp-profile-publish", {
      ok: false,
      status: "profile-dir-missing",
      profileDir: String(profileDir),
      snapshotDir: String(snapshotDir),
    }));
  }
  try {
    copyProfileTree(profileDir, snapshotDir, args.replace);
  } catch (exc) {
    return write(result("chromium-cdp-profile-publish", {
      ok: false,
      status: "publish-copy-failed",
      reason: String(exc && exc.message ? exc.message : exc),
      profileDir: String(profileDir),
      snapshotDir: String(snapshotDir),
    }));
  }
  return write(result("chromium-cdp-profile-publish", {
    ok: true,
    status: "profile-snapshot-published",
    profileDir: String(profileDir),
    snapshotDir: String(snapshotDir),
    secretMaterialPrinted: false,
    runtimeCopyRequired: true,
  }));
}

function cmdRuntimeCopy(args) {
  const snapshotDir = safePath(args.snapshotDir);
  const runtimeDir = safePath(args.runtimeDir);
  if (!isDir(snapshotDir)) {
    return write(result("chromium-cdp-profile-runtime-copy", {
      ok: false,
      status: "snapshot-dir-missing",
      snapshotDir: String(snapshotDir),
      runtimeDir: String(runtimeDir),
    }));
  }
  try {
    copyProfileTree(snapshotDir, runtimeDir, args.replace);
  } catch (exc) {
    return write(result("chromium-cdp-profile-runtime-copy", {
      ok: false,
      status: "runtime-copy-failed",
      reason: String(exc && exc.message ? exc.message : exc),
      snapshotDir: String(snapshotDir),
      runtimeDir: String(runtimeDir),
    }));
  }
  return write(result("chromium-cdp-profile-runtime-copy", {
    ok: true,
    status: "runtime-profile-ready",
    snapshotDir: String(snapshotDir),
    runtimeDir: String(runtimeDir),
    sourceMutated: false,
    secretMaterialPrinted: false,
    nextGate: "project-transport-doctor --project-url <target Project URL>",
  }));
}

// argparse 等価の最小 parser。required option が欠ければ usage error(exit 2)。
function usage() {
  std.err.puts(
    "usage: profile-lifecycle <seed|login-complete|publish|runtime-copy> ...\n" +
      "  seed --profile-dir <dir>\n" +
      "  login-complete --profile-dir <dir>\n" +
      "  publish --profile-dir <dir> --snapshot-dir <dir> --allow-copy [--replace]\n" +
      "  runtime-copy --snapshot-dir <dir> --runtime-dir <dir> [--replace]\n",
  );
  std.err.flush();
}

function parseSub(argv, valueFlags, boolFlags, required) {
  const out = {};
  for (const flag of boolFlags) out[flag.key] = false;
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    const vf = valueFlags.find((f) => f.flag === tok);
    if (vf) {
      if (i + 1 >= argv.length) return { error: `argument ${tok}: expected one argument` };
      out[vf.key] = argv[i + 1];
      i += 2;
      continue;
    }
    const bf = boolFlags.find((f) => f.flag === tok);
    if (bf) {
      out[bf.key] = true;
      i += 1;
      continue;
    }
    return { error: `unrecognized arguments: ${tok}` };
  }
  for (const key of required) {
    if (out[key] === undefined) {
      const flag = valueFlags.find((f) => f.key === key);
      return { error: `the following arguments are required: ${flag ? flag.flag : key}` };
    }
  }
  return { args: out };
}

const SUBCOMMANDS = {
  seed: {
    valueFlags: [{ flag: "--profile-dir", key: "profileDir" }],
    boolFlags: [],
    required: ["profileDir"],
    func: cmdSeed,
  },
  "login-complete": {
    valueFlags: [{ flag: "--profile-dir", key: "profileDir" }],
    boolFlags: [],
    required: ["profileDir"],
    func: cmdLoginComplete,
  },
  publish: {
    valueFlags: [
      { flag: "--profile-dir", key: "profileDir" },
      { flag: "--snapshot-dir", key: "snapshotDir" },
    ],
    boolFlags: [
      { flag: "--allow-copy", key: "allowCopy" },
      { flag: "--replace", key: "replace" },
    ],
    required: ["profileDir", "snapshotDir"],
    func: cmdPublish,
  },
  "runtime-copy": {
    valueFlags: [
      { flag: "--snapshot-dir", key: "snapshotDir" },
      { flag: "--runtime-dir", key: "runtimeDir" },
    ],
    boolFlags: [{ flag: "--replace", key: "replace" }],
    required: ["snapshotDir", "runtimeDir"],
    func: cmdRuntimeCopy,
  },
};

export function main(argv) {
  const command = argv[0];
  if (!command || !SUBCOMMANDS[command]) {
    usage();
    return 2;
  }
  const spec = SUBCOMMANDS[command];
  const parsed = parseSub(argv.slice(1), spec.valueFlags, spec.boolFlags, spec.required);
  if (parsed.error) {
    std.err.puts("profile-lifecycle " + command + ": error: " + parsed.error + "\n");
    std.err.flush();
    return 2;
  }
  return spec.func(parsed.args);
}

// CLI guard: qjs-cli は globalThis.scriptArgs=[script, ...args] を注入する
// (python: sys.argv[1:])。import 時に main を実行しない。
if (typeof scriptArgs !== "undefined" && Array.isArray(scriptArgs)) {
  std.exit(main(scriptArgs.slice(1)));
}

export {
  result,
  write,
  safePath,
  copyProfileTree,
  hasLoginMaterial,
  cmdSeed,
  cmdLoginComplete,
  cmdPublish,
  cmdRuntimeCopy,
  PROFILE_COPY_IGNORE_NAMES,
  PROFILE_COPY_IGNORE_PREFIXES,
};
