import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberedLines, safePath, select, validateRows } from './policy-select.mjs';

const cli = fileURLToPath(new URL('./policy-select.mjs', import.meta.url));
const root = { op: 'document', id: '/root', rel: null, schema: 3, state: 'active' };
const r = { id: 'r', rel: { parent: '/root', kind: 'reviews' }, state: 'active', role: 'r' };
const w = { id: 'w', rel: { parent: 'r', kind: 'delegates' }, state: 'active', role: 'w' };
const detail = { id: 'detail', rel: { parent: 'r', kind: 'details' }, state: 'active' };
const base = [root, r, w, detail];
const check = (rows) => validateRows(rows.map((row, i) => ({ lineNo: i + 1, body: JSON.stringify(row) })));

test('preserves original JSONL line numbers across blanks and CRLF', () => {
  const lines = numberedLines('\r\n' + JSON.stringify(root) + '\r\n\r\n' + JSON.stringify(r) + '\r\n');
  assert.deepEqual(lines.map((x) => x.lineNo), [2, 4]);
});

test('accepts connected root, R, W and leaf detail', () => {
  assert.equal(check(base).size, 4);
});

for (const [name, rows, error] of [
  ['duplicate id', [...base, { ...w }], /duplicate id/],
  ['missing parent', base.map((x) => x.id === 'w' ? { ...x, rel: { parent: 'missing', kind: 'delegates' } } : x), /invalid relation/],
  ['inactive parent', base.map((x) => x.id === 'r' ? { ...x, state: 'inactive' } : x), /inactive parent/],
  ['details child', [...base, { id: 'child', rel: { parent: 'detail', kind: 'other' }, state: 'active' }], /details must be leaf/],
  ['wrong root schema', base.map((x) => x.id === '/root' ? { ...x, schema: 2 } : x), /root must be unique/],
  ['cycle', base.map((x) => x.id === 'r' ? { ...x, rel: { parent: 'w', kind: 'reviews' } } : x), /cycle/],
  ['legacy parent', base.map((x) => x.id === 'w' ? { ...x, parent: 'r' } : x), /legacy parent/],
  ['nonroot null rel', base.map((x) => x.id === 'w' ? { ...x, rel: null } : x), /invalid relation/],
  ['invalid state', base.map((x) => x.id === 'w' ? { ...x, state: 'started' } : x), /invalid state/],
]) {
  test('rejects ' + name, () => assert.throws(() => check(rows), error));
}

test('rejects unsafe requires paths', () => {
  for (const path of ['../secret', '/absolute', 'policy//file', 'policy/./file', 'policy\\file'])
    assert.throws(() => safePath(path), /unsafe requires path/);
});

const repo = process.env.ADRS_REPO || '/work/repos/adrs-canonical';
const gitBin = process.env.GIT_BIN || '/root/.nix-profile/bin/git';
const commit = 'e88fa93a1c7051334ebdb9b9f25b781926ba42d9';
test('pinned ADRS AGENTS SQL and exact blob identities', { skip: !existsSync(repo) }, () => {
  const result = select({ repo, commit, 'r-id': 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c',
    'git-bin': gitBin, authority: {} });
  assert.equal(result.row_count, 236);
  assert.equal(result.anchor_count, 1);
  assert.equal(result.agents.oid, 'ce77ce01ffd512c18e0899d762f6a37b1b836ef8');
  assert.equal(result.control.oid, '0c0e037a25d145d6a7721e77c80972512a52e89d');
  assert.deepEqual(result.selected.map((x) => x.body_sha256), [
    'b48bd509e81ebd918fd604207f08c2eba0a957a80fcb6eb24399804d85529529',
    'c90a1213cc23126f914f9135da812143a7bb440c32d19901cdc5fb707e6cad81',
    'c9edd8488ac9d3b28569891d66385a7c97a06e10f88d7371b6e8f00fdaaec086',
    '4a10fec27f0d7ede008c32278d584cf8d61c60527fb9f09ca1cab50e4ea717e9',
  ]);
  assert.equal(result.sql_sha256, '921b097ee714ed10501628a687d3b59b6130c4862dae436d2a751ee6778e7925');
  assert.deepEqual(result.selected.map((x) => [x.line_no, x.id]), [
    [1, '/root'], [234, 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c'],
    [235, '71bd57d0-e795-4a5e-846c-999d3073afa7'],
    [236, 'policy.jev.d-replacement.oci.v1'],
  ]);
  assert.deepEqual(result.requires.map((x) => x.oid), [
    '521a4ddf1e3d76bf0383329e30d4433fe06961ac',
    '07a2311852cc8799cabc551660b68f9559a5054a',
    '6aeb024d4bd5f648af1632cb86b7bdb18bbf588d',
  ]);
  assert.throws(() => select({ repo, commit, 'r-id': '71bd57d0-e795-4a5e-846c-999d3073afa7',
    'git-bin': gitBin, authority: {} }), /R anchor/);
});


test('CLI executes through a symlink and emits JSON', { skip: !existsSync(repo) }, () => {
  const link = join(tmpdir(), 'jev-select-' + randomUUID() + '.mjs');
  symlinkSync(cli, link);
  try {
    const p = spawnSync(process.execPath, [link, '--repo', repo, '--commit', commit,
      '--r-id', 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c', '--git-bin', gitBin,
      '--format', 'compact'], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.equal(JSON.parse(p.stdout).anchor_count, 1);
  } finally { unlinkSync(link); }
});

test('keyed turns distinguish absent, complete, incomplete and duplicate records', async () => {
  const { keyedTurn, keyFor, decide } = await import('./dispatcher.mjs');
  const key = keyFor('a'.repeat(40), 'r', 'b'.repeat(40));
  const user = { type: 'user', message: { content: 'DISPATCH-KEY: ' + key + '\nbody' } };
  const block = { type: 'user', message: { content: [{ type: 'text', text: 'DISPATCH-KEY: ' + key }] } };
  const done = { type: 'assistant', message: { id: 'msg-1', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'done' }] } };
  assert.equal(keyedTurn([], key).state, 'ABSENT');
  assert.equal(keyedTurn([user], key).state, 'STOP_INCOMPLETE');
  assert.deepEqual(keyedTurn([user, done], key), { state: 'DUPLICATE', final: { id: 'msg-1', text: 'done' } });
  assert.equal(keyedTurn([block, done], key).state, 'DUPLICATE');
  assert.equal(keyedTurn([user, block], key).state, 'STOP_DUPLICATE_RECORDS');
  assert.equal(keyedTurn([{ type: 'assistant', message: { content: 'DISPATCH-KEY: ' + key } }], key).state, 'ABSENT');
  for (const state of ['ABSENT', 'DUPLICATE', 'STOP_INCOMPLETE'])
    assert.equal(decide('check', state), 'NO_FIRE');
  assert.equal(decide('launch', 'ABSENT'), 'FIRE');
});

