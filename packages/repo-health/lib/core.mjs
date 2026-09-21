import crypto from 'node:crypto';

export const EXPECTED_REPOSITORIES = [
  'roccho-dev/adrs',
  'roccho-dev/governance',
  'roccho-dev/ops',
  'roccho-dev/ui',
  'roccho-dev/envs',
  'roccho-dev/flakes',
  'roccho-dev/chatgpt',
];

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
    if (row?.kind !== 'repoHealth.rule.v1') throw new Error('invalid rule kind');
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(row.id ?? '') || ids.has(row.id)) throw new Error(`invalid or duplicate rule id: ${row?.id}`);
    if (typeof row.instructions !== 'string' || row.instructions.trim() === '') throw new Error(`rule ${row.id} requires instructions`);
    if (!Number.isFinite(row.failAt) || !Number.isFinite(row.passAt) || row.failAt < 0 || row.passAt > 1 || row.failAt >= row.passAt) throw new Error(`rule ${row.id} requires explicit valid failAt/passAt thresholds`);
    if (typeof row.blocking !== 'boolean') throw new Error(`rule ${row.id} requires blocking boolean`);
    if (!row.criteria || typeof row.criteria.true !== 'string' || typeof row.criteria.false !== 'string') throw new Error(`rule ${row.id} requires true/false criteria`);
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
    if (typeof pkg.path !== 'string' || !pkg.path.startsWith('packages/')) throw new Error(`invalid package path in ${row.repository}: ${pkg?.path}`);
    if (typeof pkg.purpose !== 'string') throw new Error(`package subject missing in ${row.repository}: ${pkg.id}`);
    ids.add(pkg.id);
  }
  return row;
}

export function makeQuestions(observation, rules) {
  validateObservation(observation); validateRules(rules);
  const targets = [{ kind: 'repo', id: observation.repoId, path: '.', label: observation.repository }, ...observation.packages.map((pkg) => ({ kind: 'package', id: pkg.id, path: pkg.path, label: pkg.id }))];
  const questions = {};
  const mapping = {};
  let index = 0;
  for (const target of targets) {
    for (const rule of rules) {
      const questionId = `q${String(index++).padStart(5, '0')}`;
      questions[questionId] = {
        type: 'noul',
        instructions: { question: rule.instructions, target },
        criteria: rule.criteria,
      };
      mapping[questionId] = { target, ruleId: rule.id };
    }
  }
  return { questions, mapping };
}

export function classifyNoul(value, rule) {
  if (!Number.isFinite(value) || value < 0 || value > 1) return 'UNKNOWN';
  if (value >= rule.passAt) return 'PASS';
  if (value <= rule.failAt) return 'FAIL';
  return 'UNKNOWN';
}

