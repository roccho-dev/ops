#!/usr/bin/env node
// Prove ops as a specs-defined feat implementation repo.
//
// Node ESM port of prove-feat.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

const GATES = ["structure", "format", "deadnix", "contract-lint"];

// ---- JSON serializer matching json.dumps(indent=2, sort_keys=True) ----
function jsonString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
    } else {
      // json.dumps(ensure_ascii=True default) escapes non-ASCII as \uXXXX.
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

function ser(value, sortKeys, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent) {
      const pad = " ".repeat(indent * (depth + 1));
      const closePad = " ".repeat(indent * depth);
      return "[\n" + value.map((v) => pad + ser(v, sortKeys, indent, depth + 1)).join(",\n") + "\n" + closePad + "]";
    }
    return "[" + value.map((v) => ser(v, sortKeys, indent, depth + 1)).join(", ") + "]";
  }
  let keys = Object.keys(value);
  if (sortKeys) keys = keys.sort();
  if (keys.length === 0) return "{}";
  if (indent) {
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    return (
      "{\n" +
      keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(",\n") +
      "\n" +
      closePad +
      "}"
    );
  }
  return "{" + keys.map((k) => jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1)).join(", ") + "}";
}

function dumpsSorted2(value) {
  return ser(value, true, 2, 0);
}

// ---- filesystem helpers mirroring pathlib ----
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function readJson(p) {
  return JSON.parse(readText(p));
}

// pathlib.PurePath.relative_to(...).as_posix(): on Linux paths already use "/".
function rel(p, root) {
  let r = path.relative(root, p);
  return r.split(path.sep).join("/");
}

function command(args, cwd) {
  // subprocess.run(args, cwd=cwd, text=True, capture_output=True)
  const proc = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  let returncode = proc.status;
  if (returncode === null) returncode = proc.signal ? 128 : 1;
  return {
    returncode,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
  };
}

function gitRoot(cwd) {
  const result = command(["git", "rev-parse", "--show-toplevel"], cwd);
  if (result.returncode === 0) {
    return result.stdout.trim();
  }
  return path.resolve(cwd);
}

function gateNixFiles(root) {
  const files = [path.join(root, "flake.nix"), path.join(root, "packages", "prove-feat", "default.nix")];
  return files.filter((p) => isFile(p));
}

function checkItem(items, checkId, ok, detail) {
  items.push({ id: checkId, ok: Boolean(ok), detail });
}

function manifestPath(root) {
  const jsonPath = path.join(root, "spec", "implements.json");
  const tsvPath = path.join(root, "feat", "implements.tsv");
  if (isFile(jsonPath)) return jsonPath;
  if (isFile(tsvPath)) return tsvPath;
  return jsonPath;
}

class ValueError extends Error {}

function manifestJson(root) {
  const p = manifestPath(root);
  // pathlib suffix: ".json"; mirror "path.suffix != '.json' or not is_file()".
  if (path.extname(p) !== ".json" || !isFile(p)) {
    throw new ValueError("expected spec/implements.json");
  }
  return readJson(p);
}

function lockedNode(lock, name) {
  try {
    const locked = lock["nodes"][name]["locked"];
    if (locked === undefined) return {};
    return locked;
  } catch {
    return {};
  }
}

function loadSpecData(args) {
  const catalogPath = args.spec_catalog || process.env.PROVE_FEAT_SPEC_CATALOG || "";
  const placementPath = args.spec_placement_table || process.env.PROVE_FEAT_SPEC_PLACEMENT_TABLE || "";
  const catalog = catalogPath && isFile(catalogPath) ? readJson(catalogPath) : [];
  const placement = placementPath && isFile(placementPath) ? readJson(placementPath) : [];
  return { catalog, placement };
}

function packageCatalogByName(args) {
  const { catalog } = loadSpecData(args);
  const out = {};
  for (const entry of catalog) {
    const pkg = entry && entry.package;
    if (pkg) out[pkg] = entry;
  }
  return out;
}

function proveFeatOutputPolicy(args) {
  const pkg = packageCatalogByName(args)["prove-feat"] || {};
  const gate = pkg.outputReviewGate;
  return gate && typeof gate === "object" && !Array.isArray(gate) ? gate : {};
}

function manifestKind(manifest) {
  return manifest.kind || manifest.schema;
}

function normalizeRef(ref, system) {
  return ref.split("<system>").join(system);
}

function outputName(ref, prefix, system) {
  const normalized = normalizeRef(ref, system);
  const expected = `${prefix}.${system}.`;
  if (!normalized.startsWith(expected)) return null;
  return normalized.slice(expected.length);
}