test('instruction requires one exact final line and permits R to decline', async () => {
  const { instruction } = await import('./dispatcher.mjs');
  const task = { id: 'pin-audit', refs: ['policy/organization.md', 'policy/README.md'] };
  const commit = 'a'.repeat(40);
  const line = 'W-START: task=pin-audit refs=policy/organization.md,policy/README.md C=' + commit;
  assert.equal(instruction('I decline', task, commit), 'DECLINED');
  assert.equal(instruction('Reason\n' + line, task, commit), line);
  assert.throws(() => instruction(line + '\n' + line, task, commit), /invalid/);
  assert.throws(() => instruction(line + '\nMore prose', task, commit), /invalid/);
  assert.throws(() => instruction('\x60' + line + '\x60', task, commit), /invalid/);
});

const auditSpec = { command: 'selector', readPaths: ['/policy'] };
const safeTurn = (key, id, text = 'done') => [
  { type: 'user', version: '2.1.280',
    message: { content: 'DISPATCH-KEY: ' + key + '\nbody' } },
  { type: 'assistant', version: '2.1.280', message: { content: [
    { type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'selector' } },
  ] } },
  { type: 'user', version: '2.1.280',
    message: { content: [{ type: 'tool_result', tool_use_id: 'bash', is_error: false,
      content: '{}' }] },
    toolUseResult: { stdout: '{}', stderr: '', interrupted: false } },
  { type: 'assistant', version: '2.1.280', message: { content: [
    { type: 'tool_use', id: 'read', name: 'Read',
      input: { file_path: '/policy', offset: 1, limit: 150 } },
  ] } },
  { type: 'user', version: '2.1.280',
    message: { content: [{ type: 'tool_result', tool_use_id: 'read', content: 'file bytes' }] },
    toolUseResult: { type: 'text',
      file: { filePath: '/policy', startLine: 1, numLines: 2, totalLines: 2 } } },
  { type: 'assistant', version: '2.1.280',
    message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text }] } },
];

test('turn safety uses metadata and complete Read coverage', async () => {
  const { auditTurn } = await import('./dispatcher.mjs');
  const key = 'key';
  const clean = safeTurn(key, 'final', 'quoted <persisted-output> and is_error');
  assert.equal(auditTurn(clean, key, auditSpec), 'CLEAN');
  const persisted = structuredClone(clean);
  persisted[2].toolUseResult.persistedOutputPath = '/private/result';
  assert.equal(auditTurn(persisted, key, auditSpec), 'STOP_PERSISTED_OUTPUT');
  const errored = structuredClone(clean);
  errored[2].message.content[0].is_error = true;
  assert.equal(auditTurn(errored, key, auditSpec), 'STOP_TOOL_ERROR');
  const foreign = structuredClone(clean);
  foreign[1].message.content[0].input.command = 'other';
  assert.equal(auditTurn(foreign, key, auditSpec), 'STOP_FOREIGN_TOOL');
  const partial = structuredClone(clean);
  partial[4].toolUseResult.file.numLines = 1;
  assert.equal(auditTurn(partial, key, auditSpec), 'STOP_READ_INCOMPLETE');
  const unknown = structuredClone(clean);
  delete unknown[4].toolUseResult.file.startLine;
  assert.equal(auditTurn(unknown, key, auditSpec), 'UNKNOWN_FORM');
  const version = structuredClone(clean);
  version[1].version = 'other';
  assert.equal(auditTurn(version, key, auditSpec), 'UNKNOWN_VERSION');
  const unknownRow = structuredClone(clean);
  unknownRow.splice(3, 0, { type: 'system', subtype: 'compact_boundary' });
  assert.equal(auditTurn(unknownRow, key, auditSpec), 'UNKNOWN_FORM');
  const hook = structuredClone(clean);
  hook.splice(3, 0, { type: 'attachment', attachment: { type: 'hook_additional_context' } });
  assert.equal(auditTurn(hook, key, auditSpec), 'UNKNOWN_FORM');
  const reminder = structuredClone(clean);
  reminder.splice(3, 0, { type: 'attachment',
    attachment: { type: 'total_tokens_reminder', text: 'context reminder' } });
  assert.equal(auditTurn(reminder, key, auditSpec), 'CLEAN');
  const denied = structuredClone(clean);
  denied[2].message.content[0].is_error = true;
  denied[2].toolUseResult = 'Error: Permission denied';
  assert.equal(auditTurn(denied, key, auditSpec), 'STOP_TOOL_ERROR');
  const foreignUse = structuredClone(clean);
  foreignUse[1].message.content[0].type = 'server_tool_use';
  assert.equal(auditTurn(foreignUse, key, auditSpec), 'STOP_FOREIGN_TOOL');
  const hiddenResult = structuredClone(clean);
  hiddenResult[2].message.content[0].type = 'server_tool_result';
  assert.equal(auditTurn(hiddenResult, key, auditSpec), 'STOP_FOREIGN_TOOL');
  const image = structuredClone(clean);
  image[4].message.content.push({ type: 'image', source: 'unexpected' });
  assert.equal(auditTurn(image, key, auditSpec), 'UNKNOWN_FORM');
  const document = structuredClone(clean);
  document[3].message.content.push({ type: 'document', source: 'unexpected' });
  assert.equal(auditTurn(document, key, auditSpec), 'UNKNOWN_FORM');
  const mismatched = structuredClone(clean);
  mismatched[2].message.content[0].content = 'shorter';
  assert.equal(auditTurn(mismatched, key, auditSpec), 'UNKNOWN_FORM');
  const unreturned = clean.filter((_, i) => i !== 4);
  assert.equal(auditTurn(unreturned, key, auditSpec), 'UNKNOWN_FORM');
});

// Synthetic pr-link session metadata; no real session, repository or PR.
const prLink = (sessionId, number = 7, repository = 'example-org/example-repo') => ({
  type: 'pr-link', sessionId, prNumber: number,
  prUrl: 'https://github.com/' + repository + '/pull/' + number,
  prRepository: repository, timestamp: '2026-01-02T03:04:05.678Z' });
