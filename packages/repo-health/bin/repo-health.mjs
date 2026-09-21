#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildOutputs, evaluateObservation, flakePackageNames, makeQuestions, parseJsonl, unknownEvaluation,
  validateJevBudget, validateRules, validateScope,
} from '../lib/core.mjs';
import { materializeBareScope } from '../lib/source.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return 'usage: repo-health run (--root DIR | --bare-root DIR) --out DIR [--scope FILE] [--rules FILE]';
}

function args(argv) {
  if (argv[0] !== 'run') throw new Error(usage());
  const out = { scope: path.join(packageRoot, 'scope.jsonl'), rules: path.join(packageRoot, 'rules.jsonl') };
  const keys = { '--root': 'root', '--bare-root': 'bareRoot', '--out': 'out', '--scope': 'scope', '--rules': 'rules' };
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!value || !keys[key]) throw new Error(usage());
    out[keys[key]] = value;
  }
  if (!out.out || Boolean(out.root) === Boolean(out.bareRoot)) throw new Error(usage());
  return out;
}

function git(repo, ...argv) {
  return execFileSync('git', ['-C', repo, ...argv], { encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:32*1024*1024 }).trim();
}

function excerpt(file, limit = 280) {
  try { return fs.readFileSync(file, 'utf8').slice(0, limit); } catch { return ''; }
}

function tracked(repo) {
  return git(repo, 'ls-files', '-z').split('\0').filter(Boolean).sort();
}

function packageRows(repo) {
  try { return parseJsonl(fs.readFileSync(path.join(repo, 'build/packages.jsonl'), 'utf8')); } catch { return []; }
}

function nixPackageNames(repo) {
  if (!fs.existsSync(path.join(repo, 'flake.nix'))) return [];
  const raw = execFileSync('nix', ['flake', 'show', '--json', '--no-write-lock-file', `path:${repo}`], {
    encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:32*1024*1024,
  });
  let show;
  try { show = JSON.parse(raw); } catch (error) { throw new Error(`invalid nix flake show JSON: ${error.message}`); }
  return flakePackageNames(show);
}

