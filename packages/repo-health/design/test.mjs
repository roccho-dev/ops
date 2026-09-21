import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JEV_MODEL, parseJsonl } from '../lib/core.mjs';
import { askJev } from '../lib/jev.mjs';
import { lint, structural, RULES } from './lint.mjs';

const cases = parseJsonl(fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8'));
assert.equal(cases.length, 20);
const base = cases[0].design;
const alter = (fn) => { const d = structuredClone(base); fn(d); return d; };
const hardCases = [
  [null, 'INVALID_DESIGN'],
  [alter((d) => d.units.push(structuredClone(d.units[0]))), 'DUPLICATE_ID'],
  [alter((d) => d.units[0].input = ['missing']), 'MISSING_INPUT'],
  [alter((d) => d.result = ['missing']), 'MISSING_RESULT'],
  [alter((d) => d.units[0].input = ['result']), 'CYCLE'],
  [alter((d) => d.units.push({ ...d.units[0], id: 'extra', output: ['unused'] })), 'UNUSED_UNIT'],
  [alter((d) => d.units[0].output.push('unused')), 'UNUSED_OUTPUT'],
  [alter((d) => d.units.push({ ...d.units[0], id: 'extra' })), 'DUPLICATE_OUTPUT'],
  [alter((d) => d.units[0].input.push('request')), 'DUPLICATE_PORT'],
];
let calls = 0;
for (const [d, code] of hardCases) {
  assert.ok(structural(d).includes(code), code);
  await lint(d, ['purpose'], async () => { calls++; throw new Error('MUST_NOT_CALL'); });
}
assert.equal(calls, 0);
for (const row of cases) assert.equal(structural(row.design).length === 0, Boolean(row.rule), row.id);
await assert.rejects(() => lint(base, [], null), /INVALID_RULES/);
await assert.rejects(() => lint(base, ['invented'], null), /INVALID_RULES/);
await assert.rejects(() => lint(alter((d) => d.purpose = 'x'.repeat(40000)), ['purpose'], null), /budget exceeded/);
const questions = { q: { type: 'noul', instructions: 'Is the design sufficient?' } };
const payload = { model: JEV_MODEL, answers: { q: { type: 'noul', noul: 0.5 } } };
const options = { key: 'fixture-only', endpoint: 'https://example.invalid', timeoutMs: 1000 };
const mock = (body, ok = true) => ({ ...options, fetchImpl: async () => ({ ok, status: 503, json: async () => body }) });
for (const body of [{ ...payload, model: 'other' }, { ...payload, answers: {} }, { ...payload, answers: { q: { type: 'noul', noul: 2 } } }, { ...payload, answers: { q: { type: 'choice', noul: 1 } } }]) await assert.rejects(() => askJev(base, questions, mock(body)));
await assert.rejects(() => askJev(base, questions, mock(payload, false)), /JEV_HTTP_503/);
await assert.rejects(() => askJev(base, questions, { ...mock(payload), key: '' }), /KEY_REQUIRED/);
await assert.rejects(() => askJev(base, questions, { ...options, fetchImpl: async () => { throw new Error('network'); } }), /network/);
await assert.rejects(() => askJev(base, questions, { ...options, fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad'); } }) }), /INVALID_JEV_JSON/);
const mid = await lint(base, ['purpose'], async (state, qs) => {
  assert.deepEqual(state, base);
  assert.equal(Object.hasOwn(state, 'expected'), false);
  assert.equal(Object.hasOwn(state, 'rule'), false);
  return { answers: Object.fromEntries(Object.keys(qs).map((q) => [q, { type: 'noul', noul: 0.5 }])) };
});
assert.equal(mid.judgments[0].status, 'UNKNOWN');
assert.equal(mid.calls, 1);
assert.equal(Object.keys(RULES).length, 6);
console.log(JSON.stringify({ designContract: 'PASS', cases: cases.length, hardCounterexamples: hardCases.length, mechanicalJevCalls: calls, live: false }));