const withRows = (rows, ...extra) => {
  const copy = structuredClone(rows);
  copy.splice(3, 0, ...extra);
  return copy;
};

test('pr-link metadata is accepted only in its exact shape for the audited session', async () => {
  const { auditTurn } = await import('./dispatcher.mjs');
  const key = 'key';
  const clean = safeTurn(key, 'final');
  const spec = { ...auditSpec, sessionId: 'w-session' };
  const audit = (...links) => auditTurn(withRows(clean, ...links), key, spec);
  const changed = (edit) => { const link = prLink('w-session'); edit(link); return link; };
  assert.equal(audit(prLink('w-session')), 'CLEAN');
  assert.equal(audit(prLink('w-session'), prLink('w-session')), 'CLEAN');
  assert.equal(audit(prLink('w-session', 7), prLink('w-session', 8, 'other-org/other-repo')), 'CLEAN');
  assert.equal(auditTurn(withRows(clean, prLink('w-session')), key, auditSpec), 'UNKNOWN_FORM');
  for (const link of [
    prLink('r-session'),
    changed((x) => { delete x.timestamp; }),
    changed((x) => { x.uuid = 'extra'; }),
    changed((x) => { x.prNumber = '7'; }),
    changed((x) => { x.prNumber = 0; }),
    changed((x) => { x.prNumber = 7.5; }),
    changed((x) => { x.prNumber = -7; }),
    changed((x) => { x.prRepository = 'other-org/example-repo'; }),
    changed((x) => { x.prUrl = 'https://github.com/example-org/example-repo/pull/8'; }),
    changed((x) => { x.prUrl = 'https://example.com/example-org/example-repo/pull/7'; }),
    changed((x) => { x.prUrl = 'http://github.com/example-org/example-repo/pull/7'; }),
    changed((x) => { x.prRepository = 'example-repo'; x.prUrl = 'https://github.com/example-repo/pull/7'; }),
    changed((x) => { x.prRepository = 'example-org/..'; x.prUrl = 'https://github.com/example-org/../pull/7'; }),
    changed((x) => { x.timestamp = 'yesterday'; }),
    changed((x) => { x.timestamp = '2026-13-40T00:00:00Z'; }),
    changed((x) => { x.timestamp = '2026-02-30T00:00:00Z'; }),
    changed((x) => { x.timestamp = '2025-02-29T00:00:00Z'; }),
    changed((x) => { x.timestamp = '2026-01-02T25:00:00Z'; }),
    changed((x) => { x.timestamp = '2026-01-02T24:00:00Z'; }),
    changed((x) => { x.timestamp = '2026-01-02T03:60:00Z'; }),
    changed((x) => { x.timestamp = '2026-01-02T03:04:60Z'; }),
    changed((x) => { x.timestamp = '2026-01-02T03:04:05+24:00'; }),
  ]) assert.equal(audit(link), 'UNKNOWN_FORM', JSON.stringify(link));
  for (const timestamp of ['2024-02-29T00:00:00Z', '2026-01-02T03:04:05Z',
    '2026-01-02T03:04:05.1+09:00', '2026-12-31T23:59:59.999-05:30', '0050-01-02T03:04:05Z'])
    assert.equal(audit(changed((x) => { x.timestamp = timestamp; })), 'CLEAN', timestamp);
  const drop = { type: 'attachment', attachment: { type: 'thinking_drop' } };
  assert.equal(audit(drop), 'UNKNOWN_FORM');
  assert.equal(audit(prLink('w-session'), drop), 'UNKNOWN_FORM');
  const linked = withRows(clean, prLink('w-session'));
  const partial = structuredClone(linked);
  partial[5].toolUseResult.file.numLines = 1;
  assert.equal(auditTurn(partial, key, spec), 'STOP_READ_INCOMPLETE');
  const foreign = structuredClone(linked);
  foreign[1].message.content[0].input.command = 'other';
  assert.equal(auditTurn(foreign, key, spec), 'STOP_FOREIGN_TOOL');
  const noBash = linked.filter((_, i) => i !== 1 && i !== 2);
  assert.equal(auditTurn(noBash, key, spec), 'UNKNOWN_FORM');
});

test('each stage audits pr-link metadata against its own actor', async () => {
  const { stageRoute, keyFor } = await import('./dispatcher.mjs');
  const c = 'a'.repeat(40), src = 'job.example@v1';
  const task = { id: 'example-task', refs: ['policy/a.md'] };
  const line = 'W-START: task=example-task refs=policy/a.md C=' + c;
  const actors = { r: 'r-session', w: 'w-session' };
  const r = withRows(safeTurn(keyFor(c, 'r-session', src), 'r-final', 'reason\n' + line),
    prLink('r-session'));
  const w = withRows(safeTurn(keyFor(c, 'w-session', 'r-final'), 'w-final', 'evidence'),
    prLink('w-session'));
  assert.equal(stageRoute('w-work', c, src, task, r, [], auditSpec, actors).id, 'w-session');
  assert.equal(stageRoute('r-review', c, src, task, r, w, auditSpec, actors).source, 'w-final');
  const rWrong = withRows(safeTurn(keyFor(c, 'r-session', src), 'r-final', 'reason\n' + line),
    prLink('w-session'));
  assert.throws(() => stageRoute('w-work', c, src, task, rWrong, [], auditSpec, actors), /R start audit/);
  const wWrong = withRows(safeTurn(keyFor(c, 'w-session', 'r-final'), 'w-final', 'evidence'),
    prLink('r-session'));
  assert.throws(() => stageRoute('r-review', c, src, task, r, wWrong, auditSpec, actors), /W work audit/);
});