function discoverPackages(repo, files) {
  const found = new Map();
  for (const file of files) {
    const match = file.match(/^packages\/([^/]+)\//u);
    if (match) found.set(match[1], `packages/${match[1]}`);
  }
  for (const row of packageRows(repo)) {
    if (!row?.name) continue;
    const entry = typeof row.entry === 'string' ? row.entry : '';
    const match = entry.match(/^(packages\/[^/]+)/u);
    found.set(row.name, match?.[1] ?? `packages/${row.name}`);
  }
  for (const name of nixPackageNames(repo)) {
    if (!found.has(name)) found.set(name, `flake.nix#packages.*.${name}`);
  }
  return [...found].sort(([a],[b]) => a.localeCompare(b)).map(([id, packagePath]) => {
    const sourcePackage = packagePath.startsWith('packages/');
    const base = sourcePackage ? path.join(repo, packagePath) : repo;
    const packageFiles = sourcePackage ? files.filter((file) => file === packagePath || file.startsWith(`${packagePath}/`)) : ['flake.nix'];
    const allTests = packageFiles.filter((file) => /(^|\/)(test|tests|spec|specs)(\/|\.|$)|\.(test|spec)\./iu.test(file));
    const allChecks = (() => {
      try { return parseJsonl(fs.readFileSync(path.join(repo, 'build/checks.jsonl'),'utf8')); } catch { return []; }
    })().filter((row) => typeof row.script === 'string' && row.script.startsWith(`${packagePath}/`)).map((row) => row.name);
    const tests = allTests.slice(0,2);
    const checkRows = allChecks.slice(0,2);
    const implementation = packageFiles.find((file) =>
      !/(^|\/)(test|tests|spec|specs)(\/|\.|$)|\.(test|spec)\./iu.test(file)
      && /\.(mjs|js|ts|py|go|nix|md|json|jsonl)$/iu.test(file)
    );
    const purpose = sourcePackage
      ? (excerpt(path.join(base, 'README.md'), 280) || excerpt(path.join(base, 'package.json'), 280) || excerpt(path.join(base, 'default.nix'), 280)
        || (implementation ? `Declared source package ${id}.\n${excerpt(path.join(repo, implementation), 280)}` : ''))
      : `Declared Nix package output ${id} from flake.nix.`;
    return {
      id,
      path: packagePath,
      purpose,
      evidence: { testCount: allTests.length, checkCount: allChecks.length, tests, checks: checkRows },
      trackedFiles: packageFiles.length,
    };
  });
}

function observe(scopeRow, root) {
  const repo = path.resolve(root, scopeRow.path);
  if (!fs.existsSync(repo)) throw new Error(`repository path missing: ${scopeRow.path}`);
  const revision = git(repo, 'rev-parse', 'HEAD');
  const tree = git(repo, 'rev-parse', 'HEAD^{tree}');
  const dirty = git(repo, 'status', '--porcelain=v1').length > 0;
  if (dirty) throw new Error(`repository is dirty: ${scopeRow.repository}`);
  const files = tracked(repo);
  return {
    kind:'repoHealth.observation.v1', repoId:scopeRow.id, repository:scopeRow.repository,
    revision, tree, dirty:false,
    root:{ purpose:excerpt(path.join(repo,'README.md'),1200), flake:excerpt(path.join(repo,'flake.nix'),1200), files:files.slice(0,20), trackedFiles:files.length },
    packages:discoverPackages(repo, files),
  };
}

async function jev(observation, rules) {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new Error('JEV_API_KEY is required');
  const { questions, mapping } = makeQuestions(observation, rules);
  validateJevBudget(observation, questions);
  const endpoint = process.env.REPO_HEALTH_JEV_URL || 'https://api.typesafe.ai/v1/systemone';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.REPO_HEALTH_JEV_TIMEOUT_MS || '15000'));
  try {
    const response = await fetch(endpoint, {
      method:'POST', signal:controller.signal,
      headers:{ authorization:`Bearer ${key}`, 'content-type':'application/json' },
      body:JSON.stringify({ state:observation, model:'jev-1.13.0', questions }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
    let payload; try { payload = JSON.parse(text); } catch { throw new Error('Jev response is not JSON'); }
    return evaluateObservation({ observation, rules, response:payload, mapping });
  } finally { clearTimeout(timeout); }
}

async function main() {
  const options = args(process.argv.slice(2));
  const scope = validateScope(parseJsonl(fs.readFileSync(options.scope,'utf8')));
  const rules = validateRules(parseJsonl(fs.readFileSync(options.rules,'utf8')));
  const materialized = options.bareRoot ? materializeBareScope(scope, options.bareRoot) : null;
  const sourceRoot = materialized?.root ?? options.root;
  try {
    const evaluations = [];
    for (const scopeRow of scope) {
      let observation;
      try { observation = observe(scopeRow, sourceRoot); }
      catch (error) { evaluations.push(unknownEvaluation({ scopeRow, rules, reason:`observation: ${error.message}` })); continue; }
      try { evaluations.push(await jev(observation, rules)); }
      catch (error) { evaluations.push(unknownEvaluation({ scopeRow, observation, rules, reason:`jev: ${error.name === 'AbortError' ? 'timeout' : error.message}` })); }
    }
    const outputs = buildOutputs({ scope, rules, evaluations });
    fs.mkdirSync(options.out, { recursive:true });
    fs.writeFileSync(path.join(options.out,'report.jsonl'), outputs.reportText);
    fs.writeFileSync(path.join(options.out,'receipt.json'), `${JSON.stringify(outputs.receipt, null, 2)}\n`);
    fs.writeFileSync(path.join(options.out,'index.html'), outputs.html);
    process.stdout.write(`${JSON.stringify({ status:outputs.receipt.complete?'PASS':'FAIL', ...outputs.summary, source:materialized?'bare-mirror':'worktree', out:path.resolve(options.out) })}\n`);
    if (!outputs.receipt.complete) process.exitCode = 1;
  } finally {
    materialized?.cleanup();
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 2; });
