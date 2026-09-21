import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { JEV_MODEL, parseJsonl, sha256 } from '../lib/core.mjs';
import { askJev } from '../lib/jev.mjs';
import { BUILTIN_THEMES, review, structural } from './lint.mjs';
import { validateCorpus, summarize } from './run.mjs';

const rows = parseJsonl(fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8'));
const base = rows[0].design, done = [];
const alter = (fn) => { const d = structuredClone(base); fn(d); return d; };
const reply = (questions, value = 0.5) => ({ model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: value }])) });
const mockAsk = async (_, questions) => reply(questions);
const never = async () => { throw new Error('MUST_NOT_CALL'); };
const check = async (id, fn) => { await fn(); done.push(id); };
const pairTheme = BUILTIN_THEMES.filter((t) => t.scope === 'pair');
const four = alter((d) => {
  d.units = ['a~b', 'c', 'a', 'b~c'].map((id, i) => ({ ...d.units[0], id, out: [`o${i}`] }));
  d.out = d.units.flatMap((u) => u.out);
});
const results = [];
for (const r of rows) {
  const entry = { id: r.id, expected: r.expected, theme: r.theme, designDigest: sha256(r.design) };
  if (!r.theme) Object.assign(entry, { calls: 0, hard: structural(r.design) });
  else Object.assign(entry, await review(r.design, { topK: 99, themes: BUILTIN_THEMES.filter((t) => t.id === r.theme) }, mockAsk));
  results.push(entry);
}
assert.equal(summarize(rows, results).comparedPairs, 8);
assert.equal(summarize(rows, results).pairwiseTies, 8); // Ranking quality is NOT an execution gate.

