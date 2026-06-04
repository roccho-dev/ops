// cli: CLI 足場(parseArgs + run harness)。lib ではない(exit/argv/usage を扱う層)。
// Phase2 で lib に依存する cli package へ移設予定。
import * as std from "../core/std.mjs";

function cloneDefaultValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === "object") return { ...value };
  return value;
}

function hasRequiredValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function defaultErrorText(error) {
  const message = String(error && error.message ? error.message : error);
  const stack = error && error.stack ? String(error.stack) : "";
  if (!stack) return message;
  if (stack.indexOf(message) >= 0) return stack;
  return message + "\n" + stack;
}

export function parseArgs(argv, spec) {
  const options = spec || {};
  const defaults = options.defaults || {};
  const flags = options.flags || {};
  const out = {};

  for (const key of Object.keys(defaults)) {
    out[key] = cloneDefaultValue(defaults[key]);
  }

  const configuredStartIndex = Number.isFinite(options.startIndex) ? options.startIndex : 1;
  const onError = options.onError === "null" ? "null" : "throw";
  const allowUnknown = options.allowUnknown === true;
  const helpFlags = options.helpFlags === false ? [] : (options.helpFlags || ["-h", "--help"]);
  const onHelp = options.onHelp || "null";
  const helpKey = options.helpKey || "help";
  const reportError = typeof options.reportError === "function"
    ? options.reportError
    : (options.reportError
        ? (msg) => {
            std.err.puts(String(msg) + "\n");
            std.err.flush();
          }
        : null);

  const byName = Object.create(null);
  const entries = [];

  const addNames = (key, def) => {
    const raw = def && (def.names || def.name);
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [`--${key}`];
    return list.map((name) => (String(name).startsWith("-") ? String(name) : `--${String(name)}`));
  };

  const fail = (msg) => {
    if (reportError) {
      try { reportError(msg); } catch {}
    }
    if (onError === "null") return null;
    throw new Error(msg);
  };

  for (const key of Object.keys(flags)) {
    const def = flags[key] || {};
    const entry = { key, def, names: addNames(key, def) };
    entries.push(entry);
    if (!(key in out) && def.multiple) out[key] = [];
    for (const name of entry.names) byName[name] = entry;
  }

  let startIndex = configuredStartIndex;
  if (startIndex === 1 && Array.isArray(argv) && argv.length > 0) {
    const firstArg = String(argv[0] || "");
    if (firstArg.startsWith("-")) startIndex = 0;
  }

  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (helpFlags.indexOf(arg) >= 0) {
      if (onHelp === "set") {
        out[helpKey] = true;
        continue;
      }
      return null;
    }

    const entry = byName[arg];
    if (!entry) {
      if (allowUnknown) continue;
      return fail(`unknown arg: ${arg}`);
    }

    const def = entry.def || {};
    const boolFlag = def.type === "boolean" || def.boolean === true || def.flag === true;

    if (boolFlag) {
      const value = Object.prototype.hasOwnProperty.call(def, "value") ? def.value : true;
      if (typeof def.set === "function") def.set(out, value, value, arg, argv, i);
      else if (def.multiple) {
        if (!Array.isArray(out[entry.key])) out[entry.key] = [];
        out[entry.key].push(value);
      } else out[entry.key] = value;
      continue;
    }

    if (i + 1 >= argv.length) return fail(`missing value for ${arg}`);
    const raw = argv[++i];
    let value;
    if (typeof def.parse === "function") value = def.parse(raw, out[entry.key], out, arg, argv, i);
    else if (def.type === "number") value = Number(raw);
    else value = raw;

    if (value === undefined && def.skipUndefined) continue;
    if (typeof def.validate === "function" && !def.validate(value, out, raw)) {
      return fail(def.invalidMessage || `invalid value for ${arg}: ${raw}`);
    }

    if (typeof def.set === "function") def.set(out, value, raw, arg, argv, i);
    else if (def.multiple) {
      if (!Array.isArray(out[entry.key])) out[entry.key] = [];
      out[entry.key].push(value);
    } else out[entry.key] = value;
  }

  for (const entry of entries) {
    if (!entry.def || !entry.def.required) continue;
    if (!hasRequiredValue(out[entry.key])) {
      return fail(`missing required flag: ${entry.names[0]}`);
    }
  }

  if (typeof options.finalize === "function") {
    const finalized = options.finalize(out);
    if (finalized === null) return null;
    if (finalized === false) return fail(options.finalizeError || "invalid arguments");
    if (finalized !== undefined) return finalized;
  }

  return out;
}

export function run(argv, spec) {
  const options = spec || {};
  const buildArgs = typeof options.buildArgs === "function" ? options.buildArgs : null;
  const main = typeof options.main === "function" ? options.main : null;
  const usage = typeof options.usage === "function" ? options.usage : null;
  const nullExitCode = Number.isFinite(options.nullExitCode) ? options.nullExitCode : 2;
  const errorExitCode = Number.isFinite(options.errorExitCode) ? options.errorExitCode : 1;
  const formatError = typeof options.formatError === "function"
    ? options.formatError
    : (error) => {
        std.err.puts(defaultErrorText(error) + "\n");
        std.err.flush();
      };

  if (!main) throw new Error("run() requires main");

  try {
    const parsed = buildArgs ? buildArgs(argv) : argv;
    if (parsed === null || parsed === undefined) {
      if (usage) usage();
      std.exit(nullExitCode);
      return;
    }
    const rc = main(parsed, argv);
    std.exit(typeof rc === "number" ? rc : 0);
  } catch (error) {
    formatError(error);
    std.exit(errorExitCode);
  }
}