function aggregate(statuses) {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

export function evaluateObservation({ observation, rules, response, mapping }) {
  validateObservation(observation); validateRules(rules);
  if (!response || typeof response !== 'object' || typeof response.model !== 'string' || !response.answers || typeof response.answers !== 'object') throw new Error('invalid Jev response envelope');
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const expectedIds = Object.keys(mapping).sort();
  const answerIds = Object.keys(response.answers).sort();
  if (stableJson(expectedIds) !== stableJson(answerIds)) throw new Error('Jev response answer set mismatch');
  const subjectDigest = sha256(observation);
  const judgments = [];
  for (const questionId of expectedIds) {
    const meta = mapping[questionId];
    const rule = ruleById.get(meta.ruleId);
    const answer = response.answers[questionId];
    if (!answer || answer.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error(`invalid Noul answer: ${questionId}`);
    judgments.push({
      kind: 'repoHealth.judgment.v1',
      repository: observation.repository,
      revision: observation.revision,
      targetKind: meta.target.kind,
      targetId: meta.target.id,
      targetPath: meta.target.path,
      ruleId: rule.id,
      noul: answer.noul,
      status: classifyNoul(answer.noul, rule),
      blocking: rule.blocking, subjectDigest,
    });
  }
  const targets = new Map();
  for (const judgment of judgments) {
    const key = `${judgment.targetKind}:${judgment.targetId}`;
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push(judgment);
  }
  const repoJudgments = targets.get(`repo:${observation.repoId}`) ?? [];
  const packages = observation.packages.map((pkg) => {
    const rows = targets.get(`package:${pkg.id}`) ?? [];
    const blocking = rows.filter((row) => row.blocking);
    return {
      kind: 'repoHealth.package.v1', repository: observation.repository, revision: observation.revision,
      packageId: pkg.id, packagePath: pkg.path, status: aggregate(blocking.map((row) => row.status)),
      findings: blocking.filter((row) => row.status !== 'PASS').map((row) => ({ ruleId: row.ruleId, status: row.status, noul: row.noul })),
    };
  });
  const rootBlocking = repoJudgments.filter((row) => row.blocking).map((row) => row.status);
  const status = aggregate([...rootBlocking, ...packages.map((pkg) => pkg.status)]);
  const repo = {
    kind: 'repoHealth.repo.v1', repoId: observation.repoId, repository: observation.repository,
    revision: observation.revision, tree: observation.tree, status,
    packageCount: packages.length,
    findings: repoJudgments.filter((row) => row.blocking && row.status !== 'PASS').map((row) => ({ ruleId: row.ruleId, status: row.status, noul: row.noul })),
  };
  return { model: response.model, repo, packages, judgments };
}

export function unknownEvaluation({ scopeRow, observation = null, rules, reason }) {
  const packages = observation?.packages ?? [];
  return {
    model: null,
    repo: {
      kind: 'repoHealth.repo.v1', repoId: scopeRow.id, repository: scopeRow.repository,
      revision: observation?.revision ?? null, tree: observation?.tree ?? null, status: 'UNKNOWN', packageCount: packages.length,
      findings: [{ ruleId: 'runtime', status: 'UNKNOWN', reason }],
    },
    packages: packages.map((pkg) => ({ kind: 'repoHealth.package.v1', repository: scopeRow.repository, revision: observation?.revision ?? null, packageId: pkg.id, packagePath: pkg.path, status: 'UNKNOWN', findings: [{ ruleId: 'runtime', status: 'UNKNOWN', reason }] })),
    judgments: [], rules: rules.map((rule) => rule.id), reason,
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
  const ordered = scope.map((row) => byRepo.get(row.repository) ?? unknownEvaluation({ scopeRow: row, rules, reason: 'repository not evaluated' }));
  const repos = ordered.map((value) => value.repo);
  const summary = {
    expected: scope.length,
    observed: repos.filter((repo) => repo.revision).length,
    pass: repos.filter((repo) => repo.status === 'PASS').length,
    fail: repos.filter((repo) => repo.status === 'FAIL').length,
    unknown: repos.filter((repo) => repo.status === 'UNKNOWN').length,
  };
  const reportRows = [];
  for (const value of ordered) reportRows.push(value.repo, ...value.packages, ...value.judgments);
  const reportText = reportRows.map((row) => stableJson(row)).join('\n') + '\n';
  const receipt = {
    kind: 'repoHealth.receipt.v1', authority: false, summary,
    scopeDigest: sha256(scope), ruleDigest: sha256(rules), reportDigest: sha256(reportText),
    complete: summary.observed === summary.expected && summary.fail === 0 && summary.unknown === 0,
  };
  return { summary, reportRows, reportText, receipt, html: renderHtml({ summary, ordered, receipt }) };
}

export function renderHtml({ summary, ordered, receipt }) {
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const boxes = ordered.map((value) => {
    const repo = value.repo;
    const repoFindings = (repo.findings ?? []).map((f) => `<div class="finding">↳ ${esc(f.ruleId)}: ${esc(f.status)}${f.reason ? ` — ${esc(f.reason)}` : ''}</div>`).join('');
    const packages = value.packages.map((pkg) => {
      const finding = (pkg.findings ?? [])[0];
      return `<div class="pkg"><span>${esc(pkg.packageId)}</span><strong>${esc(pkg.status)}</strong></div>${finding ? `<div class="finding">↳ ${esc(finding.ruleId)}: ${esc(finding.status)}</div>` : ''}`;
    }).join('');
    return `<section class="repo"><header><span>${esc(repo.repoId)}</span><strong>${esc(repo.status)}</strong></header>${repoFindings}${packages|</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generated-artifact-authority" content="false"><title>Major Repo Health</title><style>html{font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#111;background:#fff}body{margin:0;padding:20px}main{max-width:1100px;margin:auto}h1{font-size:18px;margin:0 0 4px}.summary{margin-bottom:16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.repo{border:1px solid #111;padding:8px}.repo header,.pkg{display:flex;justify-content:space-between;gap:12px}.repo header{padding-bottom:6px;border-bottom:1px solid #111;margin-bottom:5px}.pkg{padding:3px 0}.finding{padding:2px 0 5px 14px;opacity:.8;font-size:12px}.receipt{margin-top:14px;font-size:11px;opacity:.65;word-break:break-all}</style></head><body><main><h1>Major Repo Health</h1><div class="summary">observed ${summary.observed}/${summary.expected} | fail ${summary.fail} | unknown ${summary.unknown}</div><div class="grid">${boxes}</div><div class="receipt">report ${esc(receipt.reportDigest)} · authority=false</div></main></body></html>\n`;
}