function reEscape(s) {
  // Mirror Python re.escape for the characters relevant here.
  return String(s).replace(/[.*+?^${}()|[\]\\#\-\s]/g, "\\$&");
}

function attrDefined(flakeText, name) {
  const escaped = reEscape(name);
  const patterns = [new RegExp(`(^|\\s)"${escaped}"\\s*=`), new RegExp(`(^|\\s)${escaped}\\s*=`)];
  return patterns.some((pattern) => pattern.test(flakeText));
}

function forbiddenFlakeOutputLines(flakeText, outName) {
  const escaped = reEscape(outName);
  const pattern = new RegExp(`^\\s*${escaped}\\s*=`, "gm");
  const starts = [];
  let m;
  while ((m = pattern.exec(flakeText)) !== null) {
    starts.push(m.index);
    if (m.index === pattern.lastIndex) pattern.lastIndex++;
  }
  return starts;
}

function allOk(items) {
  return items.every((item) => item.ok);
}

function runStructure(root, system, args) {
  const items = [];
  const flake = path.join(root, "flake.nix");
  const lockPath = path.join(root, "flake.lock");
  const implPath = manifestPath(root);

  checkItem(items, "flake-nix-exists", isFile(flake), "flake.nix exists");
  checkItem(items, "flake-lock-exists", isFile(lockPath), "flake.lock exists");
  checkItem(items, "implements-manifest-exists", isFile(implPath), `${rel(implPath, root)} exists`);

  const flakeText = isFile(flake) ? readText(flake) : "";
  const governanceDeclared =
    flakeText.includes("governance.url") || /(^|\s)governance\s*=\s*\{/.test(flakeText);
  checkItem(
    items,
    "inputs-governance-declared",
    governanceDeclared,
    "flake.nix declares inputs.governance",
  );
  checkItem(
    items,
    "outputs-receive-governance",
    /outputs\s*=\s*\{[^}]*governance/.test(flakeText),
    "outputs argument includes governance",
  );
  checkItem(items, "prove-feat-package-wired", attrDefined(flakeText, "prove-feat"), "flake.nix defines prove-feat outputs");

  const outputPolicy = proveFeatOutputPolicy(args);
  checkItem(items, "spec-output-policy-loaded", Object.keys(outputPolicy).length > 0, "specs package catalog exposes prove-feat outputReviewGate");
  checkItem(items, "spec-output-policy-package-only", outputPolicy.packageOutputOnly === true, "specs outputReviewGate.packageOutputOnly=true");
  const allowedOutputs = new Set(outputPolicy.allowedTopLevelOutputs || []);
  const forbiddenOutputs = new Set(outputPolicy.forbiddenTopLevelOutputs || []);
  checkItem(
    items,
    "spec-output-policy-allows-packages-checks",
    allowedOutputs.has("packages") && allowedOutputs.has("checks"),
    "specs allows packages/checks top-level outputs",
  );
  checkItem(
    items,
    "spec-output-policy-forbids-apps-devshells",
    forbiddenOutputs.has("apps") && forbiddenOutputs.has("devShells"),
    "specs forbids apps/devShells top-level outputs",
  );
  for (const output of [...forbiddenOutputs].sort()) {
    const matches = forbiddenFlakeOutputLines(flakeText, output);
    const checkId = `no-top-level-${output.toLowerCase()}-output`;
    checkItem(items, checkId, matches.length === 0, `flake.nix does not expose top-level ${output} because specs forbids it`);
  }

  const lock = isFile(lockPath) ? readJson(lockPath) : {};
  const governanceLocked = lockedNode(lock, "governance");
  checkItem(items, "governance-lock-rev", Boolean(governanceLocked.rev), "flake.lock pins nodes.governance.locked.rev");
  checkItem(
    items,
    "governance-lock-nar-hash",
    Boolean(governanceLocked.narHash),
    "flake.lock pins nodes.governance.locked.narHash",
  );

  try {
    const manifest = manifestJson(root);
    checkItem(items, "manifest-kind", manifestKind(manifest) === "spec.implements.v1", "manifest kind/schema is spec.implements.v1");
    checkItem(items, "manifest-system", (manifest.systems || []).includes(system), `manifest systems include ${system}`);
    checkItem(items, "manifest-has-implements", Boolean(manifest.implements && manifest.implements.length), "manifest implements list is non-empty");
    const refs = [];
    for (const item of manifest.implements || []) {
      for (const ref of [...(item.outputs || []), ...(item.checks || [])]) {
        refs.push(normalizeRef(ref, system));
      }
    }
    checkItem(items, "manifest-declares-prove-feat-package", refs.includes(`packages.${system}.prove-feat`), "manifest declares packages.<system>.prove-feat");
    checkItem(items, "manifest-declares-prove-feat-check", refs.includes(`checks.${system}.prove-feat`), "manifest declares checks.<system>.prove-feat");
  } catch (exc) {
    checkItem(items, "manifest-parse", false, errStr(exc));
  }

  return { id: "structure", ok: allOk(items), checks: items };
}

function runFormat(root, system, args) {
  const items = [];
  const nixFiles = gateNixFiles(root);
  checkItem(items, "nix-files-found", nixFiles.length > 0, "prove-feat gate Nix files found");
  if (nixFiles.length) {
    const result = command(["nixfmt", "--check", ...nixFiles], root);
    const detail = (result.stdout + result.stderr).trim() || "nixfmt check passed";
    checkItem(items, "nixfmt-rfc-style", result.returncode === 0, detail);
  }

  const jsonFiles = [path.join(root, "flake.lock"), manifestPath(root)];
  for (const p of jsonFiles) {
    if (isFile(p)) {
      try {
        readJson(p);
        checkItem(items, `json-parse:${rel(p, root)}`, true, "valid JSON");
      } catch (exc) {
        checkItem(items, `json-parse:${rel(p, root)}`, false, errStr(exc));
      }
    }
  }

  return { id: "format", ok: allOk(items), checks: items };
}

function runDeadnix(root, system, args) {
  const items = [];
  const nixFiles = gateNixFiles(root);
  checkItem(items, "nix-files-found", nixFiles.length > 0, "prove-feat gate Nix files found");
  if (nixFiles.length) {
    const result = command(["deadnix", "--fail", ...nixFiles], root);
    const detail = (result.stdout + result.stderr).trim() || "deadnix passed";
    checkItem(items, "deadnix", result.returncode === 0, detail);
  }
  return { id: "deadnix", ok: allOk(items), checks: items };
}

function runContractLint(root, system, args) {
  const items = [];
  const flakeText = readText(path.join(root, "flake.nix"));
  const lock = readJson(path.join(root, "flake.lock"));
  const manifest = manifestJson(root);
  const { catalog, placement } = loadSpecData(args);
  const specPackages = new Set();
  for (const entry of catalog) {
    if (entry && entry.package) specPackages.add(entry.package);
  }
  const placementByPackage = {};
  for (const entry of placement) {
    if (entry && entry.package) placementByPackage[entry.package] = entry;
  }

  checkItem(items, "spec-catalog-loaded", specPackages.size > 0, "specs package catalog is readable");
  checkItem(items, "spec-placement-loaded", Object.keys(placementByPackage).length > 0, "specs placement table is readable");

  // specsless: catalog/placement input is the unified governance repo (manifest.specsRev
  // keeps recording the source-authority specs rev; lock no longer has a specs node).
  const locked = lockedNode(lock, "governance");
  checkItem(items, "governance-rev-recorded", Boolean(locked.rev), "flake.lock records governance rev");
  checkItem(items, "governance-narhash-recorded", Boolean(locked.narHash), "flake.lock records governance narHash");

  const implementList = manifest.implements || [];
  const packages = implementList.map((item) => item.package);
  checkItem(items, "no-duplicate-package-claims", packages.length === new Set(packages).size, "manifest package claims are unique");

  for (const item of implementList) {
    const pkg = item.package;
    const contractId = item.contractId || "";
    const outputs = item.outputs || [];
    const checks = item.checks || [];
    const label = pkg || "<missing>";
    checkItem(items, `${label}:package-present`, Boolean(pkg), "package field is present");
    checkItem(items, `${label}:known-spec-package`, specPackages.has(pkg), "package is present in specs catalog");
    const expectedContract = new RegExp(`^spec\\.packages\\.${reEscape(pkg || "")}\\.v[0-9]+$`);
    checkItem(items, `${label}:contract-id-shape`, expectedContract.test(contractId), `contractId=${contractId}`);
    checkItem(items, `${label}:outputs-present`, outputs.length > 0, "outputs list is non-empty");
    checkItem(items, `${label}:checks-present`, checks.length > 0, "checks list is non-empty");

    const placementRow = placementByPackage[pkg] || {};
    const repoId = placementRow.repoId;
    if (pkg !== "prove-feat") {
      checkItem(items, `${label}:repo-placement-ops`, repoId === "ops", `spec placement repoId=${repoId === undefined ? "None" : repoId}`);
    }

    for (const output of outputs) {
      const name = outputName(output, "packages", system);
      const ok = Boolean(name && attrDefined(flakeText, name));
      checkItem(items, `${label}:output:${output}`, ok, "declared package output is wired in flake.nix");
    }
    for (const check of checks) {
      const name = outputName(check, "checks", system);
      const ok = Boolean(name && attrDefined(flakeText, name));
      checkItem(items, `${label}:check:${check}`, ok, "declared check output is wired in flake.nix");
    }
  }

  const proveFeat = implementList.find((item) => item.package === "prove-feat") || null;
  checkItem(items, "prove-feat-claim-present", Boolean(proveFeat), "manifest claims specs prove-feat contract");
  if (proveFeat) {
    const refs = [...(proveFeat.outputs || []), ...(proveFeat.checks || [])].map((ref) => normalizeRef(ref, system));
    checkItem(items, "prove-feat-package-contract", refs.includes(`packages.${system}.prove-feat`), "prove-feat claim exposes packages.<system>.prove-feat");
    checkItem(items, "prove-feat-check-contract", refs.includes(`checks.${system}.prove-feat`), "prove-feat claim exposes checks.<system>.prove-feat");
  }

  return { id: "contract-lint", ok: allOk(items), checks: items };
}

const RUNNERS = {
  structure: runStructure,
  format: runFormat,
  deadnix: runDeadnix,
  "contract-lint": runContractLint,
};

function errStr(exc) {
  if (exc instanceof SyntaxError) {
    // json.loads raises json.JSONDecodeError; detail text differs from Node, but
    // these paths only fire on malformed JSON which is not exercised by the gate.
    return exc.message;
  }
  if (exc instanceof Error) return exc.message;
  return String(exc);
}

// ---- argument parsing (faithful argparse reproduction; prog = prove-feat.mjs) ----
// argparse uses the script basename for prog; this Node port is invoked as
// prove-feat.mjs, so usage wrapping is byte-reproduced for that prog name.
const PROG = "prove-feat.mjs";

const TOP_USAGE =
  `usage: ${PROG} [-h] [--root ROOT] [--system SYSTEM]\n` +
  `                      [--gate {structure,format,deadnix,contract-lint}]\n` +
  `                      [--json] [--spec-catalog SPEC_CATALOG]\n` +
  `                      [--spec-placement-table SPEC_PLACEMENT_TABLE]\n`;

function usageError(msg) {
  process.stderr.write(TOP_USAGE);
  process.stderr.write(`${PROG}: error: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    root: null,
    system: process.env.PROVE_FEAT_SYSTEM || "x86_64-linux",
    gate: null,
    json: false,
    spec_catalog: null,
    spec_placement_table: null,
  };
  const unrecognized = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      // argparse prints help to stdout and exits 0; help body not byte-reproduced
      // (the gate never invokes -h). Emit usage and exit 0.
      process.stdout.write(TOP_USAGE);
      process.exit(0);
    } else if (a === "--root") {
      out.root = argv[++i];
    } else if (a === "--system") {
      out.system = argv[++i];
    } else if (a === "--gate") {
      const val = argv[++i];
      if (!GATES.includes(val)) {
        usageError(`argument --gate: invalid choice: '${val}' (choose from ${GATES.join(", ")})`);
      }
      if (out.gate === null) out.gate = [];
      out.gate.push(val);
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--spec-catalog") {
      out.spec_catalog = argv[++i];
    } else if (a === "--spec-placement-table") {
      out.spec_placement_table = argv[++i];
    } else {
      // argparse collects all unrecognized args and reports them together at the
      // top-level parser after parsing known options.
      unrecognized.push(a);
    }
  }
  if (unrecognized.length) {
    usageError(`unrecognized arguments: ${unrecognized.join(" ")}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const root = args.root ? path.resolve(args.root) : gitRoot(process.cwd());
  const gates = args.gate || GATES.slice();
  const results = [];
  for (const gate of gates) {
    results.push(RUNNERS[gate](root, args.system, args));
  }
  const ok = results.every((result) => result.ok);
  const report = {
    kind: "ops.prove-feat.report.v1",
    root: String(root),
    system: args.system,
    ok,
    gates: results,
  };

  if (args.json) {
    process.stdout.write(dumpsSorted2(report) + "\n");
  } else {
    let text = "";
    for (const result of results) {
      const status = result.ok ? "pass" : "fail";
      text += `${result.id}: ${status}\n`;
      for (const item of result.checks) {
        const itemStatus = item.ok ? "pass" : "fail";
        text += `  ${itemStatus} ${item.id}: ${item.detail}\n`;
      }
    }
    process.stdout.write(text);
  }
  return ok ? 0 : 1;
}

process.exit(main());