test('stage routing requires completed R approval and W result', async () => {
  const { stageRoute, keyFor } = await import('./dispatcher.mjs');
  const c = 'a'.repeat(40), src = 'b'.repeat(40);
  const rid = 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c';
  const wid = '71bd57d0-e795-4a5e-846c-999d3073afa7';
  const task = { id: 'pin-audit', refs: ['policy/organization.md', 'policy/README.md'] };
  const line = 'W-START: task=pin-audit refs=policy/organization.md,policy/README.md C=' + c;
  const turn = safeTurn;
  const actors = { r: rid, w: wid };
  assert.deepEqual(stageRoute('r-start', c, src, task, [], [], auditSpec, actors), { source: src, id: rid });
  assert.throws(() => stageRoute('w-work', c, src, task, [], [], auditSpec, actors), /R start/);
  const r = turn(keyFor(c, rid, src), 'r-final', 'reason\n' + line);
  assert.deepEqual(stageRoute('w-work', c, src, task, r, [], auditSpec, actors),
    { source: 'r-final', id: wid, previous: { line, r_record: 'r-final' } });
  assert.throws(() => stageRoute('r-review', c, src, task, r, [], auditSpec, actors), /W work/);
  const w = turn(keyFor(c, wid, 'r-final'), 'w-final', 'evidence');
  assert.equal(stageRoute('r-review', c, src, task, r, w, auditSpec, actors).source, 'w-final');
  assert.equal(stageRoute('r-review', c, src, task, r, w, auditSpec, actors).id, rid);
  const decline = turn(keyFor(c, rid, src), 'r-decline', 'I decline');
  assert.deepEqual(stageRoute('w-work', c, src, task, decline, [], auditSpec, actors), { declined: true });
  const badR = structuredClone(r);
  badR[2].toolUseResult.persistedOutputPath = '/private/result';
  assert.throws(() => stageRoute('w-work', c, src, task, badR, [], auditSpec, actors), /R start audit/);
  const badW = structuredClone(w);
  badW[2].toolUseResult.persistedOutputPath = '/private/result';
  assert.throws(() => stageRoute('r-review', c, src, task, r, badW, auditSpec, actors), /W work audit/);
  const job = 'job.example@v1';
  const jobStart = turn(keyFor(c, 'r-session', job), 'r-job', 'reason\n' + line);
  assert.equal(stageRoute('w-work', c, job, task, jobStart, [], auditSpec,
    { r: 'r-session', w: 'w-session' }).id, 'w-session');
});

test('keyed turn keeps split text, ignores repeat, and recognizes array user boundary', async () => {
  const { keyedTurn, keyFor } = await import('./dispatcher.mjs');
  const key = keyFor('a'.repeat(40), 'r', 'b');
  const start = { type: 'user', message: { content: 'DISPATCH-KEY: ' + key } };
  const final = (text, id = 'm1') => ({ type: 'assistant', message: { id,
    model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text }] } });
  const next = { type: 'user', message: { content: [{ type: 'text', text: 'later' }] } };
  assert.deepEqual(keyedTurn([start, final('one '), final('two'), final('two')], key),
    { state: 'DUPLICATE', final: { id: 'm1', text: 'one two' } });
  assert.equal(keyedTurn([start, final('one'), next, final('later', 'm2')], key).final.text, 'one');
  assert.equal(keyedTurn([start, { type: 'assistant', message: { id: 'wrong',
    model: 'other', stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] } }], key).state,
    'STOP_INCOMPLETE');
});

// Synthetic selection: no real policy text, task question or transcript content.
const ALLOWED = '<each allowed_tools_template pattern as its own argv element; substitute C first>';
const TEMPLATE = ['/usr/bin/env', 'SHELL=/bin/sh', 'PATH=/bin', '/lib/ld.so', '--library-path', '/lib',
  '/opt/cli', '-p', '--resume', '<OCI-W-or-R-session-id>', '--model', 'model-x',
  '--permission-mode', 'dontAsk', '--tools', 'Bash,Read', '--allowedTools', ALLOWED,
  '--setting-sources', '', '--strict-mcp-config', '--output-format', 'json', '<minimal-prompt>'];
const withTemplate = (edit) => changed('policy.jev.d-replacement.oci.v1', (row) => {
  row.target.argv_template = edit([...TEMPLATE]);
});
const jobRows = () => [
  { op: 'document', id: '/root', rel: null, schema: 3, state: 'active' },
  { id: 'r-session', rel: { parent: '/root', kind: 'reviews' }, state: 'active', role: 'r',
    requires: ['policy/a.md', 'policy/b.md'] },
  { id: 'w-session', rel: { parent: 'r-session', kind: 'delegates' }, state: 'active', role: 'w' },
  { id: 'policy.jev.d-replacement.oci.v1', rel: { parent: 'r-session', kind: 'details' }, state: 'active',
    target: { cli: '/opt/cli', model: 'model-x', argv_template: TEMPLATE, cwd: '/work',
      read_paths: ['old.md'], allowed_tools_template: ['Read(//old/old.md)'] } },
  { id: 'job.example', rel: { parent: 'r-session', kind: 'details' }, state: 'active', version: 'v1',
    r_id: 'r-session', w_id: 'w-session', uses_target_of: 'policy.jev.d-replacement.oci.v1',
    task: { id: 'example-task', refs: ['policy/a.md'], w_question: 'Synthetic question.' },
    dispatcher: { authority: 'roccho-dev/ops', commit: 'c'.repeat(40),
      path: 'packages/jev-dispatcher/dispatcher.mjs', checkout: '/ops' },
    adrs_read_checkout: '/adrs', ops_read_checkout: '/ops', limits: { timeout_ms: 1000 } },
];
const asSelected = (rows) => rows.map((body) => ({ id: body.id, body: JSON.stringify(body) }));
const jobArgs = { rId: 'r-session', contractId: 'job.example', version: 'v1' };
const changed = (id, edit) => asSelected(jobRows().map((row) => {
  if (row.id !== id) return row;
  const copy = structuredClone(row);
  edit(copy);
  return copy;
}));

test('job row supplies actors, task, checkouts and timeout', async () => {
  const { loadJob } = await import('./dispatcher.mjs');
  const job = loadJob(asSelected(jobRows()), jobArgs);
  assert.equal(job.r, 'r-session');
  assert.equal(job.w, 'w-session');
  assert.equal(job.task.w_question, 'Synthetic question.');
  assert.deepEqual(job.readPaths, ['AGENTS.md', 'policy/a.md', 'policy/b.md']);
  assert.equal(job.adrs, '/adrs');
  assert.equal(job.ops, '/ops');
  assert.equal(job.timeout, 1000);
  assert.equal(job.cwd, '/work');
});

