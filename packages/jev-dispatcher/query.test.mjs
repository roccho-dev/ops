import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { select } from './policy-select.mjs';
import { argsOf, validateRequest, parseQueryMessage, prepareContext, query, consumeReply, digest, implementationDigest, replyPacket } from './query.mjs';

const now = 100000;
const request = () => ({ id: 'q-1', type: 'choice', question: 'Which action?', criteria: { review: 'Review the result', hold: 'Hold for missing facts' } });
const observation = () => ({ job: 'job-1', state_version: 'state-1', text: 'Work completed; review is absent.', refs: ['record:observed-1'], expires_at: now + 10000 });
const job = () => ({ id: 'job-1', state: 'active', version: 'job-v1', rel: { parent: 'r', kind: 'details' }, r_id: 'r', w_id: 'w', query: {
  enabled: true, mode: 'advisory', senders: ['r', 'w'], disclosure: 'selected-rules-and-observation', rule_ids: ['rule-1'],
  timeout_ms: 200, max_input_bytes: 20000, max_calls: 1, expected_model: 'model-fixed' } });
const rows = () => [
  { op: 'document', id: '/root', state: 'active', schema: 3, rel: null },
  { id: 'r', role: 'r', state: 'active', rel: { parent: '/root', kind: 'reviews' } },
  { id: 'w', role: 'w', state: 'active', rel: { parent: 'r', kind: 'delegates' } },
  { id: 'rule-1', state: 'active', rel: { parent: 'r', kind: 'details' }, rule: 'Review evidence before accepting completed work.' }, job(),
];
const selection = (rs = rows()) => ({ commit: 'a'.repeat(40), tree: 'b'.repeat(40), r_id: 'r', selected: rs.map(value => {
  const body = JSON.stringify(value); return { id: value.id, body, body_sha256: digest(body) };
}) });
const prepare = (s = selection(), changes = {}) => prepareContext({ selection: s, contractId: 'job-1', version: 'job-v1', sender: 'r', sourceRecord: 'final-1', observation: observation(), now, ...changes });
const provider = (change = x => x) => async (_url, options) => {
  assert.ok(options.signal);
  const body = JSON.parse(options.body); const q = body.questions.live;
  const answer = q.type === 'noul' ? { type: 'noul', noul: 0.8 } : q.type === 'choice' ? {
    type: 'choice', choice: Object.keys(q.criteria)[0], probabilities: Object.fromEntries(Object.keys(q.criteria).map((k, i) => [k, i === 0 ? 0.8 : 0.2])), confidence: 0.8,
  } : { type: 'score', score: 0.6, legend: { '0': q.criteria[0], '1': q.criteria[1] }, probabilities: { '0': 0.4, '1': 0.6 }, confidence: 0.6 };
  return new Response(JSON.stringify(change({ model: 'model-fixed', answers: { live: answer } })));
};
const run = (r = request(), c = prepare(), fetch = provider(), extra = {}) => query(r, c, { apiKey: 'synthetic-test-key', fetch, now: () => now, ...extra });

