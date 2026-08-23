#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { proposalDigest } from '../../hq-modeling-runtime/lib/modeling-proposal.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const proofRoot = path.resolve(here, '..');
const repoRoot = path.resolve(proofRoot, '..', '..');
const nodeCli = path.join(repoRoot, 'packages', 'hq-modeling-runtime', 'bin', 'hq-modeling-runtime.mjs');
const nodeTests = path.join(repoRoot, 'packages', 'hq-modeling-runtime', 'tests');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-go-parity-'));
const goBinary = path.join(temporary, 'hq-modeling-runtime-go');

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
    env: options.env ?? process.env,
  });
  assert.equal(result.signal, null, JSON.stringify({ command, args, signal: result.signal, stderr: result.stderr }));
  assert.equal(result.error, undefined, JSON.stringify({ command, args, error: result.error?.message }));
  return result;
}

function assertPassed(result, label) {
  assert.equal(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function jsonValue(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not emit JSON: ${error.message}\n${text}`);
  }
}

function jsonlValues(text, label) {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed.split('\n').map((line, index) => jsonValue(line, `${label} line ${index + 1}`));
}

function runNode(args) {
  return execute(process.execPath, [nodeCli, ...args]);
}

const isolatedGoEnv = {
  PATH: '',
  LANG: 'C',
  LC_ALL: 'C',
};

function runGo(args) {
  return execute(goBinary, args, { env: isolatedGoEnv });
}

function assertParity(args, mode, label = args.join(' ')) {
  const node = runNode(args);
  const go = runGo(args);
  const goAgain = runGo(args);

  assert.equal(go.status, node.status, `${label}: exit status`);
  assert.equal(go.stderr, node.stderr, `${label}: stderr`);
  assert.equal(goAgain.status, go.status, `${label}: Go repeat exit status`);
  assert.equal(goAgain.stdout, go.stdout, `${label}: Go stdout is not deterministic`);
  assert.equal(goAgain.stderr, go.stderr, `${label}: Go stderr is not deterministic`);

  if (mode === 'plain') {
    assert.equal(go.stdout, node.stdout, `${label}: stdout`);
  } else if (mode === 'json') {
    assert.deepEqual(jsonValue(go.stdout, `${label} Go`), jsonValue(node.stdout, `${label} Node`), `${label}: JSON semantics`);
  } else if (mode === 'jsonl') {
    assert.deepEqual(jsonlValues(go.stdout, `${label} Go`), jsonlValues(node.stdout, `${label} Node`), `${label}: JSONL semantics`);
  } else {
    throw new Error(`unknown comparison mode: ${mode}`);
  }
}

function collectCodes(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectCodes(entry, result);
  } else if (value && typeof value === 'object') {
    if (typeof value.code === 'string') result.push(value.code);
    for (const nested of Object.values(value)) collectCodes(nested, result);
  }
  return result;
}

function normalizeMalformed(value, key = '') {
  if (Array.isArray(value)) return value.map((entry) => normalizeMalformed(entry));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [nestedKey, nested] of Object.entries(value)) {
    if (/Digest$/.test(nestedKey)) {
      output[nestedKey] = '<parser-dependent-digest>';
    } else if (nestedKey === 'message' && value.code === 'invalid-json') {
      output[nestedKey] = '<runtime-parser-message>';
    } else {
      output[nestedKey] = normalizeMalformed(nested, nestedKey);
    }
  }
  return output;
}

function assertMalformedFailClosed(args, label = args.join(' ')) {
  const node = runNode(args);
  const go = runGo(args);
  assert.notEqual(node.status, 0, `${label}: Node unexpectedly passed`);
  assert.equal(go.status, node.status, `${label}: exit status`);
  assert.equal(go.stderr, node.stderr, `${label}: stderr lane`);
  const nodeValue = jsonValue(node.stdout, `${label} Node`);
  const goValue = jsonValue(go.stdout, `${label} Go`);
  assert.ok(collectCodes(nodeValue).includes('invalid-json'), `${label}: Node missing invalid-json`);
  assert.deepEqual(collectCodes(goValue), collectCodes(nodeValue), `${label}: error codes`);
  assert.deepEqual(normalizeMalformed(goValue), normalizeMalformed(nodeValue), `${label}: fail-closed semantics outside parser wording/digests`);
}

function writeJson(pathname, value) {
  fs.writeFileSync(pathname, `${JSON.stringify(value)}\n`);
}

function writeJsonl(pathname, rows) {
  fs.writeFileSync(pathname, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

try {
  const goEnvironment = {
    ...process.env,
    CGO_ENABLED: '0',
    GOCACHE: path.join(temporary, 'go-cache'),
    GOMODCACHE: path.join(temporary, 'go-mod-cache'),
    GOTOOLCHAIN: 'local',
    GOWORK: 'off',
    GOFLAGS: '-buildvcs=false',
    HOME: path.join(temporary, 'home'),
  };
  fs.mkdirSync(goEnvironment.HOME, { recursive: true });
  assertPassed(execute('go', ['test', './...'], { cwd: proofRoot, env: goEnvironment, timeout: 120_000 }), 'Go unit tests');
  assertPassed(execute('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', goBinary, './cmd/hq-modeling-runtime-go'], {
    cwd: proofRoot,
    env: goEnvironment,
    timeout: 120_000,
  }), 'Go build');
  assert.ok(fs.statSync(goBinary).size > 0, 'Go binary is empty');

  // The existing MJS suite remains unchanged and is the behavioral oracle.
  const oracleTests = [
    'static.mjs',
    'queue-validator.mjs',
    'local-worker.mjs',
    'receipt-writer.mjs',
    'projection-builder.mjs',
    'admission-gate.mjs',
    'agent-task-runtime.mjs',
    'modeling-proposal.mjs',
    'promotion-gate.mjs',
    'authority-vocabulary.mjs',
    'promotion-cli-jsonl.mjs',
    'local-root.mjs',
    'ci-mode.mjs',
    'github-readback.mjs',
    'canonical-promotion.mjs',
  ];
  for (const test of oracleTests) {
    assertPassed(execute(process.execPath, [path.join(nodeTests, test)]), `existing MJS oracle ${test}`);
  }

  const modelRow = {
    kind: 'hq.modelCommitQueued.v1',
    id: 'model-positive-1',
    status: 'queued',
    targetRef: { kind: 'package', id: 'pkg:a' },
    op: 'addEdge',
    payload: {
      from: 'pkg:a',
      to: 'pkg:b',
      type: 'uses',
      meta: { text: '<>&  ', numbers: [null, true, -0, 1e-7, 1e21, 1.5] },
    },
    reason: 'fixture',
    confirmedBy: 'human',
    origin: { kind: 'direct-human.v1', confirmationId: 'confirm-1', confirmedBy: 'human' },
  };
  const agentRow = {
    kind: 'hq.agentTaskQueued.v1',
    id: 'agent-positive-1',
    status: 'queued',
    targetRef: { kind: 'package', id: 'pkg:a' },
    goal: 'inspect',
    context: ['x'],
    acceptance: ['y'],
    confirmedBy: 'human',
  };
  const receiptRow = {
    kind: 'hq.receipt.v1',
    id: 'receipt-existing-1',
    status: 'processed',
    queueId: 'model-existing-1',
  };

  const modelQueuePath = path.join(temporary, 'model.jsonl');
  const mixedQueuePath = path.join(temporary, 'mixed.jsonl');
  writeJsonl(modelQueuePath, [modelRow]);
  writeJsonl(mixedQueuePath, [modelRow, agentRow, receiptRow]);

  const negativeQueuePath = path.join(temporary, 'valid-negative.jsonl');
  writeJsonl(negativeQueuePath, [
    { ...modelRow, id: 'duplicate-id' },
    {
      ...modelRow,
      id: 'duplicate-id',
      origin: { kind: 'direct-human.v1', confirmationId: 'confirm-2', confirmedBy: 'human' },
      payload: { nested: { kind: 'source.observation.v1' } },
    },
    {
      ...agentRow,
      id: 'authority-row',
      modelAuthoritativeClaim: true,
    },
  ]);

  const malformedQueuePath = path.join(temporary, 'malformed.jsonl');
  fs.writeFileSync(malformedQueuePath, '{bad json\n');

  assertParity(['--help'], 'plain', 'help');
  for (const args of [[], ['--json']]) {
    const proofBoundaryRun = runGo(args);
    assert.equal(proofBoundaryRun.status, 0, proofBoundaryRun.stderr);
    const proofBoundary = jsonValue(proofBoundaryRun.stdout, 'Go proof boundary');
    assert.equal(proofBoundary.kind, 'hq.modelingRuntime.goParityProof.boundary.v1');
    assert.equal(proofBoundary.canonicalPackage, 'hq-modeling-runtime');
    assert.equal(proofBoundary.proofOnly, true);
    assert.equal(proofBoundary.cutoverReady, false);
    assert.equal(proofBoundary.replacementAuthorized, false);
  }

  for (const args of [
    ['validate', '--input', mixedQueuePath],
    ['validate', '--input', mixedQueuePath, '--json'],
    ['work', '--input', mixedQueuePath],
    ['work', '--input', mixedQueuePath, '--json'],
    ['receipts', '--input', mixedQueuePath],
    ['receipts', '--input', mixedQueuePath, '--json'],
    ['receipts', '--input', mixedQueuePath, '--jsonl'],
    ['projection', '--input', mixedQueuePath],
    ['projection', '--input', mixedQueuePath, '--json'],
    ['admit', '--input', modelQueuePath],
    ['admit', '--input', modelQueuePath, '--json'],
    ['admit', '--input', modelQueuePath, '--accepted-jsonl'],
    ['admit', '--input', modelQueuePath, '--receipt-jsonl'],
    ['admit', '--input', mixedQueuePath],
    ['admit', '--input', mixedQueuePath, '--json'],
  ]) {
    const last = args.at(-1);
    const mode = last === '--json' ? 'json' : (['--jsonl', '--accepted-jsonl', '--receipt-jsonl'].includes(last) ? 'jsonl' : 'plain');
    assertParity(args, mode);
  }

  for (const command of ['validate', 'work', 'receipts', 'projection', 'admit']) {
    assertParity([command, '--input', negativeQueuePath], 'plain', `${command} valid JSON negative`);
    assertParity([command, '--input', negativeQueuePath, '--json'], 'json', `${command} valid JSON negative JSON`);
  }
  assertParity(['receipts', '--input', negativeQueuePath, '--jsonl'], 'jsonl', 'receipts valid JSON negative JSONL');
  assertParity(['admit', '--input', negativeQueuePath, '--accepted-jsonl'], 'jsonl', 'admit valid JSON negative accepted JSONL');
  assertParity(['admit', '--input', negativeQueuePath, '--receipt-jsonl'], 'jsonl', 'admit valid JSON negative receipt JSONL');

  for (const command of ['validate', 'work', 'receipts', 'projection', 'admit']) {
    assertMalformedFailClosed([command, '--input', malformedQueuePath, '--json'], `${command} malformed JSON`);
  }

  // Serialized boundary corpus: these cases were selected from the unchanged
  // MJS contracts because they expose missing-vs-null, status order, raw -0,
  // source/reconcile duplication, and non-object admission digest behavior.
  const queueCorpusPath = path.join(temporary, 'queue-corpus.jsonl');
  const queueCorpus = [
    ['top-level-array', '[]'],
    ['top-level-string', JSON.stringify('row')],
    ['top-level-number', '1'],
    ['top-level-null', 'null'],
    ['missing-kind', JSON.stringify(Object.fromEntries(Object.entries(modelRow).filter(([key]) => key !== 'kind')))],
    ['missing-model-status', JSON.stringify(Object.fromEntries(Object.entries(modelRow).filter(([key]) => key !== 'status')))],
    ['missing-origin-kind', JSON.stringify({ ...modelRow, origin: {} })],
    ['receipt-status-order', JSON.stringify({ kind: 'hq.receipt.v1', id: 'receipt-no-status', queueId: 'q' })],
    ['nested-reconcile', JSON.stringify({ ...modelRow, payload: { a: { b: { kind: 'model_source_reconcile.v1' } } } })],
    ['raw-negative-zero', JSON.stringify(modelRow).replace('"type":"uses"', '"type":"uses","extra":-0.0')],
  ];
  for (const [caseId, raw] of queueCorpus) {
    fs.writeFileSync(queueCorpusPath, `${raw}\n`);
    for (const command of ['validate', 'work', 'receipts', 'projection', 'admit']) {
      assertParity([command, '--input', queueCorpusPath, '--json'], 'json', `${command} corpus ${caseId}`);
    }
  }

  const proposal = {
    kind: 'modeling.proposal.v1',
    id: 'proposal-go-parity-1',
    sourceAgentTaskId: 'agent-go-parity-1',
    targetRef: { kind: 'repoMap.node', id: 'pkg:go-parity' },
    proposedOperation: {
      op: 'addEdge',
      payload: {
        from: 'pkg:go-parity',
        to: 'pkg:runtime',
        type: 'uses',
        meta: { text: '<>&  ', number: 1e21, optional: null },
      },
    },
    evidence: [{ kind: 'digest', value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    acceptanceCriteria: ['explicit human confirmation is required'],
    status: 'proposed',
  };
  const confirmation = {
    confirm: true,
    confirmedBy: 'human-go-parity-review',
    proposalDigest: proposalDigest(proposal),
  };
  const badConfirmation = { ...confirmation, proposalDigest: 'sha256:wrong' };
  const proposalPath = path.join(temporary, 'proposal.json');
  const confirmationPath = path.join(temporary, 'confirmation.json');
  const badConfirmationPath = path.join(temporary, 'confirmation-bad.json');
  const malformedProposalPath = path.join(temporary, 'proposal-malformed.json');
  writeJson(proposalPath, proposal);
  writeJson(confirmationPath, confirmation);
  writeJson(badConfirmationPath, badConfirmation);
  fs.writeFileSync(malformedProposalPath, '{bad json\n');

  for (const [suffix, mode] of [
    [[], 'plain'],
    [['--json'], 'json'],
    [['--queue-jsonl'], 'jsonl'],
    [['--receipt-jsonl'], 'jsonl'],
  ]) {
    assertParity(['promote', '--input', proposalPath, '--confirmation', confirmationPath, ...suffix], mode, `promote success ${suffix.join(' ') || 'default'}`);
  }
  for (const [suffix, mode] of [
    [[], 'plain'],
    [['--json'], 'json'],
    [['--queue-jsonl'], 'plain'],
    [['--receipt-jsonl'], 'plain'],
  ]) {
    assertParity(['promote', '--input', proposalPath, '--confirmation', badConfirmationPath, ...suffix], mode, `promote bad confirmation ${suffix.join(' ') || 'default'}`);
  }

  const promotionCorpus = [
    ['empty-confirmation', proposal, {}],
    ['confirm-null', proposal, { ...confirmation, confirm: null }],
    ['confirm-number', proposal, { ...confirmation, confirm: 1 }],
    ['confirm-false', proposal, { ...confirmation, confirm: false }],
    ['confirmedBy-null', proposal, { ...confirmation, confirmedBy: null }],
    ['confirmedBy-number', proposal, { ...confirmation, confirmedBy: 1 }],
    ['confirmedBy-empty', proposal, { ...confirmation, confirmedBy: '' }],
    ['digest-null', proposal, { ...confirmation, proposalDigest: null }],
    ['digest-number', proposal, { ...confirmation, proposalDigest: 1 }],
    ['proposal-missing-kind', Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== 'kind')), confirmation],
    ['proposal-authority', { ...proposal, modelAuthoritativeClaim: true }, confirmation],
  ];
  const corpusProposalPath = path.join(temporary, 'proposal-corpus.json');
  const corpusConfirmationPath = path.join(temporary, 'confirmation-corpus.json');
  for (const [caseId, corpusProposal, corpusConfirmation] of promotionCorpus) {
    writeJson(corpusProposalPath, corpusProposal);
    writeJson(corpusConfirmationPath, corpusConfirmation);
    assertParity(
      ['promote', '--input', corpusProposalPath, '--confirmation', corpusConfirmationPath, '--json'],
      'json',
      `promotion corpus ${caseId}`,
    );
  }
  fs.writeFileSync(
    corpusProposalPath,
    `${JSON.stringify(proposal).replace('"type":"uses"', '"type":"uses","extra":-0.0')}\n`,
  );
  writeJson(corpusConfirmationPath, confirmation);
  assertParity(
    ['promote', '--input', corpusProposalPath, '--confirmation', corpusConfirmationPath, '--json'],
    'json',
    'promotion corpus raw-negative-zero',
  );

  for (const args of [
    ['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--queue-jsonl=true'],
    ['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--receipt-jsonl=true'],
    ['promote', '--input', proposalPath, '--confirmation', confirmationPath, '--queue-jsonl', '--json'],
    ['promote', '--input', malformedProposalPath, '--confirmation', confirmationPath, '--queue-jsonl'],
  ]) {
    assertParity(args, 'plain', `promotion rejection safety ${args.at(-1)}`);
  }

  // The absolute binary executes with PATH empty: Node is not a runtime dependency.
  const isolated = runGo(['--json']);
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(jsonValue(isolated.stdout, 'isolated Go boundary').packageName, 'hq-modeling-runtime-go-proof');

  console.log(`hq modeling runtime Go parity proof: PASS oracleTests=${oracleTests.length} queueCorpus=${queueCorpus.length} promotionCorpus=${promotionCorpus.length + 1} nativeBinaryBytes=${fs.statSync(goBinary).size}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