for (const [name, selected, error] of [
  ['other version', asSelected(jobRows()), /contract mismatch/],
  ['second dispatcher row', changed('policy.jev.d-replacement.oci.v1', (row) => { row.dispatcher = {}; }), /ambiguity/],
  ['W not a delegate', changed('w-session', (row) => { row.rel.kind = 'reviews'; }), /actor mismatch/],
  ['W of another R', changed('job.example', (row) => { row.w_id = 'r-session'; }), /actor mismatch/],
  ['ref outside reads', changed('job.example', (row) => { row.task.refs = ['policy/z.md']; }), /task mismatch/],
  ['empty question', changed('job.example', (row) => { row.task.w_question = ' '; }), /task mismatch/],
  ['split Ops checkout', changed('job.example', (row) => { row.ops_read_checkout = '/other'; }), /checkout mismatch/],
  ['relative ADRS checkout', changed('job.example', (row) => { row.adrs_read_checkout = 'adrs'; }), /checkout mismatch/],
  ['missing timeout', changed('job.example', (row) => { delete row.limits; }), /timeout mismatch/],
  ['zero timeout', changed('job.example', (row) => { row.limits.timeout_ms = 0; }), /timeout mismatch/],
  ['other borrowed row', changed('job.example', (row) => { row.uses_target_of = 'other'; }), /borrowing mismatch/],
  ['external requires', changed('r-session', (row) => { row.requires.push({ authority: 'x', commit: 'a'.repeat(40), path: 'p' }); }),
    /external requires/],
  ['bad argv template', changed('policy.jev.d-replacement.oci.v1', (row) => { row.target.argv_template.push(ALLOWED); }),
    /argv template/],
  ['cwd outside the transcript project', changed('policy.jev.d-replacement.oci.v1', (row) => { row.target.cwd = '/elsewhere'; }),
    /cwd must be/],
  ['permission bypass option', withTemplate((t) => { t.splice(7, 0, '--dangerously-skip-permissions'); return t; }),
    /not allowed/],
  ['other permission mode', withTemplate((t) => { t[t.indexOf('dontAsk')] = 'acceptEdits'; return t; }),
    /value mismatch/],
  ['extra tools', withTemplate((t) => { t[t.indexOf('Bash,Read')] = 'Bash,Read,Edit'; return t; }),
    /value mismatch/],
  ['loaded setting sources', withTemplate((t) => { t[t.indexOf('--setting-sources') + 1] = 'user'; return t; }),
    /value mismatch/],
  ['repeated model option', withTemplate((t) => { t.splice(7, 0, '--model', 'model-x'); return t; }),
    /not allowed/],
  ['missing JSON output', withTemplate((t) => { t.splice(t.indexOf('--output-format'), 2); return t; }),
    /argv template mismatch/],
  ['extra environment assignment', withTemplate((t) => { t.splice(1, 0, 'EXTRA=1'); return t; }),
    /argv template mismatch/],
]) {
  test('job row rejects ' + name, async () => {
    const { loadJob } = await import('./dispatcher.mjs');
    const version = name === 'other version' ? 'v2' : 'v1';
    assert.throws(() => loadJob(selected, { ...jobArgs, version }), error);
  });
}

