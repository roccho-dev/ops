#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const astGrep = process.env.AST_GREP_BIN ?? "ast-grep";
const normalizer = path.join(root, "providers/structure/astgrep/normalize.mjs");
const sha256 = (file) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;

const languages = {
  go: {
    extension: "go",
    rule: path.join(root, "rulepacks/astgrep/go/forbidden-imports.yml"),
    expected: { good: [], bad: [{ module: "os", line: 2 }], "false-positive": [], "false-negative": [{ module: "os", line: 2 }] },
    synthetic: `package x\nimport alias "os"\nimport (\n  "net/http"\n  _ "embed"\n)\nconst doc = \`import "socket"\`\n`,
    syntheticExpected: [{ module: "embed", line: 5 }, { module: "net/http", line: 4 }, { module: "os", line: 2 }],
  },
  javascript: {
    extension: "mjs",
    rule: path.join(root, "rulepacks/astgrep/javascript/forbidden-imports.yml"),
    expected: { good: [], bad: [{ module: "node:fs", line: 1 }], "false-positive": [], "false-negative": [{ module: "node:fs", line: 1 }] },
    synthetic: `import "node:fs";\nimport value from "fs";\nconst a = import("node:http");\nconst b = require("child_process");\nconst doc = 'require("net")';\n`,
    syntheticExpected: [{ module: "child_process", line: 4 }, { module: "fs", line: 2 }, { module: "node:fs", line: 1 }, { module: "node:http", line: 3 }],
  },
  python: {
    extension: "py",
    rule: path.join(root, "rulepacks/astgrep/python/forbidden-imports.yml"),
    expected: { good: [], bad: [{ module: "os", line: 1 }], "false-positive": [], "false-negative": [{ module: "os", line: 1 }] },
    synthetic: `import os as alias\nimport sys, urllib.request\nfrom urllib.request import urlopen\nfrom http import client as c\nDOCUMENTATION = "import socket"\n`,
    syntheticExpected: [{ module: "http", line: 4 }, { module: "os", line: 1 }, { module: "sys", line: 2 }, { module: "urllib.request", line: 2 }, { module: "urllib.request", line: 3 }],
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (!(options.allowed ?? [0]).includes(result.status)) throw new Error(`${command} ${args.join(" ")} => ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function report(language, config, source, options = {}) {
  const result = run("node", [normalizer, "--ast-grep", options.astGrep ?? astGrep, "--rule", options.rule ?? config.rule, "--source", source, "--language", language], options);
  return JSON.parse(result.stdout);
}

const version = run(astGrep, ["--version"]).stdout.trim();
assert.equal(version, "ast-grep 0.42.1");
const binary = astGrep.includes(path.sep) ? path.resolve(astGrep) : run("sh", ["-c", `command -v -- ${JSON.stringify(astGrep)}`]).stdout.trim();
const cases = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "issue172-conformance-"));
try {
  for (const [language, config] of Object.entries(languages)) {
    for (const kind of ["good", "bad", "false-positive", "false-negative"]) {
      const source = path.join(root, "fixtures", language, kind, `core.${config.extension}`);
      const actual = report(language, config, source);
      assert.deepEqual(actual, { schema: "shiftleft-import-report/1", imports: config.expected[kind] }, `${language}/${kind}`);
      cases.push({ id: `${language}.${kind}`, status: "PASS", imports: actual.imports });
    }
    const source = path.join(temp, `synthetic.${config.extension}`);
    fs.writeFileSync(source, config.synthetic);
    const actual = report(language, config, source);
    assert.deepEqual(actual, { schema: "shiftleft-import-report/1", imports: config.syntheticExpected }, `${language}/synthetic`);
    cases.push({ id: `${language}.synthetic`, status: "PASS", imports: actual.imports });
  }

  const fake = path.join(temp, "fake-ast-grep");
  fs.writeFileSync(fake, "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'ast-grep 0.42.1'; else echo '{broken'; fi\n", { mode: 0o755 });
  const malformed = run("node", [normalizer, "--ast-grep", fake, "--rule", languages.python.rule, "--source", path.join(root, "fixtures/python/good/core.py"), "--language", "python"], { allowed: [1] });
  assert.match(malformed.stderr, /ASTGREP_OUTPUT_INVALID/);

  const unsupported = run("node", [normalizer, "--ast-grep", astGrep, "--rule", languages.python.rule, "--source", path.join(root, "fixtures/python/good/core.py"), "--language", "ruby"], { allowed: [1] });
  assert.match(unsupported.stderr, /UNSUPPORTED_LANGUAGE/);

  cases.sort((a, b) => a.id.localeCompare(b.id));
  process.stdout.write(`${JSON.stringify({
    schema: "shiftleft-astgrep-conformance/1",
    status: "PASS",
    phase: 2,
    astGrepVersion: version,
    astGrepBinarySha256: sha256(binary),
    normalizerSha256: sha256(normalizer),
    rulepacks: Object.fromEntries(Object.entries(languages).map(([language, config]) => [language, sha256(config.rule)])),
    malformedOutput: "BLOCKED",
    unsupportedLanguage: "BLOCKED",
    cases,
  })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