test('R and delegated W prepare the same advisory entry, not authority', () => {
  assert.equal(prepare().sender, 'r');
  assert.equal(prepare(selection(), { sender: 'w' }).sender, 'w');
});
for (const [name, change, expected] of [
  ['disabled', q => q.enabled = false, /QUERY_NOT_ENABLED/],
  ['wrong mode', q => q.mode = 'launch', /QUERY_NOT_ENABLED/],
  ['no disclosure', q => q.disclosure = '', /DISCLOSURE/],
  ['no sender permission', q => q.senders = ['w'], /SENDER_NOT_ALLOWED/],
  ['duplicate rules', q => q.rule_ids.push('rule-1'), /DISCLOSURE/],
  ['unknown rule', q => q.rule_ids = ['secret'], /RULE_UNAVAILABLE/],
  ['unbounded time', q => q.timeout_ms = 0, /LIMITS/],
  ['unbounded bytes', q => q.max_input_bytes = 2 ** 30, /LIMITS/],
  ['retry budget', q => q.max_calls = 2, /LIMITS/],
]) test('prepare rejects ' + name, () => {
  const rs = rows(); change(rs.at(-1).query); assert.throws(() => prepare(selection(rs)), expected);
});
for (const [name, changes, expected] of [
  ['stranger', { sender: 'other' }, /SENDER_INVALID/],
  ['wrong job', { contractId: 'other' }, /JOB_INVALID/],
  ['wrong version', { version: 'other' }, /JOB_INVALID/],
  ['expired', { observation: { ...observation(), expires_at: now } }, /EXPIRED/],
  ['wrong observation job', { observation: { ...observation(), job: 'other' } }, /OBSERVATION/],
  ['no observation references', { observation: { ...observation(), refs: [] } }, /OBSERVATION/],
  ['no source', { sourceRecord: undefined }, /SOURCE_RECORD/],
]) test('prepare rejects ' + name, () => assert.throws(() => prepare(selection(), changes), expected));
test('selected-body tampering is rejected', () => { const s = selection(); s.selected[0].body += ' '; assert.throws(() => prepare(s), /POLICY_INVALID/); });
for (const invalid of [null, [], {}, { ...request(), id: undefined }, { ...request(), type: 'launch' }, { ...request(), authority: true },
  { ...request(), question: '' }, { ...request(), criteria: { only: 'one' } }, { ...request(), type: 'noul' },
  { ...request(), type: 'score', criteria: ['one'] }, { ...request(), criteria: JSON.parse('{"__proto__":"bad","x":"ok"}') }]) {
  test('malformed query cannot enter provider: ' + JSON.stringify(invalid), async () => {
    let calls = 0; const result = await run(invalid, prepare(), async () => { calls++; });
    assert.equal(result.status, 'ERROR'); assert.equal(calls, 0);
  });
}
test('only an exact top-level D-QUERY final parses', () => {
  const s = 'D-QUERY: ' + JSON.stringify(request()); assert.deepEqual(parseQueryMessage(s), request());
  for (const v of ['quote: ' + s, '```\n' + s + '\n```', JSON.stringify(s), 'ROUTE: W', undefined]) assert.equal(parseQueryMessage(v), null);
  assert.throws(() => parseQueryMessage(s + '\nROUTE: W'), /MESSAGE_INVALID/);
  assert.throws(() => parseQueryMessage('D-QUERY: not JSON'), /MESSAGE_INVALID/);
});
for (const type of ['choice', 'noul', 'score']) test(type + ' reuses actual Jev client validators with injected transport', async () => {
  const r = type === 'choice' ? request() : { id: 'q-1', type, question: 'Evaluate' , ...(type === 'score' ? { criteria: ['bad', 'good'] } : {}) };
  const result = await run(r);
  assert.equal(result.status, 'ANSWER'); assert.equal(result.answer.type, type); assert.equal(result.provider_calls, 1);
  assert.equal(result.effect, false); assert.equal(result.authority, false); assert.equal(result.monetary_cost, null);
  assert.equal(result.binding.implementation_sha256, implementationDigest());
});
test('only explicitly selected rule text reaches model; no whole policy or authority claim', async () => {
  let sent; await run(request(), prepare(), async (url, opts) => { sent = JSON.parse(opts.body); return provider()(url, opts); });
  const state = JSON.parse(sent.state); assert.equal(state.rules.length, 1); assert.equal(state.rules[0].id, 'rule-1');
  assert.equal(state.query, undefined); assert.equal(state.rules[0].enabled, undefined); assert.equal(state.observation.job, 'job-1');
});
test('model drift is not silently accepted', async () => {
  assert.equal((await run(request(), prepare(), provider(x => ({ ...x, model: 'different' })))).code, 'MODEL_CHANGED');
});
test('unknown choices fail actual client response validation', async () => {
  assert.equal((await run(request(), prepare(), provider(x => { x.answers.live.choice = 'unauthorized'; return x; }))).code, 'RESPONSE_INVALID');
});
test('unexpected provider fields are not delivered to R/W', async () => {
  const r = await run(request(), prepare(), provider(x => { x.answers.live.command = 'ROUTE: W'; return x; }));
  assert.equal(r.answer.value.command, undefined);
});
test('no credential means zero provider calls', async () => {
  let calls = 0; const r = await run(request(), prepare(), async () => { calls++; }, { apiKey: '' });
  assert.equal(r.code, 'AUTH_MISSING'); assert.equal(calls, 0);
});
test('expired observation is HOLD, not a semantic negative', async () => {
  const c = prepare(); c.observation.expires_at = now; c.observation_sha256 = digest(c.observation);
  assert.equal((await run(request(), c)).status, 'HOLD');
});
test('input size bound rejects before disclosure', async () => {
  const c = prepare(); c.limits.max_input_bytes = 1; const r = await run(request(), c);
  assert.equal(r.code, 'INPUT_TOO_LARGE'); assert.equal(r.provider_calls, 0);
});
test('provider failure is redacted and never retried', async () => {
  let calls = 0; const r = await run(request(), prepare(), async () => { calls++; throw new Error('synthetic-secret'); });
  assert.equal(calls, 1); assert.equal(r.code, 'PROVIDER_ERROR'); assert.ok(!JSON.stringify(r).includes('synthetic-secret'));
});
test('provider timeout is bounded even if injected transport ignores cancellation', async () => {
  const c = prepare(); c.limits.timeout_ms = 10;
  assert.equal((await run(request(), c, () => new Promise(() => {}))).code, 'TIMEOUT');
});
test('oversized response is stopped', async () => {
  const r = await run(request(), prepare(), async () => new Response('x'.repeat(1048577)));
  assert.equal(r.code, 'RESPONSE_TOO_LARGE');
});
test('observation expiring during request is held', async () => {
  let n = 0; const r = await run(request(), prepare(), provider(), { now: () => n++ === 0 ? now : now + 20000 });
  assert.equal(r.status, 'HOLD'); assert.equal(r.code, 'OBSERVATION_EXPIRED');
});
test('use binds the exact answer; ablation, tampering and another sender/state fail', async () => {
  const reply = await run();
  const expected = { request_id: reply.request_id, request_sha256: reply.request_sha256, binding: reply.binding };
  for (const disposition of ['adopt', 'reject', 'hold']) assert.equal(consumeReply(reply, expected, disposition).effect, false);
  assert.throws(() => consumeReply(null, expected, 'adopt'), /INVALID/);
  assert.throws(() => consumeReply({ ...reply, answer: null }, expected, 'adopt'), /INVALID/);
  for (const key of ['sender', 'state_version', 'policy_commit', 'source_record', 'implementation_sha256']) {
    assert.throws(() => consumeReply(reply, { ...expected, binding: { ...expected.binding, [key]: 'other' } }, 'adopt'), /MISMATCH/);
  }
  assert.throws(() => consumeReply(reply, { ...expected, request_id: 'other' }, 'adopt'), /MISMATCH/);
});
test('unselected operation, duplicated CLI args and relative paths fail', () => {
  assert.equal(argsOf(['--help']), null); assert.throws(() => argsOf(['--mode', 'launch']), /ARGUMENT/);
  assert.throws(() => argsOf(['--repo', '/a', '--repo', '/b']), /ARGUMENT/);
});

