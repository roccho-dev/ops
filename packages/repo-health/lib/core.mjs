import crypto from 'node:crypto';
import { JEV_MODEL, validateJevBudget } from '../../jev-review/core.mjs';
import { evaluate } from '../../jev-review/review.mjs';
export { JEV_MODEL, validateJevBudget };

export const EXPECTED_REPOSITORIES = [
  'roccho-dev/adrs',
  'roccho-dev/governance',
  'roccho-dev/ops',
  'roccho-dev/ui',
  'roccho-dev/envs',
  'roccho-dev/flakes',
  'roccho-dev/chatgpt',
];

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const exact = (x, names) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === names.length && names.every((name) => Object.hasOwn(x, name));

export function parseJsonl(text) {
  return String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`invalid JSONL line ${index + 1}: ${error.message}`); }
  });
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;
}

export function flakePackageNames(show) {
  if (show == null || typeof show !== 'object' || Array.isArray(show)) throw new Error('invalid Nix flake show payload');
  if (show.packages == null) return [];
  if (typeof show.packages !== 'object' || Array.isArray(show.packages)) throw new Error('invalid Nix packages surface');
  const names = new Set();
  for (const [system, values] of Object.entries(show.packages)) {
    if (values == null || typeof values !== 'object' || Array.isArray(values)) throw new Error(`invalid Nix packages surface for ${system}`);
    for (const name of Object.keys(values)) {
      if (!/^[A-Za-z0-9._+-]+$/u.test(name)) throw new Error(`invalid Nix package name: ${name}`);
      names.add(name);
    }
  }
  return [...names].sort();
}

export function isSafeSemanticPath(value) {
  const file = String(value ?? '').replaceAll('\\\\', '/');
  const parts = file.split('/');
  const base = parts.at(-1) ?? '';
  if (parts.includes('secrets') || parts.includes('.secrets')) return false;
  if (/^\.env(?:\.|$)/u.test(base)) return false;
  if (/(?:^|[-_.])(credential|credentials|private[-_.]?key|id_rsa|id_ed25519)(?:[-_.]|$)/iu.test(base)) return false;
  if (/\.(?:pem|key|p12|pfx)$/iu.test(base)) return false;
  return true;
}

export function validateScope(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_REPOSITORIES.length) throw new Error('scope must contain exactly 7 repositories');
  const ids = new Set();
  const repositories = new Set();
  for (const row of rows) {
    if (row?.kind !== 'repoHealth.scope.v1') throw new Error('invalid scope kind');
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(row.id ?? '')) throw new Error(`invalid scope id: ${row?.id}`);
    if (ids.has(row.id)) throw new Error(`duplicate scope id: ${row.id}`);
    if (repositories.has(row.repository)) throw new Error(`duplicate repository: ${row.repository}`);
    if (!EXPECTED_REPOSITORIES.includes(row.repository)) throw new Error(`unexpected repository: ${row.repository}`);
    if (typeof row.path !== 'string' || row.path === '' || row.path.includes('..') || row.path.startsWith('/')) throw new Error(`invalid repository path: ${row.path}`);
    ids.add(row.id); repositories.add(row.repository);
  }
  for (const repository of EXPECTED_REPOSITORIES) if (!repositories.has(repository)) throw new Error(`missing repository: ${repository}`);
  return rows;
}

export function validateRules(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('at least one rule is required');
  const ids = new Set();
  for (const row of rows) {
    if (!exact(row, ['kind', 'id', 'concern']) || row.kind !== 'repoHealth.rule.v2') throw new Error('invalid rule contract');
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(row.id ?? '') || ids.has(row.id)) throw new Error(`invalid or duplicate rule id: ${row?.id}`);
    if (typeof row.concern !== 'string' || row.concern.trim() === '') throw new Error(`rule ${row.id} requires concern`);
    ids.add(row.id);
  }
  return rows;
}

export function validateObservation(row) {
  if (row?.kind !== 'repoHealth.observation.v1') throw new Error('invalid observation kind');
  if (!EXPECTED_REPOSITORIES.includes(row.repository)) throw new Error(`unexpected observed repository: ${row?.repository}`);
  if (!/^[0-9a-f]{40}$/u.test(row.revision ?? '') || !/^[0-9a-f]{40}$/u.test(row.tree ?? '')) throw new Error(`observation ${row.repository} requires exact revision and tree`);
  if (row.dirty !== false) throw new Error(`observation ${row.repository} must be clean`);
  if (!row.root || typeof row.root.purpose !== 'string') throw new Error(`observation ${row.repository} requires root subject`);
  if (!Array.isArray(row.packages)) throw new Error(`observation ${row.repository} requires packages array`);
  const ids = new Set();
  for (const pkg of row.packages) {
    if (typeof pkg.id !== 'string' || pkg.id === '' || ids.has(pkg.id)) throw new Error(`duplicate/invalid package id in ${row.repository}: ${pkg?.id}`);
    if (typeof pkg.path !== 'string' || !(pkg.path.startsWith('packages/') || pkg.path.startsWith('flake.nix#packages.'))) throw new Error(`invalid package path in ${row.repository}: ${pkg?.path}`);
    if (typeof pkg.purpose !== 'string' || pkg.purpose.trim() === '') throw new Error(`package subject missing in ${row.repository}: ${pkg.id}`);
    ids.add(pkg.id);
  }
  return row;
}