await check('D01', () => {
  const broken = structuredClone(rows);
  broken.filter((r) => r.expected === 'valid').slice(1).forEach((r) => r.id += '-unpaired');
  assert.throws(() => validateCorpus(broken), /INVALID_CORPUS/);
  assert.throws(() => summarize(rows, results.slice(1)), /INCOMPLETE_RESULTS/);
  assert.throws(() => summarize(rows, [...results.slice(1), results[1]]), /INCOMPLETE_RESULTS/);
});
await check('D02', () => {
  const broken = structuredClone(rows);
  broken.filter((r) => r.theme).forEach((r) => r.design.units[0].in = ['missing']);
  assert.throws(() => validateCorpus(broken), /INVALID_CORPUS/);
  const unmeasured = results.map((r) => r.theme ? { ...r, ranked: [], calls: 0 } : r);
  assert.throws(() => summarize(rows, unmeasured), /INCOMPLETE_RESULTS/);
  const absent = structuredClone(results); delete absent[0].ranked;
  assert.throws(() => summarize(rows, absent), /INCOMPLETE_RESULTS/);
});
await check('D03', async () => {
  const r = await review(four, { topK: 9, themes: pairTheme }, mockAsk);
  assert.equal(new Set(r.ranked[0].findings.map((f) => JSON.stringify(f.subject))).size, 6);
});
await check('D04', async () => {
  for (const d of [alter((d) => { d.expected = 'valid'; d.JEV_API_KEY = 'fake-secret'; }),
    alter((d) => d.units[0].unexpected = 'fake-secret'), alter((d) => d.in.toJSON = () => ['fake-secret']),
    alter((d) => delete d.units[0])]) {
    const r = await review(d, { topK: 1 }, never);
    assert.ok(r.hard.length); assert.equal(r.calls, 0);
  }
  await assert.rejects(() => review(base, { topK: 1, themes: [{ ...pairTheme[0], extra: 1 }] }, never), /INVALID_THEMES/);
});
await check('D05', async () => {
  const r = await review(base, { topK: 5, themes: BUILTIN_THEMES.filter((t) => ['edge', 'pair'].includes(t.scope)) }, never);
  assert.equal(r.calls, 0);
  assert.ok(r.ranked.every((g) => g.status === 'empty' && g.candidates === 0 && g.evaluated === 0 && g.returned === 0));
});
await check('D06', async () => {
  const r = await review(four, { topK: 0, themes: pairTheme }, never);
  assert.equal(r.calls, 0);
  assert.deepEqual([r.ranked[0].status, r.ranked[0].candidates, r.ranked[0].evaluated, r.ranked[0].returned], ['disabled', 6, 0, 0]);
});
await check('D07', async () => {
  let calls = 0;
  const r = await review(four, { topK: 1, themes: pairTheme }, async (_, questions) => {
    calls++; return { model: JEV_MODEL, answers: Object.fromEntries(Object.keys(questions).map((key, i) => [key, { type: 'noul', noul: i / 10 }])) };
  });
  assert.deepEqual([r.ranked[0].candidates, r.ranked[0].evaluated, r.ranked[0].returned], [6, 6, 1]);
  assert.equal(calls, 1); assert.equal(r.ranked[0].findings[0].noul, 0.5);
});
await check('D08', async () => {
  const d = alter((d) => {
    d.in = []; d.units = ['first', 'second'].map((id) => ({ ...d.units[0], id, in: [`missing-${id}`], out: [id] })); d.out = ['first', 'second'];
  });
  const r = await review(d, { topK: 2 }, never), missing = r.hard.filter((h) => h.code === 'MISSING_INPUT');
  assert.equal(missing.length, 2);
  assert.deepEqual(missing.map((h) => [h.subject, h.port]), [[['unit', 'first'], 'missing-first'], [['unit', 'second'], 'missing-second']]);
});
await check('D09', async () => {
  for (const change of [(r) => r.model = 'other', (r) => r.answers = {},
    (r) => r.answers.q0.type = 'choice', (r) => r.answers.q0.noul = 2,
    (r) => r.answers.extra = { type: 'noul', noul: 0 }, (r) => r.answers.q0.noul = NaN]) {
    await assert.rejects(() => review(base, { topK: 1, themes: [BUILTIN_THEMES[0]] }, async (_, qs) => { const r = reply(qs); change(r); return r; }));
  }
  const missing = structuredClone(results); missing[0].ranked[0].findings = [];
  assert.throws(() => summarize(rows, missing), /INCOMPLETE_RESULTS/);
});
await check('D10', async () => {
  const r = await review(base, { topK: 1 }, mockAsk);
  assert.deepEqual(r.hard, []); assert.equal(r.calls, 1);
});
await check('D11', async () => {
  const reverse = structuredClone(four); reverse.units.reverse();
  const a = await review(four, { topK: 6, themes: pairTheme }, mockAsk);
  const b = await review(reverse, { topK: 6, themes: pairTheme }, mockAsk);
  assert.deepEqual(a, b);
});
await check('D12', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-readme-'));
  try {
    const source = fs.readFileSync(new URL('README.md', import.meta.url), 'utf8').match(/```js\n([\s\S]*?)\n```/u)?.[1];
    assert.ok(source);
    fs.writeFileSync(path.join(dir, 'design.json'), JSON.stringify(base));
    const bootstrap = `globalThis.fetch = async (_, options) => { const body = JSON.parse(options.body); return { ok:true, json:async()=>({model:body.model, answers:Object.fromEntries(Object.keys(body.questions).map((key)=>[key,{type:'noul',noul:0.5}]))}) }; };\n`;
    fs.writeFileSync(path.join(dir, 'readme.mjs'), bootstrap + source);
    const child = spawnSync(process.execPath, ['readme.mjs'], { cwd: dir, encoding: 'utf8', env: { ...process.env,
      REPO_HEALTH_DIR: fileURLToPath(new URL('../', import.meta.url)), DESIGN_FILE: path.join(dir, 'design.json'), JEV_API_KEY: 'fixture-only' } });
    assert.equal(child.status, 0, child.stderr);
    const r = JSON.parse(child.stdout);
    assert.deepEqual(r.hard, []); assert.equal(r.calls, 1); assert.equal(r.ranked.length, 6);
    assert.ok(r.ranked.filter((g) => g.status === 'evaluated').every((g) => g.findings[0].noul === 0.5));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const hardCases = [
  [null, 'INVALID_DESIGN'], [alter((d) => d.units.push(structuredClone(d.units[0]))), 'DUPLICATE_ID'],
  [alter((d) => d.units[0].in = ['missing']), 'MISSING_INPUT'], [alter((d) => d.out = ['missing']), 'MISSING_RESULT'],
  [alter((d) => d.units[0].in = ['result']), 'CYCLE'],
  [alter((d) => d.units.push({ ...d.units[0], id: 'extra', out: ['unused'] })), 'UNUSED_UNIT'],
  [alter((d) => d.units[0].out.push('unused')), 'UNUSED_OUTPUT'],
  [alter((d) => d.units.push({ ...d.units[0], id: 'extra' })), 'DUPLICATE_OUTPUT'],
  [alter((d) => d.units[0].in.push('request')), 'DUPLICATE_PORT'], [alter((d) => d.in.push('unused')), 'UNUSED_INPUT'],
];
for (const [d, code] of hardCases) {
  const r = await review(d, { topK: 5 }, never);
  assert.ok(r.hard.some((h) => h.code === code)); assert.equal(r.calls, 0);
}
for (const topK of [undefined, -1, 0.2, NaN, '5']) await assert.rejects(() => review(base, { topK }, never), /INVALID_TOP_K/);
await assert.rejects(() => review(alter((d) => d.purpose = 'x'.repeat(40000)), { topK: 1 }, never), /budget exceeded/);
const questions = { q: { type: 'noul', instructions: 'Is there a concern?' } };
const options = { key: 'fixture-only', endpoint: 'https://example.invalid', timeoutMs: 1000 };
const mock = (body) => ({ ...options, fetchImpl: async () => ({ ok: true, json: async () => body }) });
assert.equal((await askJev(base, questions, mock(reply(questions)))).answers.q.noul, 0.5);
await assert.rejects(() => askJev(base, questions, { ...mock(reply(questions)), key: '' }), /KEY_REQUIRED/);
await assert.rejects(() => askJev(base, {}, { ...options, fetchImpl: never }), /EMPTY_JEV_QUESTIONS/);
await assert.rejects(() => askJev(base, questions, { ...options, fetchImpl: async () => ({ ok: false, status: 503 }) }), /JEV_HTTP_503/);
await assert.rejects(() => askJev(base, questions, { ...options, fetchImpl: async () => ({ ok: true, json: async () => { throw Error('bad'); } }) }), /INVALID_JEV_JSON/);
console.log(JSON.stringify({ designContract: 'PASS', regressionIds: done, hardCounterexamples: hardCases.length, cases: rows.length,
  semanticThresholds: 0, live: false, readme: 'executed with mock HTTP from a fresh directory' }));