test('the pinned borrowed OCI template passes the option allowlist', { skip: !existsSync(repo) }, async () => {
  const { borrow, checkTemplate } = await import('./dispatcher.mjs');
  const result = select({ repo, commit: 'd2603acf75971674c9ed03f97da07a08b6bccbc6',
    'r-id': 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c', 'git-bin': gitBin });
  const old = JSON.parse(result.selected.find((row) => row.id === 'policy.jev.d-replacement.oci.v1').body);
  assert.equal(checkTemplate(borrow(old.target)).cwd, '/work');
});

test('borrowing exposes only the four named target fields', async () => {
  const { borrow } = await import('./dispatcher.mjs');
  const field = borrow(jobRows()[3].target);
  assert.equal(field('cwd'), '/work');
  for (const name of ['read_paths', 'allowed_tools_template', 'adrs_read_checkout'])
    assert.throws(() => field(name), /not borrowable/);
});

test('allowlist and argv come from the job checkouts, never the old template', async () => {
  const { loadJob, commands, buildArgv } = await import('./dispatcher.mjs');
  const job = loadJob(asSelected(jobRows()), jobArgs);
  const c = 'a'.repeat(40);
  const { allowed, audit, selectCommand } = commands(job, c);
  assert.equal(selectCommand, '/root/.nix-profile/bin/node /ops/packages/jev-dispatcher/policy-select.mjs ' +
    '--repo /adrs --commit ' + c + ' --r-id r-session ' +
    '--git-bin /root/.nix-profile/bin/git --format selected');
  assert.deepEqual(allowed, ['Read(//adrs/AGENTS.md)', 'Read(//adrs/policy/a.md)',
    'Read(//adrs/policy/b.md)', 'Bash(' + selectCommand + ')']);
  assert.deepEqual(audit.readPaths, ['/adrs/AGENTS.md', '/adrs/policy/a.md', '/adrs/policy/b.md']);
  assert.ok(!JSON.stringify(allowed).includes('old'));
  const argv = buildArgv(job.template, allowed, 'w-session', 'prompt');
  const start = argv.indexOf('--allowedTools') + 1;
  assert.deepEqual(argv.slice(start, start + 4), allowed);
  assert.equal(argv[argv.indexOf('--resume') + 1], 'w-session');
  assert.equal(argv.at(-1), 'prompt');
});

test('bootstrap and job ADRS stores must yield the same selection', async () => {
  const { sameSelection } = await import('./dispatcher.mjs');
  const result = () => ({ commit: 'a'.repeat(40), tree: 't', agents: { oid: 'ag' }, control: { oid: 'co' },
    sql_sha256: 'sq', selected: [{ line_no: 1, id: 'r-session', body_sha256: 'b1', body: '{}' }],
    requires: [{ path: 'policy/a.md', oid: 'p1' }] });
  assert.ok(sameSelection(result(), result()));
  for (const edit of [(x) => { x.tree = 'u'; }, (x) => { x.control.oid = 'cx'; },
    (x) => { x.selected[0].body_sha256 = 'b2'; }, (x) => { x.requires[0].oid = 'p2'; },
    (x) => { x.selected.push({ line_no: 2, id: 'w-session', body_sha256: 'b3' }); }]) {
    const other = result();
    edit(other);
    assert.ok(!sameSelection(result(), other));
  }
});

test('a contract version is used by keyed launch records at one commit only', async () => {
  const { versionUse } = await import('./dispatcher.mjs');
  const c = 'a'.repeat(40), other = 'b'.repeat(40);
  const record = (text, type = 'user') => ({ type, message: { content: text } });
  const launch = (commit, label = 'job.example@v1') => 'DISPATCH-KEY: ' + 'f'.repeat(64) +
    '\nCONTRACT: ' + label + ' C=' + commit + ' STEP=r-start SOURCE=' + label + '\nbody';
  const use = (rows) => versionUse([rows, []], 'job.example', 'v1', c);
  assert.equal(use([record(launch(other))]), 'STOP_VERSION_USED');
  assert.equal(versionUse([[], [record(launch(other))]], 'job.example', 'v1', c), 'STOP_VERSION_USED');
  assert.equal(use([{ type: 'user', message: { content: [{ type: 'text', text: launch(other) }] } }]),
    'STOP_VERSION_USED');
  assert.equal(use([record(launch(c))]), 'UNUSED_ELSEWHERE');
  assert.equal(use([record(launch(other, 'job.example@v2'))]), 'UNUSED_ELSEWHERE');
  assert.equal(use([record(launch(other), 'assistant')]), 'UNUSED_ELSEWHERE');
  assert.equal(use([record('PREPARE read-only.\n' + launch(other))]), 'UNUSED_ELSEWHERE');
  assert.equal(use([record('quoted ' + launch(other))]), 'UNUSED_ELSEWHERE');
  const legacy = 'DISPATCH-KEY: ' + 'f'.repeat(64) + '\nlegacy stage header\nbody';
  assert.equal(use([record(legacy)]), 'UNUSED_ELSEWHERE');
  const malformed = 'DISPATCH-KEY: ' + 'f'.repeat(64) + '\nCONTRACT: job.example@v1 C=short STEP=r-start';
  assert.equal(use([record(malformed)]), 'STOP_MALFORMED_RECORD');
  assert.equal(use([record(malformed.replace('C=short', 'C=' + c + ' STEP=other'))]), 'STOP_MALFORMED_RECORD');
});

test('timeout and failed children are UNKNOWN; a surviving child is STOP_ACTIVE', async () => {
  const { spawnOutcome } = await import('./dispatcher.mjs');
  const timedOut = { error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    status: null, signal: 'SIGTERM' };
  assert.equal(spawnOutcome({ status: 0, signal: null }, false), 'EXITED');
  assert.equal(spawnOutcome(timedOut, false), 'UNKNOWN');
  assert.equal(spawnOutcome(timedOut, true), 'STOP_ACTIVE');
  assert.equal(spawnOutcome({ status: 1, signal: null }, false), 'UNKNOWN');
  assert.equal(spawnOutcome({ status: 0, signal: null }, true), 'STOP_ACTIVE');
});

test('CLI names the contract id and version explicitly', async () => {
  const { argsOf } = await import('./dispatcher.mjs');
  const argv = ['--mode', 'check', '--step', 'r-start', '--commit', 'a'.repeat(40),
    '--r-id', 'r-session', '--contract-id', 'job.example', '--version', 'v1'];
  assert.deepEqual(argsOf(argv), { mode: 'check', step: 'r-start', commit: 'a'.repeat(40),
    rId: 'r-session', contractId: 'job.example', version: 'v1' });
  assert.throws(() => argsOf(argv.slice(0, 10)), /usage/);
  assert.throws(() => argsOf(argv.with(7, 'r session')), /usage/);
});

test('read checkout rejects another commit', {
  skip: !existsSync('/root/.nix-profile/bin/git') || !existsSync('/work/repos/adrs-oci-policy-self-read'),
}, async () => {
  const { verifyReadCheckout } = await import('./dispatcher.mjs');
  assert.throws(() => verifyReadCheckout('/work/repos/adrs-oci-policy-self-read',
    '0'.repeat(40), ['AGENTS.md']), /read checkout mismatch/);
});

// Synthetic scoped job: no real policy text, session, path or command.
const WT = '/wt';
const WT_FILES = [WT + '/pkg/a.mjs', WT + '/pkg/b.md'];
const scopedRows = () => jobRows().map((row) => {
  if (row.id !== 'job.example') return row;
  const { task, ...rest } = structuredClone(row);
  return { ...rest, objective: 'Synthetic objective.', target: { worktree: WT, files: ['pkg/a.mjs', 'pkg/b.md'] },
    go_commands: {
      selector: 'select --commit <C>',
      adrs_read_checkout: '/adrs',
      policy_reads: ['/adrs/AGENTS.md', '/adrs/policy/a.md', '/adrs/policy/b.md'],
      r_start: { read: [...WT_FILES], bash: [] },
      w: { read: [...WT_FILES], edit: [...WT_FILES], bash: [] },
      r_pre_publication: { read: [...WT_FILES], bash: ['diff base --commit <C>'] },
      r_post_publication: { read: [...WT_FILES], bash: ['show head', 'pr view'] },
    } };
});
const scopedChanged = (edit) => asSelected(scopedRows().map((row) => {
  if (row.id !== 'job.example') return row;
  const copy = structuredClone(row);
  edit(copy);
  return copy;
}));

test('scoped stage capabilities come only from go_commands with <C> substituted', async () => {
  const { loadJob, stageCapabilities } = await import('./dispatcher.mjs');
  const job = loadJob(asSelected(scopedRows()), jobArgs);
  const c = 'a'.repeat(40);
  const policy = ['Read(//adrs/AGENTS.md)', 'Read(//adrs/policy/a.md)', 'Read(//adrs/policy/b.md)'];
  const files = ['Read(//wt/pkg/a.mjs)', 'Read(//wt/pkg/b.md)'];
  const w = stageCapabilities(job, 'w', c);
  assert.equal(w.tools, 'Bash,Read,Edit');
  assert.deepEqual(w.allowed, [...policy, ...files, 'Edit(//wt/pkg/a.mjs)', 'Edit(//wt/pkg/b.md)',
    'Bash(select --commit ' + c + ')']);
  assert.deepEqual(w.audit, { selector: 'select --commit ' + c, commands: [],
    policyReads: ['/adrs/AGENTS.md', '/adrs/policy/a.md', '/adrs/policy/b.md'],
    stableReads: [], editPaths: WT_FILES });
  const pre = stageCapabilities(job, 'r_pre_publication', c);
  assert.equal(pre.tools, 'Bash,Read');
  assert.deepEqual(pre.allowed, [...policy, ...files, 'Bash(select --commit ' + c + ')',
    'Bash(diff base --commit ' + c + ')']);
  assert.deepEqual(pre.audit.stableReads, WT_FILES);
  assert.ok(!JSON.stringify([w, pre]).includes('old'));
  assert.throws(() => stageCapabilities(job, 'other', c), /stage capability/);
});

for (const [name, selected, error] of [
  ['both task and go_commands', scopedChanged((row) => { row.task = { id: 't', refs: ['policy/a.md'], w_question: 'q' }; }),
    /job shape/],
  ['neither task nor go_commands', scopedChanged((row) => { delete row.go_commands; }), /job shape/],
  ['relative stage path', scopedChanged((row) => { row.go_commands.r_start.read = ['wt/pkg/a.mjs']; }),
    /stage capability/],
  ['duplicate stage path', scopedChanged((row) => { row.go_commands.r_start.read.push(WT_FILES[0]); }),
    /stage capability/],
  ['edit path not read', scopedChanged((row) => { row.go_commands.w.read = [WT_FILES[1]]; }), /not readable/],
  ['edit path outside target', scopedChanged((row) => {
    row.go_commands.w.read.push('/wt/other'); row.go_commands.w.edit.push('/wt/other'); }), /outside target/],
  ['unknown placeholder', scopedChanged((row) => { row.go_commands.r_post_publication.bash = ['show <HEAD>']; }),
    /placeholder/],
  ['selector without one <C>', scopedChanged((row) => { row.go_commands.selector = 'select'; }), /go_commands/],
  ['policy reads disagree with requires', scopedChanged((row) => { row.go_commands.policy_reads.pop(); }),
    /go_commands/],
  ['other read checkout', scopedChanged((row) => { row.go_commands.adrs_read_checkout = '/other'; }), /go_commands/],
  ['relative target file', scopedChanged((row) => { row.target.files = ['/pkg/a.mjs']; }), /target mismatch/],
  ['empty objective', scopedChanged((row) => { row.objective = ' '; }), /objective/],
]) {
  test('scoped job rejects ' + name, async () => {
    const { loadJob } = await import('./dispatcher.mjs');
    assert.throws(() => loadJob(selected, jobArgs), error);
  });
}

test('argv replaces --tools only through the stage parameter', async () => {
  const { loadJob, buildArgv } = await import('./dispatcher.mjs');
  const job = loadJob(asSelected(jobRows()), jobArgs);
  const argv = (tools) => buildArgv(job.template, ['Read(//x)'], 'w-session', 'prompt', tools);
  const toolsOf = (list) => list[list.indexOf('--tools') + 1];
  assert.equal(toolsOf(buildArgv(job.template, ['Read(//x)'], 'w-session', 'prompt')), 'Bash,Read');
  assert.equal(toolsOf(argv('Bash,Read,Edit')), 'Bash,Read,Edit');
  assert.equal(job.template[job.template.indexOf('--tools') + 1], 'Bash,Read');
  assert.throws(() => argv('Bash,Read,Write'), /tools mismatch/);
});

const scopedSpec = { selector: 'selector', commands: ['declared'], policyReads: ['/policy'],
  stableReads: ['/stable'], editPaths: ['/edit'] };
const v = '2.1.280';
const use = (id, name, input) => ({ type: 'assistant', version: v,
  message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, toolUseResult, content = 'ok') => ({ type: 'user', version: v,
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content }] }, toolUseResult });
const bashPair = (id, command) => [use(id, 'Bash', { command }),
  result(id, { stdout: '{}', stderr: '', interrupted: false }, '{}')];
