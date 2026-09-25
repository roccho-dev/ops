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