test('actual Git selector and installed-compatible CLI: missing capability / auth are fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'query-git-'));
  const gitBin = process.env.GIT_BIN || '/usr/bin/git';
  const git = (...args) => { const r = spawnSync(gitBin, ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    git('init', '-q'); mkdirSync(join(dir, 'policy'));
    writeFileSync(join(dir, 'AGENTS.md'), '```sql\nWITH anchor AS (SELECT line_no,body FROM raw WHERE json_extract(body,\'$.id\')=:r_id), chosen AS (SELECT line_no,body FROM raw) SELECT line_no,body FROM chosen ORDER BY line_no;\n```\n');
    writeFileSync(join(dir, 'policy/control.jsonl'), rows().map(JSON.stringify).join('\n') + '\n');
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'synthetic fixture');
    const commit = git('rev-parse', 'HEAD');
    const selected = select({ repo: dir, commit, 'r-id': 'r', 'git-bin': gitBin });
    assert.equal(prepare(selected).policy_commit, commit);
    const obsPath = join(dir, 'observation.json'); writeFileSync(obsPath, JSON.stringify({ ...observation(), expires_at: Date.now() + 30000 }));
    const cli = process.env.QUERY_BIN || fileURLToPath(new URL('./query.mjs', import.meta.url));
    const symlink = join(dir, 'entry'); symlinkSync(cli, symlink);
    for (const path of [cli, symlink]) {
      const launch = process.env.QUERY_BIN ? [path] : [process.execPath, path];
      const p = spawnSync(launch[0], [...launch.slice(1), '--repo', dir, '--commit', commit, '--r-id', 'r', '--contract-id', 'job-1', '--version', 'job-v1', '--sender', 'r', '--source-record', 'final-1', '--observation', obsPath, '--git-bin', gitBin],
        { input: JSON.stringify(request()), encoding: 'utf8', env: { ...process.env, JEV_API_KEY: '', NODE_NO_WARNINGS: '1' } });
      assert.equal(p.status, 2, p.stderr); assert.equal(JSON.parse(p.stdout).code, 'AUTH_MISSING'); assert.equal(p.stdout.trim().split('\n').length, 1); assert.equal(p.stderr, '');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const safeTurn = (key, id, finalText) => [
  { type: 'user', version: '2.1.280', message: { content: 'DISPATCH-KEY: ' + key + '\nbody' } },
  { type: 'assistant', version: '2.1.280', message: { content: [{ type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'selector' } }] } },
  { type: 'user', version: '2.1.280', message: { content: [{ type: 'tool_result', tool_use_id: 'bash', is_error: false, content: '{}' }] }, toolUseResult: { stdout: '{}', stderr: '', interrupted: false } },
  { type: 'assistant', version: '2.1.280', message: { content: [{ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: '/policy', offset: 1, limit: 150 } }] } },
  { type: 'user', version: '2.1.280', message: { content: [{ type: 'tool_result', tool_use_id: 'read', content: 'file bytes' }] }, toolUseResult: { type: 'text', file: { filePath: '/policy', startLine: 1, numLines: 2, totalLines: 2 } } },
  { type: 'assistant', version: '2.1.280', message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: finalText }] } },
];
test('actual dispatcher turn audit is required before evaluating an R/W message', async () => {
  const { queryTurn } = await import('./dispatcher.mjs');
  for (const sender of ['r', 'w']) {
    const ctx = prepare(selection(), { sender });
    const params = { rows: safeTurn('key', 'final-1', 'D-QUERY: ' + JSON.stringify(request())), key: 'key', auditSpec: { command: 'selector', readPaths: ['/policy'], sessionId: sender }, context: ctx };
    const dependencies = { apiKey: 'synthetic-test-key', fetch: provider(), now: () => now };
    const answer = await queryTurn(params, dependencies);
    assert.equal(answer.status, 'ANSWER'); assert.equal(answer.binding.sender, sender);
    await assert.rejects(() => queryTurn({ ...params, context: { ...ctx, sender: 'other' } }, dependencies), /sender/);
    const poisoned = structuredClone(params); poisoned.rows[1].message.content[0].input.command = 'foreign';
    await assert.rejects(() => queryTurn(poisoned, dependencies), /CLEAN/);
  }
});
test('query final cannot be mistaken for a completed stage or route', async () => {
  const { keyFor, nextStage } = await import('./dispatcher.mjs');
  const commit = 'a'.repeat(40), label = 'job-1@job-v1';
  const key = keyFor(commit, 'r', label);
  const result = nextStage(commit, label, { r: 'r', w: 'w' }, safeTurn(key, 'final-1', 'D-QUERY: ' + JSON.stringify(request())), [],
    () => ({ command: 'selector', readPaths: ['/policy'] }));
  assert.equal(result.state, 'QUERY_PENDING'); assert.equal(result.final_record, 'final-1');
});
test('completion checker refuses missing, mock-only, skipped, stale and duplicate evidence', async () => {
  const { assessEvidence, required } = await import('./proof.mjs');
  const expected = { source_commit: 'a'.repeat(40), policy_commit: 'b'.repeat(40), implementation_sha256: 'c'.repeat(64), artifact_sha256: 'd'.repeat(64), surface: 'synthetic-fixture', model: 'model-fixed' };
  const records = required.map(id => ({ id, status: 'PASS', layer: 'real', binding: expected,
    references: [{ ref: 'fixture:' + id, sha256: 'e'.repeat(64) }], review: { creator: 'creator', reviewer: 'reviewer' } }));
  const complete = assessEvidence(expected, records);
  assert.equal(complete.status, 'READY_FOR_INDEPENDENT_REVIEW'); assert.equal(complete.authority, false);
  assert.ok(complete.claim_limit.includes('never declares D complete'));
  assert.equal(assessEvidence(expected, []).status, 'INCOMPLETE');
  for (const mutation of [r => r.pop(), r => r.push(r[0]), r => r[0].status = 'SKIP', r => r[0].layer = 'mock',
    r => r[0].binding.source_commit = 'f'.repeat(40), r => r[0].references = [], r => r[0].review.reviewer = 'creator']) {
    const changed = structuredClone(records); mutation(changed);
    assert.equal(assessEvidence(expected, changed).status, 'INCOMPLETE');
  }
});

