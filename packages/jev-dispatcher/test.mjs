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

test('stage routing requires completed R approval and W result', async () => {
  const { stageRoute, keyFor } = await import('./dispatcher.mjs');
  const c = 'a'.repeat(40), src = 'b'.repeat(40);
  const rid = 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c';
  const wid = '71bd57d0-e795-4a5e-846c-999d3073afa7';
  const task = { id: 'pin-audit', refs: ['policy/organization.md', 'policy/README.md'] };
  const line = 'W-START: task=pin-audit refs=policy/organization.md,policy/README.md C=' + c;
  const turn = (key, id, text) => [
    { type: 'user', message: { content: 'DISPATCH-KEY: ' + key + '\nC=' + c } },
    { type: 'assistant', message: { id, model: 'claude-opus-5-5',
      stop_reason: 'end_turn', content: [{ type: 'text', text }] } },
  ];
  assert.deepEqual(stageRoute('r-start', c, src, task, [], []), { source: src, id: rid });
  assert.throws(() => stageRoute('w-work', c, src, task, [], []), /R start/);
  const r = turn(keyFor(c, rid, src), 'r-final', 'reason\n' + line);
  assert.deepEqual(stageRoute('w-work', c, src, task, r, []),
    { source: 'r-final', id: wid, previous: { line, r_record: 'r-final' } });
  assert.throws(() => stageRoute('r-review', c, src, task, r, []), /W work/);
  const w = turn(keyFor(c, wid, 'r-final'), 'w-final', 'evidence');
  assert.equal(stageRoute('r-review', c, src, task, r, w).source, 'w-final');
  assert.equal(stageRoute('r-review', c, src, task, r, w).id, rid);
  const decline = turn(keyFor(c, rid, src), 'r-decline', 'I decline');
  assert.deepEqual(stageRoute('w-work', c, src, task, decline, []), { declined: true });
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

test('dispatcher argv keeps five permissions as separate arguments', { skip: !existsSync(repo) }, async () => {
  const { buildArgv } = await import('./dispatcher.mjs');
  const templateCommit = 'c4ad8b9a5768bfea5103995e9ac3c5f1718ad965';
  const rid = 'b27e547c-14b7-47b9-a72e-7d5fdcdd724c';
  const result = select({ repo, commit: templateCommit, 'r-id': rid, 'git-bin': gitBin });
  const old = JSON.parse(result.selected.find((row) => row.id === 'policy.jev.d-replacement.oci.v1').body);
  const argv = buildArgv(old.target, templateCommit, rid, 'prompt');
  const start = argv.indexOf('--allowedTools') + 1;
  assert.deepEqual(argv.slice(start, start + 5),
    old.target.allowed_tools_template.map((item) => item.replaceAll('<C>', templateCommit)));
  assert.equal(argv[argv.indexOf('--resume') + 1], rid);
  assert.equal(argv.at(-1), 'prompt');
});

test('read checkout rejects another commit', async () => {
  const { verifyReadCheckout } = await import('./dispatcher.mjs');
  assert.throws(() => verifyReadCheckout('/work/repos/adrs-oci-policy-self-read',
    '0'.repeat(40), ['AGENTS.md']), /read checkout mismatch/);
});
