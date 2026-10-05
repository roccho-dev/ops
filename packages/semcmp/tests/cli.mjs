import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Test-only preload: every fetch is intercepted, including failure cases.
if (process.env.SEMCMP_TEST_CASE) {
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    fs.writeFileSync(process.env.SEMCMP_TEST_TRACE, JSON.stringify({ url, payload }));
    if (process.env.SEMCMP_TEST_CASE === 'http') return { ok: false, status: 503 };
    if (process.env.SEMCMP_TEST_CASE === 'throw') throw new Error('private diagnostic must not escape');
    if (process.env.SEMCMP_TEST_CASE === 'json') return { ok: true, json: async () => { throw new Error('bad'); } };
    const answers = Object.fromEntries(Object.entries(payload.questions).map(([key, question]) => [key, {
      type: 'noul', noul: question.instructions.includes(JSON.stringify(['proposal', payload.state.query.input === 'api uses db' ? 'p1' : 'p2'])) ? 0.9 : 0.1,
    }]));
    if (process.env.SEMCMP_TEST_CASE === 'answers') delete answers[Object.keys(answers)[0]];
    return { ok: true, json: async () => ({ model: process.env.SEMCMP_TEST_CASE === 'model' ? 'wrong' : payload.model, answers }) };
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semcmp-cli-'));
  const trace = path.join(root, 'trace.json');
  const query = { input: 'api uses db', state: { current: null, working: ['api uses db'], context: { example: true } }, focus: { line: 1, start: 0, column: 12 } };
  const proposals = [
    { id: 'p2', meaning: { kind: 'relation', from: 'DB', to: 'API' }, representation: 'DB → API' },
    { id: 'p1', meaning: { kind: 'relation', from: 'API', to: 'DB' }, representation: 'API → DB' },
    { id: 'p3', meaning: { kind: 'text', text: 'APIとDB' }, representation: 'APIとDB' },
  ];
  function run(input, mode = 'ok', overrides = {}, args = [], binary = process.env.SEMCMP_BIN || 'semcmp') {
    if (fs.existsSync(trace)) fs.unlinkSync(trace);
    const env = { ...process.env, JEV_API_KEY: 'test-only-placeholder', JEV_API_URL: 'https://invalid.test/never-contacted',
      JEV_TIMEOUT_MS: '1000', NODE_OPTIONS: `--import=${import.meta.url}`, SEMCMP_TEST_CASE: mode, SEMCMP_TEST_TRACE: trace, ...overrides };
    const prefix = process.env.SEMCMP_ENTRY ? [process.env.SEMCMP_ENTRY] : [];
    return spawnSync(binary, [...prefix, ...args], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env, cwd: root });
  }
  function refuse(input, code, mode = 'ok', overrides = {}, args = [], calls = false) {
    const result = run(input, mode, overrides, args);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, code + '\n');
    assert.equal(fs.existsSync(trace), calls);
  }
  try {
    for (const input of ['api uses db', 'db uses api']) {
      const q = { ...query, input, state: { ...query.state, working: [input] } };
      const result = run({ query: q, proposals });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout.trim().split('\n').length, 1);
      const output = JSON.parse(result.stdout);
      assert.deepEqual(output.query, q);
      assert.equal(output.proposals[0].id, input === 'api uses db' ? 'p1' : 'p2');
      assert.deepEqual(output.proposals.map(p => p.id).sort(), proposals.map(p => p.id).sort());
      for (const { evidence, ...original } of output.proposals) {
        assert.deepEqual(original, proposals.find(p => p.id === original.id));
        assert.equal(evidence.theme, 'intent-fit');
        assert.ok(Number.isFinite(evidence.noul));
      }
      const recorded = JSON.parse(fs.readFileSync(trace, 'utf8'));
      assert.deepEqual(recorded.payload.state, { query: q, proposals });
      assert.equal(recorded.url, 'https://invalid.test/never-contacted');
      assert.equal(output.evaluation.calls, 1);
    }
    const empty = run({ query, proposals: [] }, 'throw', { JEV_API_KEY: '' });
    assert.equal(empty.status, 0);
    assert.equal(empty.stderr, '');
    assert.equal(JSON.parse(empty.stdout).evaluation.calls, 0);
    assert.deepEqual(JSON.parse(empty.stdout).proposals, []);
    assert.equal(fs.existsSync(trace), false);
    refuse('not JSON', 'INVALID_INPUT');
    refuse({ query, proposals, extra: true }, 'INVALID_INPUT');
    refuse({ query: {}, proposals }, 'INVALID_QUERY');
    refuse({ query, proposals: {} }, 'INVALID_PROPOSALS');
    refuse({ query, proposals: [{ ...proposals[0], representation: '' }] }, 'INVALID_PROPOSALS');
    refuse({ query, proposals: [proposals[0], proposals[0]] }, 'DUPLICATE_PROPOSAL_ID');
    refuse({ query, proposals }, 'JEV_API_KEY_REQUIRED', 'ok', { JEV_API_KEY: '' });
    refuse({ query, proposals }, 'INVALID_TIMEOUT', 'ok', { JEV_TIMEOUT_MS: '0' });
    refuse({ query, proposals }, 'INVALID_ARGUMENTS', 'ok', {}, ['unexpected']);
    for (const mode of ['http', 'throw', 'json', 'model', 'answers']) refuse({ query, proposals }, 'JEV_FAILED', mode, {}, [], true);

    // Configured proposer: each partial input gets its own finite candidates; the CLI adds none.
    const proposer = path.join(root, 'proposer.mjs');
    fs.writeFileSync(proposer, `const all = ${JSON.stringify(proposals)};
export function propose({ input }) {
  if (input === 'boom') throw new Error('private proposer detail');
  if (input === 'bad') return [{ id: 'x' }];
  return input === 'u' ? [] : input === 'ux' ? all.slice(0, 2) : all.slice(1);
}
`);
    fs.writeFileSync(path.join(root, 'noexport.mjs'), 'export const other = 1;\n');
    const offered = { ux: proposals.slice(0, 2), 'uxはこう': proposals.slice(1) };
    for (const input of ['u', 'ux', 'uxはこう']) {
      const q = { ...query, input, state: { ...query.state, working: [input] } };
      const result = run({ query: q }, input === 'u' ? 'throw' : 'ok', input === 'u' ? { JEV_API_KEY: '' } : {}, ['--propose', proposer]);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      const output = JSON.parse(result.stdout);
      assert.deepEqual(output.query, q);
      if (input === 'u') {
        assert.deepEqual(output.proposals, []);
        assert.equal(output.evaluation.calls, 0);
        assert.equal(fs.existsSync(trace), false);
        continue;
      }
      // The stub prefers p2 when offered; ties keep the proposer's order.
      assert.deepEqual(output.proposals.map(({ evidence, ...original }) => original), offered[input]);
      assert.ok(output.proposals.every(({ evidence }) => evidence.theme === 'intent-fit' && Number.isFinite(evidence.noul)));
      assert.deepEqual(JSON.parse(fs.readFileSync(trace, 'utf8')).payload.state, { query: q, proposals: offered[input] });
    }
    const asProposer = (input) => ({ query: { ...query, input } });
    refuse(asProposer('boom'), 'PROPOSE_FAILED', 'ok', {}, ['--propose', proposer]);
    refuse(asProposer('bad'), 'INVALID_PROPOSALS', 'ok', {}, ['--propose', proposer]);
    refuse({ query, proposals }, 'INVALID_INPUT', 'ok', {}, ['--propose', proposer]);
    refuse({ query }, 'INVALID_INPUT');
    refuse({ query }, 'INVALID_ARGUMENTS', 'ok', {}, ['--propose']);
    refuse({ query }, 'INVALID_ARGUMENTS', 'ok', {}, ['--propose', 'proposer.mjs']);
    refuse({ query }, 'INVALID_PROPOSER', 'ok', {}, ['--propose', path.join(root, 'absent.mjs')]);
    refuse({ query }, 'INVALID_PROPOSER', 'ok', {}, ['--propose', path.join(root, 'noexport.mjs')]);
    if (!process.env.SEMCMP_ENTRY) {
      const executable = process.env.SEMCMP_BIN || process.env.PATH.split(path.delimiter)
        .map(dir => path.join(dir, 'semcmp')).find(file => fs.existsSync(file));
      const wrapper = fs.realpathSync(executable);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(path.dirname(wrapper), '../share/semcmp/artifact.jsonl'), 'utf8')),
        { artifact: 'semcmp', kind: 'artifact.auth.v1', requiredCapabilities: ['jev-api'] });
      const link = path.join(root, 'semcmp-link');
      fs.symlinkSync(wrapper, link);
      const direct = run({ query, proposals }, 'ok', {}, [], wrapper);
      const linked = run({ query, proposals }, 'ok', {}, [], link);
      assert.equal(direct.status, 0);
      assert.equal(linked.status, 0);
      assert.equal(direct.stderr, '');
      assert.equal(linked.stderr, '');
      assert.deepEqual(JSON.parse(linked.stdout), JSON.parse(direct.stdout));
      assert.deepEqual(JSON.parse(linked.stdout).query, query);
    }
    console.log('semcmp installed CLI: fresh query, typed order, configured partial-input proposer, empty and closed failures passed');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
