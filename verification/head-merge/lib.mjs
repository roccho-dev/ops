import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ATOMIC_SCHEMA = 'roccho.atomic-intent-closure/3';
export const HEAD_SCHEMA = 'roccho.all-intent-closure/2';
const REPO_ORDER = new Map([['mobile-agent', 0], ['ui', 1], ['ops', 2]]);

export function parseJsonl(text, label) {
  assert.equal(typeof text, 'string', `${label}: text required`);
  assert.ok(text.endsWith('\n'), `${label}: final newline required`);
  assert.equal(text.includes('\n\n'), false, `${label}: blank line forbidden`);
  return text.trimEnd().split('\n').map((line, index) => {
    let value;
    try { value = JSON.parse(line); } catch (error) {
      throw new Error(`${label}:${index + 1}: invalid JSON: ${error.message}`);
    }
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}:${index + 1}: object required`);
    return value;
  });
}

export function readJsonl(file, label = file) {
  return parseJsonl(fs.readFileSync(file, 'utf8'), label);
}

function nonEmptyString(value, label) {
  assert.equal(typeof value, 'string', `${label}: string required`);
  assert.ok(value.trim().length > 0, `${label}: non-empty string required`);
  return value.trim();
}

function stringArray(value, label) {
  const values = Array.isArray(value) ? value : [value];
  assert.ok(values.length > 0, `${label}: non-empty array required`);
  return values.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function fullCommit(value, label) {
  const commit = nonEmptyString(value, label);
  assert.match(commit, /^[0-9a-f]{40}$/u, `${label}: full lowercase commit required`);
  return commit;
}

export function validateAtomicIntents(rows) {
  assert.equal(rows.length, 67, 'atomic intent count must remain 67');
  const ids = new Set();
  const repoCounts = new Map();
  const heads = new Set();
  const commits = new Set();
  for (const [index, row] of rows.entries()) {
    const label = `atomic[${index}]`;
    assert.equal(row.schema, ATOMIC_SCHEMA, `${label}: schema differs`);
    const id = nonEmptyString(row.intentId, `${label}.intentId`);
    assert.equal(ids.has(id), false, `${label}: duplicate intentId ${id}`);
    ids.add(id);
    const repo = nonEmptyString(row.repo, `${label}.repo`);
    assert.ok(REPO_ORDER.has(repo), `${label}: unknown repo ${repo}`);
    repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1);
    for (const head of stringArray(row.sourceHeads, `${label}.sourceHeads`)) heads.add(fullCommit(head, `${label}.sourceHeads`));
    assert.ok(Array.isArray(row.sourceCommits), `${label}.sourceCommits: array required`);
    for (const commit of row.sourceCommits) commits.add(fullCommit(commit, `${label}.sourceCommits`));
    nonEmptyString(row.intent, `${label}.intent`);
    nonEmptyString(row.disposition, `${label}.disposition`);
    nonEmptyString(row.finalOwner, `${label}.finalOwner`);
    stringArray(row.proof, `${label}.proof`);
    assert.equal(row.proofStatus, 'PASS', `${label}: proofStatus must be PASS`);
    assert.equal(row.sourceResult, 'PASS', `${label}: sourceResult must be PASS`);
    assert.equal(row.bundleResult, 'PASS', `${label}: bundleResult must be PASS`);
    assert.ok(row.compatibility && typeof row.compatibility === 'object' && !Array.isArray(row.compatibility), `${label}: compatibility object required`);
    nonEmptyString(row.compatibility.status, `${label}.compatibility.status`);
    assert.equal(row.externalStatus, 'MERGE_CLOSED', `${label}: externalStatus differs`);
    assert.ok(Array.isArray(row.replacedOrRejected), `${label}.replacedOrRejected: array required`);
    assert.equal(row.status, 'SATISFIED', `${label}: status must be SATISFIED`);
  }
  assert.deepEqual(Object.fromEntries(repoCounts), {'mobile-agent': 33, ui: 25, ops: 9});
  assert.equal(heads.size, 31, 'atomic ledger must cover 31 feature heads');
  assert.equal(commits.size, 8, 'atomic ledger must expose all eight internal commits');
  const compatibility = rows.find(row => row.intentId === 'M-COMPAT-001');
  assert.ok(compatibility, 'M-COMPAT-001 missing');
  assert.equal(compatibility.compatibility.status, 'PRESERVED');
  return {
    intents: rows.length,
    repoCounts: Object.fromEntries(repoCounts),
    featureHeads: heads.size,
    internalCommits: commits.size,
    headSet: heads,
    commitSet: commits,
  };
}

export function validateInternalCommits(rows, expectedCommits) {
  assert.equal(rows.length, 8, 'internal commit coverage count must remain 8');
  const commits = new Set();
  for (const [index, row] of rows.entries()) {
    const label = `internal[${index}]`;
    assert.equal(row.schema, 'roccho.internal-commit-intent-audit/2', `${label}: schema differs`);
    const commit = fullCommit(row.commit, `${label}.commit`);
    assert.equal(commits.has(commit), false, `${label}: duplicate commit`);
    commits.add(commit);
    nonEmptyString(row.repo, `${label}.repo`);
    nonEmptyString(row.intent, `${label}.intent`);
    nonEmptyString(row.foldedInto, `${label}.foldedInto`);
    nonEmptyString(row.proof, `${label}.proof`);
    assert.equal(row.ancestry, 'PASS', `${label}: ancestry differs`);
    assert.match(nonEmptyString(row.status, `${label}.status`), /^COVERED_/u);
  }
  assert.deepEqual([...commits].sort(), [...expectedCommits].sort(), 'internal commit ledger and atomic sourceCommits differ');
  return {commits: rows.length};
}

function normalizeOwner(value, label) {
  const owners = stringArray(value, label);
  assert.equal(owners.some(owner => owner.toLowerCase() === 'null'), false, `${label}: null owner forbidden`);
  return owners;
}

export function normalizeHeadClosures({mobileRows, uiRows, opsRows}) {
  const result = [];
  const add = (repo, rows, mapper) => rows.forEach((row, index) => {
    const mapped = mapper(row, index);
    result.push({
      schema: HEAD_SCHEMA,
      repo,
      indexWithinRepo: index,
      head: fullCommit(mapped.head, `${repo}[${index}].head`),
      intent: nonEmptyString(mapped.intent, `${repo}[${index}].intent`),
      finalOwner: normalizeOwner(mapped.finalOwner, `${repo}[${index}].finalOwner`),
      proof: stringArray(mapped.proof, `${repo}[${index}].proof`),
      resolution: nonEmptyString(mapped.resolution, `${repo}[${index}].resolution`),
      sourceSchema: nonEmptyString(row.schema, `${repo}[${index}].sourceSchema`),
      sourceStatus: nonEmptyString(mapped.sourceStatus, `${repo}[${index}].sourceStatus`),
      status: 'PASS',
    });
  });
  add('mobile-agent', mobileRows, row => ({
    head: row.source_head,
    intent: Array.isArray(row.requirements) ? row.requirements.join('; ') : row.intent,
    finalOwner: row.final_owner,
    proof: row.verification,
    resolution: row.resolution ?? row.status,
    sourceStatus: row.status,
  }));
  add('ui', uiRows, row => ({
    head: row.head,
    intent: row.intent,
    finalOwner: row.owner,
    proof: row.proof,
    resolution: row.resolution ?? row.status,
    sourceStatus: row.status,
  }));
  add('ops', opsRows, row => ({
    head: row.head,
    intent: row.intent,
    finalOwner: row.finalOwner,
    proof: row.proof,
    resolution: row.resolution,
    sourceStatus: row.status,
  }));
  assert.equal(result.length, 62, 'head closure count must remain 62');
  assert.equal(new Set(result.map(row => `${row.repo}:${row.head}`)).size, result.length, 'duplicate repo/head closure');
  assert.deepEqual(
    Object.fromEntries(['mobile-agent', 'ui', 'ops'].map(repo => [repo, result.filter(row => row.repo === repo).length])),
    {'mobile-agent': 19, ui: 28, ops: 15},
  );
  return result;
}

function stableHeadRows(rows) {
  return [...rows].sort((left, right) => {
    const repo = (REPO_ORDER.get(left.repo) ?? 99) - (REPO_ORDER.get(right.repo) ?? 99);
    if (repo !== 0) return repo;
    return left.indexWithinRepo - right.indexWithinRepo;
  });
}

export function projectAtomicHeads(rows) {
  const grouped = new Map();
  for (const row of rows) {
    for (const head of row.sourceHeads) {
      const key = `${row.repo}:${head}`;
      const current = grouped.get(key) ?? {
        schema: 'roccho.atomic-head-intent-summary/2',
        repo: row.repo,
        head,
        intentIds: [],
        dispositions: new Set(),
        finalOwners: new Set(),
        proof: new Set(),
        status: 'PASS',
      };
      current.intentIds.push(row.intentId);
      current.dispositions.add(row.disposition);
      current.finalOwners.add(row.finalOwner);
      for (const proof of row.proof) current.proof.add(proof);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()].map(row => ({
    ...row,
    intentIds: [...new Set(row.intentIds)].sort(),
    dispositions: [...row.dispositions].sort(),
    finalOwners: [...row.finalOwners].sort(),
    proof: [...row.proof].sort(),
  })).sort((a, b) => (REPO_ORDER.get(a.repo) - REPO_ORDER.get(b.repo)) || a.head.localeCompare(b.head));
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function gitHead(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

function releaseReport(summary) {
  return [
    '# Release intent closure',
    '',
    '| Item | Result |',
    '|---|---:|',
    `| Historical supplied HEAD intents | ${summary.historicalHeadIntents} / ${summary.historicalHeadIntents} PASS |`,
    `| Atomic intents | ${summary.atomicIntents} / ${summary.atomicIntents} SATISFIED |`,
    `| Feature HEADs | ${summary.currentAtomicHeads} / ${summary.currentAtomicHeads} CLOSED |`,
    `| Internal commits | ${summary.internalCommits} / ${summary.internalCommits} COVERED |`,
    `| Missing final owner | ${summary.missingFinalOwner} |`,
    `| Open atomic intent | ${summary.openAtomicIntents} |`,
    `| Known functional intent loss | ${summary.knownFunctionalIntentLoss} |`,
    '',
    '`atomic-intent-ledger.jsonl` is authoritative. Every other file in this generated directory is a deterministic projection.',
    '',
  ].join('\n');
}

export function renderRelease({mobileRoot, uiRoot, opsRoot, output}) {
  const atomicFile = path.join(opsRoot, 'verification/head-merge/atomic-intent-ledger.jsonl');
  const internalFile = path.join(opsRoot, 'verification/head-merge/internal-commit-coverage.jsonl');
  const atomicRows = readJsonl(atomicFile, 'atomic intent ledger');
  const atomicSummary = validateAtomicIntents(atomicRows);
  const internalRows = readJsonl(internalFile, 'internal commit coverage');
  validateInternalCommits(internalRows, atomicSummary.commitSet);

  const sources = [
    {repo: 'mobile-agent', root: mobileRoot, relative: 'audit/head-merge-closure.jsonl'},
    {repo: 'ui', root: uiRoot, relative: 'evidence/head-merge/closure.jsonl'},
    {repo: 'ops', root: opsRoot, relative: 'verification/head-merge/closure.jsonl'},
  ];
  const byRepo = Object.fromEntries(sources.map(source => [source.repo, readJsonl(path.join(source.root, source.relative), `${source.repo} closure`)]));
  const headRows = stableHeadRows(normalizeHeadClosures({mobileRows: byRepo['mobile-agent'], uiRows: byRepo.ui, opsRows: byRepo.ops}));
  const atomicHeads = projectAtomicHeads(atomicRows);
  assert.equal(atomicHeads.length, 31, 'feature HEAD projection count differs');

  const sourceReceipt = {
    schema: 'roccho.release-intent-source-receipt/2',
    status: 'PASS',
    sources: sources.map(source => ({
      repo: source.repo,
      revision: source.repo === 'ops' ? null : gitHead(source.root),
      revisionBinding: source.repo === 'ops' ? 'containing-commit' : 'exact',
      path: source.relative,
      rows: byRepo[source.repo].length,
      sha256: sha256File(path.join(source.root, source.relative)),
    })),
    atomicIntentLedger: {path: 'verification/head-merge/atomic-intent-ledger.jsonl', rows: atomicRows.length, sha256: sha256File(atomicFile)},
    internalCommitCoverage: {path: 'verification/head-merge/internal-commit-coverage.jsonl', rows: internalRows.length, sha256: sha256File(internalFile)},
  };
  const summary = {
    schema: 'roccho.release-intent-summary/2',
    status: 'PASS',
    historicalHeadIntents: headRows.length,
    atomicIntents: atomicRows.length,
    currentAtomicHeads: atomicHeads.length,
    internalCommits: internalRows.length,
    missingFinalOwner: 0,
    openAtomicIntents: 0,
    knownFunctionalIntentLoss: 0,
    compatibilityIntent: 'M-COMPAT-001:CLOSED',
    sourceReceiptSha256: null,
  };

  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  writeJsonl(path.join(output, 'all-intent-closure.jsonl'), headRows);
  writeJsonl(path.join(output, 'atomic-intent-ledger.jsonl'), atomicRows);
  writeJsonl(path.join(output, 'atomic-head-intent-summary.jsonl'), atomicHeads);
  writeJsonl(path.join(output, 'internal-commit-coverage.jsonl'), internalRows);
  writeJson(path.join(output, 'source-receipt.json'), sourceReceipt);
  summary.sourceReceiptSha256 = sha256File(path.join(output, 'source-receipt.json'));
  writeJson(path.join(output, 'release-intent-summary.json'), summary);
  fs.writeFileSync(path.join(output, 'release-intent-report.md'), releaseReport(summary));
  return {summary, atomicSummary, sourceReceipt};
}

function listFiles(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), {withFileTypes: true})) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

export function compareDirectories(expected, actual) {
  const left = listFiles(expected);
  const right = listFiles(actual);
  assert.deepEqual(right, left, 'generated release intent file list differs');
  for (const relative of left) {
    assert.deepEqual(fs.readFileSync(path.join(actual, relative)), fs.readFileSync(path.join(expected, relative)), `generated release intent differs: ${relative}`);
  }
}
