#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ownFile = fileURLToPath(import.meta.url);
const fail = (message) => { throw new Error(message); };

function argsOf(argv) {
  const out = { authority: Object.create(null) };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || !value) fail('usage: policy-select --repo PATH --commit SHA --r-id ID [--authority NAME=PATH]');
    if (key === '--authority') {
      const split = value.indexOf('=');
      if (split < 1) fail('bad authority mapping');
      if (Object.hasOwn(out.authority, value.slice(0, split))) fail('duplicate authority mapping');
      out.authority[value.slice(0, split)] = value.slice(split + 1);
    } else if (['--repo', '--commit', '--r-id', '--format', '--git-bin'].includes(key)) {
      if (out[key.slice(2)]) fail('duplicate argument: ' + key);
      out[key.slice(2)] = value;
    } else fail('unknown argument: ' + key);
  }
  if (!out.repo || !out.commit || !out['r-id']) fail('repo, commit and r-id are required');
  if (out.format && !['compact', 'selected'].includes(out.format)) fail('format must be compact or selected');
  if (!out['git-bin'] || !out['git-bin'].startsWith('/')) fail('absolute git-bin is required');
  if (!/^[0-9a-f]{40}$/.test(out.commit)) fail('commit must be a full SHA-1 object id');
  return out;
}

function git(bin, repo, ...argv) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  const p = spawnSync(bin, ['--no-replace-objects', '-C', repo, ...argv], {
    encoding: null, maxBuffer: 16 * 1024 * 1024, env,
  });
  if (p.error || p.status !== 0) fail('Git exact-object read failed: ' + argv[0]);
  return p.stdout;
}

export function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      path.includes('\\') || path.includes('\0')) fail('unsafe requires path');
  return path;
}

function exactBlob(bin, repo, commit, path) {
  safePath(path);
  const oid = git(bin, repo, 'rev-parse', commit + ':' + path).toString('utf8').trim();
  if (git(bin, repo, 'cat-file', '-t', oid).toString('utf8').trim() !== 'blob') fail('requires a blob: ' + path);
  const bytes = git(bin, repo, 'cat-file', 'blob', oid);
  const gitHash = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (gitHash !== oid) fail('blob bytes do not match oid: ' + path);
  return { path, oid, sha256: hash(bytes), text: bytes.toString('utf8') };
}

export function numberedLines(text) {
  return text.split(/\r?\n/).map((body, index) => ({ lineNo: index + 1, body })).filter(({ body }) => body.trim());
}

export function validateRows(lines) {
  const rows = new Map();
  for (const { lineNo, body } of lines) {
    let row;
    try { row = JSON.parse(body); } catch { fail('invalid JSON at line ' + lineNo); }
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        typeof row.id !== 'string' || !row.id || rows.has(row.id)) fail('invalid or duplicate id at line ' + lineNo);
    if ('parent' in row || (row.rel && 'child' in row.rel)) fail('legacy parent field at line ' + lineNo);
    if (!['active', 'inactive'].includes(row.state)) fail('invalid state at line ' + lineNo);
    rows.set(row.id, row);
  }
  const roots = [...rows.values()].filter((row) => row.state === 'active' && row.op === 'document');
  if (roots.length !== 1 || roots[0].rel !== null || roots[0].schema !== 3) fail('active schema-3 root must be unique');
  const root = roots[0];
  for (const row of rows.values()) {
    if (row === root) continue;
    if (!row.rel || typeof row.rel !== 'object' || Array.isArray(row.rel) ||
        typeof row.rel.parent !== 'string' || typeof row.rel.kind !== 'string' ||
        !rows.has(row.rel.parent) || row.rel.parent === row.id) fail('invalid relation: ' + row.id);
    if (row.state === 'active' && rows.get(row.rel.parent).state !== 'active') fail('inactive parent: ' + row.id);
    const seen = new Set();
    let current = row;
    while (current !== root) {
      if (seen.has(current.id)) fail('cycle: ' + row.id);
      seen.add(current.id);
      if (!current.rel || !rows.has(current.rel.parent)) fail('orphan: ' + row.id);
      current = rows.get(current.rel.parent);
    }
  }
  for (const row of rows.values()) {
    if (row.state === 'active' && row.rel?.kind === 'details' &&
        [...rows.values()].some((child) => child.rel?.parent === row.id)) fail('details must be leaf: ' + row.id);
  }
  return rows;
}