export function semanticReviewInput(observation, rules) {
  validateObservation(observation); validateRules(rules);
  const targets = [
    { kind: 'repo', id: observation.repoId, path: '.' },
    ...observation.packages.map((pkg) => ({ kind: 'package', id: pkg.id, path: pkg.path })),
  ];
  return {
    themes: rules.map((rule) => rule.id),
    items: rules.flatMap((rule) => targets.map((target) => ({
      theme: rule.id,
      subject: [target.kind, target.id],
      concern: rule.concern,
    }))),
    targets,
  };
}

export async function evaluateObservation({ observation, rules, ask }) {
  if (typeof ask !== 'function') throw new Error('INVALID_SEMANTIC_EVALUATOR');
  const input = semanticReviewInput(observation, rules);
  const packagesById = new Map(observation.packages.map((pkg) => [pkg.id, pkg]));
  const budgetError = (error) => /^Jev (?:state|state\+question|request) budget exceeded:/u.test(String(error?.message ?? ''));

  const repositoryState = {
    kind: 'repoHealth.repositorySemanticState.v1',
    repository: observation.repository,
    revision: observation.revision,
    tree: observation.tree,
    root: observation.root,
    packageCount: observation.packages.length,
    packageIndex: observation.packages.map((pkg) => ({
      id: pkg.id,
      path: pkg.path,
      evidence: {
        testCount: pkg.evidence?.testCount ?? 0,
        checkCount: pkg.evidence?.checkCount ?? 0,
      },
      trackedFiles: pkg.trackedFiles ?? 0,
    })),
  };

  const packageStateFor = (items) => {
    const ids = [...new Set(items
      .filter((item) => item.subject?.[0] === 'package')
      .map((item) => item.subject[1]))];
    return {
      kind: 'repoHealth.packageSemanticState.v1',
      repository: observation.repository,
      revision: observation.revision,
      tree: observation.tree,
      root: observation.root,
      packages: ids.map((id) => packagesById.get(id)).filter(Boolean),
    };
  };

  const evaluateAdaptive = async (stateFor, items) => {
    if (!items.length) return [];
    const state = stateFor(items);
    try {
      return [await evaluate(state, { themes: input.themes, items }, ask)];
    } catch (error) {
      if (!budgetError(error) || items.length < 2) throw error;
      const middle = Math.ceil(items.length / 2);
      return [
        ...await evaluateAdaptive(stateFor, items.slice(0, middle)),
        ...await evaluateAdaptive(stateFor, items.slice(middle)),
      ];
    }
  };

  const repoItems = input.items.filter((item) => item.subject?.[0] === 'repo');
  const packageItems = input.items.filter((item) => item.subject?.[0] === 'package');
  const results = [
    ...await evaluateAdaptive(() => repositoryState, repoItems),
    ...await evaluateAdaptive(packageStateFor, packageItems),
  ];
  const targetPath = new Map(input.targets.map((target) => [`${target.kind}\0${target.id}`, target.path]));
  const subjectDigest = sha256(observation);
  const judgments = results.flatMap((result) => result.judgments).map((row) => ({
    kind: 'repoHealth.judgment.v2',
    repository: observation.repository,
    revision: observation.revision,
    targetKind: row.subject[0],
    targetId: row.subject[1],
    targetPath: targetPath.get(`${row.subject[0]}\0${row.subject[1]}`),
    ruleId: row.theme,
    noul: row.noul,
    subjectDigest,
    model: JEV_MODEL,
  }));
  const findingsFor = (kind, id) => judgments
    .filter((row) => row.targetKind === kind && row.targetId === id)
    .map((row) => ({ ruleId: row.ruleId, noul: row.noul }))
    .sort((a, b) => b.noul - a.noul || compare(a.ruleId, b.ruleId));
  const packages = observation.packages.map((pkg) => ({
    kind: 'repoHealth.package.v2',
    repository: observation.repository,
    revision: observation.revision,
    packageId: pkg.id,
    packagePath: pkg.path,
    deterministicStatus: 'PASS',
    semanticStatus: 'EVALUATED',
    findings: findingsFor('package', pkg.id),
  }));
  const repo = {
    kind: 'repoHealth.repo.v2',
    repoId: observation.repoId,
    repository: observation.repository,
    revision: observation.revision,
    tree: observation.tree,
    deterministicStatus: 'PASS',
    semanticStatus: 'EVALUATED',
    packageCount: packages.length,
    findings: findingsFor('repo', observation.repoId),
  };
  return {
    model: JEV_MODEL,
    repo,
    packages,
    judgments,
    usage: { calls: results.reduce((sum, result) => sum + result.calls, 0), batches: results.map((result) => result.usage) },
  };
}