const readPair = (id, path, numLines, totalLines) => [use(id, 'Read', { file_path: path, offset: 1, limit: 150 }),
  result(id, { type: 'text', file: { filePath: path, startLine: 1, numLines, totalLines } })];
const scopedTurn = (key) => [
  { type: 'user', version: v, message: { content: 'DISPATCH-KEY: ' + key + '\nbody' } },
  ...bashPair('b1', 'selector'), ...bashPair('b2', 'declared'),
  ...readPair('r1', '/policy', 2, 2), ...readPair('r2', '/stable', 3, 3), ...readPair('r3', '/edit', 1, 5),
  use('e1', 'Edit', { file_path: '/edit', old_string: 'a', new_string: 'b' }),
  result('e1', { filePath: '/edit', oldString: 'a', newString: 'b' }),
  { type: 'assistant', version: v, message: { id: 'final', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'done' }] } },
];
const useOf = (rows, id) => rows.find((row) => row.message?.content?.[0]?.id === id).message.content[0];
const resultOf = (rows, id) => rows.find((row) => row.message?.content?.[0]?.tool_use_id === id);

test('scoped audit admits declared commands, stable reads and well-formed edits only', async () => {
  const { auditTurn } = await import('./dispatcher.mjs');
  const key = 'key';
  const audit = (edit, spec = scopedSpec) => {
    const rows = scopedTurn(key);
    edit(rows);
    return auditTurn(rows, key, spec);
  };
  assert.equal(audit(() => {}), 'CLEAN');
  assert.equal(audit((t) => { useOf(t, 'b2').input.command = 'other'; }), 'STOP_FOREIGN_TOOL');
  assert.equal(audit((t) => { useOf(t, 'e1').input.file_path = '/other'; }), 'STOP_FOREIGN_TOOL');
  assert.equal(audit((t) => { useOf(t, 'e1').name = 'Write'; }), 'STOP_FOREIGN_TOOL');
  assert.equal(audit((t) => { useOf(t, 'r2').input.file_path = '/elsewhere'; }), 'STOP_FOREIGN_TOOL');
  assert.equal(audit((t) => { resultOf(t, 'e1').toolUseResult.filePath = '/other'; }), 'UNKNOWN_FORM');
  assert.equal(audit((t) => { resultOf(t, 'e1').toolUseResult.newString = 'c'; }), 'UNKNOWN_FORM');
  assert.equal(audit((t) => { useOf(t, 'e1').input.extra = 1; }), 'UNKNOWN_FORM');
  assert.equal(audit((t) => { useOf(t, 'e1').input.replace_all = 'yes'; }), 'UNKNOWN_FORM');
  assert.equal(audit((t) => { useOf(t, 'e1').input.replace_all = false; }), 'CLEAN');
  assert.equal(audit((t) => { resultOf(t, 'e1').message.content[0].is_error = true; }), 'STOP_TOOL_ERROR');
  assert.equal(audit((t) => { resultOf(t, 'r2').toolUseResult.file.numLines = 1; }), 'STOP_READ_INCOMPLETE');
  assert.equal(audit((t) => { resultOf(t, 'r1').toolUseResult.file.numLines = 1; }), 'STOP_READ_INCOMPLETE');
  assert.equal(audit((t) => { t.splice(1, 2); }), 'UNKNOWN_FORM');
  assert.equal(audit(() => {}, { command: 'selector', readPaths: ['/policy', '/stable'] }), 'STOP_FOREIGN_TOOL');
});