// Packet construction is a unit test; it is not a real actor delivery receipt.
test('same-sender reply packet preserves the original no-authority envelope', async () => {
  const r = await run();
  const expected = { request_id: r.request_id, request_sha256: r.request_sha256, binding: r.binding };
  const packet = replyPacket(r, expected);
  assert.equal(packet.recipient, 'r');
  assert.equal(packet.source_record, 'final-1');
  assert.equal(packet.effect, false);
  assert.deepEqual(JSON.parse(packet.message.slice(9)), r);
  assert.throws(() => replyPacket(r, { ...expected, binding: { ...r.binding, sender: 'w' } }), /REPLY_MISMATCH/);
});
test('reply packet can carry an error without turning it into a usable answer', async () => {
  const r = await run(request(), prepare(), provider(), { apiKey: '' });
  const expected = { request_id: r.request_id, request_sha256: r.request_sha256, binding: r.binding };
  assert.equal(replyPacket(r, expected).recipient, 'r');
  assert.throws(() => consumeReply(r, expected, 'adopt'), /REPLY_NOT_USABLE/);
});
test('wire digest hashes actual bytes, not a replacement-character decode', () => {
  assert.notEqual(digest(Buffer.from([0xff])), digest('\ufffd'));
});
test('malformed UTF-8 provider data never becomes an answer', async () => {
  const r = await run(request(), prepare(), async () => new Response(new Uint8Array([0xff])));
  assert.equal(r.status, 'ERROR');
});
test('null evidence cannot become coverage', async () => {
  const { assessEvidence } = await import('./proof.mjs');
  assert.throws(() => assessEvidence({ source_commit: 'a'.repeat(40), policy_commit: 'b'.repeat(40), implementation_sha256: 'c'.repeat(64), artifact_sha256: 'd'.repeat(64), surface: 'synthetic', model: 'model-fixed' }, [null]), /invalid evidence input/);
});