export function unknownEvaluation({ scopeRow, observation = null, reason }) {
  const observed = observation != null;
  const packages = observation?.packages ?? [];
  const deterministicStatus = observed ? 'PASS' : 'UNKNOWN';
  const semanticStatus = observed ? 'ERROR' : 'BLOCKED';
  return {
    model: null,
    repo: {
      kind: 'repoHealth.repo.v2',
      repoId: scopeRow.id,
      repository: scopeRow.repository,
      revision: observation?.revision ?? null,
      tree: observation?.tree ?? null,
      deterministicStatus,
      semanticStatus,
      packageCount: packages.length,
      findings: [{ ruleId: 'runtime', reason }],
    },
    packages: packages.map((pkg) => ({
      kind: 'repoHealth.package.v2',
      repository: scopeRow.repository,
      revision: observation?.revision ?? null,
      packageId: pkg.id,
      packagePath: pkg.path,
      deterministicStatus,
      semanticStatus,
      findings: [{ ruleId: 'runtime', reason }],
    })),
    judgments: [],
    reason,
  };
}

export function buildOutputs({ scope, rules, evaluations }) {
  validateScope(scope); validateRules(rules);
  const byRepo = new Map();
  for (const value of evaluations) {
    const repository = value?.repo?.repository;
    if (!EXPECTED_REPOSITORIES.includes(repository)) throw new Error(`unexpected evaluation repository: ${repository}`);
    if (byRepo.has(repository)) throw new Error(`duplicate evaluation repository: ${repository}`);
    byRepo.set(repository, value);
  }
  const ordered = scope.map((row) => byRepo.get(row.repository) ?? unknownEvaluation({ scopeRow: row, reason: 'repository not evaluated' }));
  const repos = ordered.map((value) => value.repo);
  const summary = {
    expected: scope.length,
    observed: repos.filter((repo) => repo.revision).length,
    deterministicPass: repos.filter((repo) => repo.deterministicStatus === 'PASS').length,
    deterministicUnknown: repos.filter((repo) => repo.deterministicStatus === 'UNKNOWN').length,
    semanticEvaluated: repos.filter((repo) => repo.semanticStatus === 'EVALUATED').length,
    semanticError: repos.filter((repo) => repo.semanticStatus === 'ERROR').length,
    semanticBlocked: repos.filter((repo) => repo.semanticStatus === 'BLOCKED').length,
  };
  const reportRows = [];
  for (const value of ordered) reportRows.push(value.repo, ...value.packages, ...value.judgments);
  const reportText = reportRows.map((row) => stableJson(row)).join('\n') + '\n';
  const receipt = {
    kind: 'repoHealth.receipt.v2',
    authority: false,
    model: JEV_MODEL,
    summary,
    scopeDigest: sha256(scope),
    ruleDigest: sha256(rules),
    reportDigest: sha256(reportText),
    complete: summary.observed === summary.expected
      && summary.deterministicUnknown === 0
      && summary.semanticError === 0
      && summary.semanticBlocked === 0,
  };
  return { summary, reportRows, reportText, receipt, html: renderHtml({ summary, ordered, receipt }) };
}

export function renderHtml({ summary, ordered, receipt }) {
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const findingText = (finding) => finding.reason
    ? `${esc(finding.ruleId)} — ${esc(finding.reason)}`
    : `${esc(finding.ruleId)}: ${Number(finding.noul).toFixed(3)}`;
  const boxes = ordered.map((value) => {
    const repo = value.repo;
    const repoFindings = (repo.findings ?? []).map((finding) => `<div class="finding">↳ ${findingText(finding)}</div>`).join('');
    const packages = value.packages.map((pkg) => {
      const finding = (pkg.findings ?? [])[0];
      return `<div class="pkg"><span>${esc(pkg.packageId)}</span><strong>${esc(pkg.deterministicStatus)} / ${esc(pkg.semanticStatus)}</strong></div>${finding ? `<div class="finding">↳ ${findingText(finding)}</div>` : ''}`;
    }).join('');
    return `<section class="repo"><header><span>${esc(repo.repoId)}</span><strong>${esc(repo.deterministicStatus)} / ${esc(repo.semanticStatus)}</strong></header>${repoFindings}${packages}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generated-artifact-authority" content="false"><title>Major Repo Health</title><style>html{font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#111;background:#fff}body{margin:0;padding:20px}main{max-width:1100px;margin:auto}h1{font-size:18px;margin:0 0 4px}.summary{margin-bottom:16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.repo{border:1px solid #111;padding:8px}.repo header,.pkg{display:flex;justify-content:space-between;gap:12px}.repo header{padding-bottom:6px;border-bottom:1px solid #111;margin-bottom:5px}.pkg{padding:3px 0}.finding{padding:2px 0 5px 14px;opacity:.8;font-size:12px}.receipt{margin-top:14px;font-size:11px;opacity:.65;word-break:break-all}</style></head><body><main><h1>Major Repo Health</h1><div class="summary">observed ${summary.observed}/${summary.expected} | deterministic unknown ${summary.deterministicUnknown} | semantic error ${summary.semanticError} | semantic blocked ${summary.semanticBlocked}</div><div class="grid">${boxes}</div><div class="receipt">report ${esc(receipt.reportDigest)} · authority=false</div></main></body></html>\n`;
}