test('route is exactly one value-free last line outside a code fence', async () => {
  const { routeOf } = await import('./dispatcher.mjs');
  for (const route of ['W', 'PUBLISH', 'P', 'TERMINAL'])
    assert.equal(routeOf('Reasons.\n\nROUTE: ' + route + '\n'), route);
  for (const text of ['no route', 'ROUTE: W\nROUTE: P', 'ROUTE: W\nmore prose',
    '\x60\x60\x60\nROUTE: W\n\x60\x60\x60', '\x60\x60\x60\nROUTE: W', 'ROUTE: w', 'ROUTE: W extra',
    '  ROUTE: P\nROUTE: W'])
    assert.throws(() => routeOf(text), /invalid route/, text);
});

test('next stage walks the keyed chain and launches nothing', async () => {
  const { nextStage, keyFor } = await import('./dispatcher.mjs');
  const c = 'a'.repeat(40), label = 'job.example@v1';
  const job = { r: 'r-session', w: 'w-session' };
  const spec = () => auditSpec;
  const rTurn = (source, id, route) => safeTurn(keyFor(c, 'r-session', source), id, 'reasons\nROUTE: ' + route);
  const wTurn = (source, id) => safeTurn(keyFor(c, 'w-session', source), id, 'changed');
  const next = (r, w) => nextStage(c, label, job, r, w, spec);
  assert.deepEqual(next([], []), { stage: 'r_start', id: 'r-session', source: label, prior: null });
  const r1 = rTurn(label, 'r1', 'W');
  assert.equal(next(r1, []).stage, 'w');
  assert.equal(next(r1, []).source, 'r1');
  const w1 = wTurn('r1', 'w1');
  assert.deepEqual([next(r1, w1).stage, next(r1, w1).source], ['r_pre_publication', 'w1']);
  const r2 = rTurn('w1', 'r2', 'W');
  assert.deepEqual([next([...r1, ...r2], w1).stage, next([...r1, ...r2], w1).source], ['w', 'r2']);
  const w2 = wTurn('r2', 'w2');
  const r3 = rTurn('w2', 'r3', 'PUBLISH');
  const published = next([...r1, ...r2, ...r3], [...w1, ...w2]);
  assert.deepEqual([published.state, published.stage, published.source], ['PUBLISH_PENDING', 'r_post_publication', 'r3']);
  const r4 = rTurn('r3', 'r4', 'TERMINAL');
  assert.deepEqual(next([...r1, ...r2, ...r3, ...r4], [...w1, ...w2]), { state: 'TERMINAL', final: 'r4' });
  const r4w = rTurn('r3', 'r4w', 'W');
  assert.equal(next([...r1, ...r2, ...r3, ...r4w], [...w1, ...w2]).stage, 'w');
  assert.deepEqual(next(rTurn(label, 'rp', 'P'), []), { state: 'RETURN_P', final: 'rp' });
  assert.throws(() => next([...r1, ...rTurn('w1', 'rt', 'TERMINAL')], w1), /invalid route/);
  assert.throws(() => next(rTurn(label, 'rs', 'PUBLISH'), []), /invalid route/);
  const badW = structuredClone(w1);
  badW[2].toolUseResult.persistedOutputPath = '/private/result';
  assert.throws(() => next(r1, badW), /w audit not clean/);
  assert.throws(() => next(safeTurn(keyFor(c, 'r-session', label), 'r0', 'no route'), []), /invalid route/);
});

test('declared-file snapshot stops on any path outside the declared files', async () => {
  const { snapshotOf, snapshotDigest, headerSnapshot } = await import('./dispatcher.mjs');
  const files = ['pkg/a.mjs', 'pkg/b.md'];
  const snap = snapshotOf('h', ' M pkg/a.mjs\n?? pkg/b.md\n', ['1', '2'], files);
  assert.deepEqual(snap, { head: 'h', files: { 'pkg/a.mjs': '1', 'pkg/b.md': '2' } });
  assert.deepEqual(snapshotOf('h', '', ['1', '2'], files).files, snap.files);
  for (const status of ['?? other.txt\n', 'R  pkg/a.mjs -> other.txt\n', '!! node_modules/\n'])
    assert.throws(() => snapshotOf('h', status, ['1', '2'], files), /STOP_WORKTREE_CHANGED/, status);
  assert.notEqual(snapshotDigest(snap), snapshotDigest(snapshotOf('h', '', ['1', '3'], files)));
  const digest = snapshotDigest(snap);
  const header = { type: 'user', message: { content: 'DISPATCH-KEY: k\nCONTRACT: job.example@v1 C=' +
    'a'.repeat(40) + ' STEP=w SOURCE=r1 SNAPSHOT=' + digest + '\nbody' } };
  assert.equal(headerSnapshot([header], 'k'), digest);
  assert.equal(headerSnapshot([], 'k'), null);
});

test('scoped launch records are well formed for version use', async () => {
  const { versionUse } = await import('./dispatcher.mjs');
  const c = 'a'.repeat(40), other = 'b'.repeat(40);
  const record = (commit, step) => ({ type: 'user', message: { content: 'DISPATCH-KEY: ' + 'f'.repeat(64) +
    '\nCONTRACT: job.example@v1 C=' + commit + ' STEP=' + step + ' SOURCE=r1 SNAPSHOT=' + 'e'.repeat(64) } });
  for (const step of ['r_start', 'w', 'r_pre_publication', 'r_post_publication']) {
    assert.equal(versionUse([[record(c, step)], []], 'job.example', 'v1', c), 'UNUSED_ELSEWHERE');
    assert.equal(versionUse([[record(other, step)], []], 'job.example', 'v1', c), 'STOP_VERSION_USED');
  }
  assert.equal(versionUse([[record(c, 'later')], []], 'job.example', 'v1', c), 'STOP_MALFORMED_RECORD');
});

test('CLI accepts --step next and still rejects unknown steps', async () => {
  const { argsOf } = await import('./dispatcher.mjs');
  const argv = ['--mode', 'launch', '--step', 'next', '--commit', 'a'.repeat(40),
    '--r-id', 'r-session', '--contract-id', 'job.example', '--version', 'v1'];
  assert.equal(argsOf(argv).step, 'next');
  assert.throws(() => argsOf(argv.with(3, 'later')), /usage/);
});