export function select({ repo, commit, 'r-id': rid, authority = {}, 'git-bin': gitBin }) {
  if (git(gitBin, repo, 'cat-file', '-t', commit).toString('utf8').trim() !== 'commit') fail('not a commit');
  const tree = git(gitBin, repo, 'rev-parse', commit + '^{tree}').toString('utf8').trim();
  const agents = exactBlob(gitBin, repo, commit, 'AGENTS.md');
  const control = exactBlob(gitBin, repo, commit, 'policy/control.jsonl');
  const blocks = [...agents.text.matchAll(/\x60\x60\x60sql\s*\n([\s\S]*?)\n\x60\x60\x60/g)];
  if (blocks.length !== 1) fail('expected one AGENTS SQL block');
  const sql = blocks[0][1];
  const lines = numberedLines(control.text);
  const rows = validateRows(lines);
  const target = rows.get(rid);
  if (!target || target.state !== 'active') fail('R anchor missing or inactive');
  const root = [...rows.values()].find((row) => row.state === 'active' && row.op === 'document');
  const parent = rows.get(target.rel?.parent);
  const grand = rows.get(parent?.rel?.parent);
  const review = target.rel?.kind === 'reviews' && parent?.id === root.id;
  const delegated = target.rel?.kind === 'delegates' && parent?.rel?.kind === 'delegates' && grand?.id === root.id;
  const anchorCount = Number(review || delegated);
  if (anchorCount !== 1) fail('R anchor at wrong relation/depth');

  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE raw(line_no INTEGER PRIMARY KEY, body TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO raw VALUES (?, ?)');
    lines.forEach(({ lineNo, body }) => insert.run(lineNo, body));
    const lastSelect = /SELECT\s+line_no\s*,\s*body\s+FROM\s+chosen\s+ORDER\s+BY\s+line_no\s*;?\s*$/i;
    if (!lastSelect.test(sql)) fail('AGENTS SQL terminal SELECT changed');
    const sqlAnchorCount = db.prepare(sql.replace(lastSelect, 'SELECT count(*) AS n FROM anchor;')).get({ r_id: rid }).n;
    if (sqlAnchorCount !== 1 || sqlAnchorCount !== anchorCount) fail('SQL anchor count differs');
    const chosen = db.prepare(sql).all({ r_id: rid });
    if (!chosen.length || chosen.filter((item) => JSON.parse(item.body).id === rid).length !== 1) fail('anchor or chosen cardinality');
    const selected = chosen.map((item) => ({
      line_no: item.line_no,
      id: JSON.parse(item.body).id,
      body_sha256: hash(item.body),
      body: item.body,
    }));
    const requires = (target.requires || []).map((ref) => {
      if (typeof ref === 'string') return exactBlob(gitBin, repo, commit, ref);
      if (!ref || typeof ref !== 'object' || typeof ref.authority !== 'string' ||
          !/^[0-9a-f]{40}$/.test(ref.commit) || !authority[ref.authority]) fail('unresolved requires authority');
      if (git(gitBin, authority[ref.authority], 'cat-file', '-t', ref.commit).toString('utf8').trim() !== 'commit') fail('requires object is not a commit');
      return { authority: ref.authority, commit: ref.commit,
        ...exactBlob(gitBin, authority[ref.authority], ref.commit, ref.path) };
    });
    return {
      commit, tree, r_id: rid, git_bin: gitBin, row_count: lines.length,
      active_count: [...rows.values()].filter((row) => row.state === 'active').length,
      anchor_count: sqlAnchorCount,
      runtime: { node: process.version, sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, script_sha256: hash(readFileSync(ownFile)) },
      agents: { oid: agents.oid, sha256: agents.sha256 },
      control: { oid: control.oid, sha256: control.sha256 },
      sql_sha256: hash(sql), selected, requires,
    };
  } finally { db.close(); }
}

if (process.argv[1] && realpathSync(ownFile) === realpathSync(process.argv[1])) {
  try {
    const args = argsOf(process.argv.slice(2));
    const result = select(args);
    result.selected = result.selected.map(({ line_no, id, body_sha256, body }) =>
      args.format === 'selected' ? { line_no, id, body_sha256, body: JSON.parse(body) } :
      { line_no, id, body_sha256 });
    result.requires = result.requires.map(({ authority, commit, path, oid, sha256 }) =>
      ({ authority, commit, path, oid, sha256 }));
    process.stdout.write(JSON.stringify(result, null, args.format === 'selected' ? 2 : undefined) + '\n');
  } catch (error) {
    process.stderr.write(String(error.message) + '\n');
    process.exitCode = 1;
  }
}
