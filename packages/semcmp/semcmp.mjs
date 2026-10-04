import { evaluate } from '../jev-review/review.mjs';
import { rankJudgments } from '../jev-review/rank.mjs';

const THEME = 'intent-fit';
const CONCERN = 'The proposal expresses a Decision intended by the supplied Input, State and Focus.';
const record = (x) => x !== null && typeof x === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => record(x) && Reflect.ownKeys(x).length === keys.length
  && keys.every((key) => Object.hasOwn(x, key));

// The first JS API accepts plain JSON data; this is not a shared wire schema.
function snapshot(value, code) {
  const seen = new Set();
  function visit(x) {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return;
    if (typeof x === 'number' && Number.isFinite(x)) return;
    if (typeof x !== 'object' || seen.has(x) || (!Array.isArray(x) && !record(x))) throw new Error(code);
    seen.add(x);
    const keys = Reflect.ownKeys(x);
    if (Array.isArray(x) && (keys.length !== x.length + 1
      || !Array.from({ length: x.length }, (_, i) => Object.hasOwn(x, i)).every(Boolean))) throw new Error(code);
    for (const key of keys) {
      if (Array.isArray(x) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(x, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(code);
      visit(descriptor.value);
    }
    seen.delete(x);
  }
  visit(value);
  return structuredClone(value);
}

export async function semcmp(query, { propose, ask } = {}) {
  if (!exact(query, ['input', 'state', 'focus'])) throw new Error('INVALID_QUERY');
  if (typeof propose !== 'function' || typeof ask !== 'function') throw new Error('INVALID_COMPOSITION');
  const base = snapshot(query, 'INVALID_QUERY');
  let supplied;
  try { supplied = await propose(snapshot(base, 'INVALID_QUERY')); }
  catch { throw new Error('PROPOSE_FAILED'); }
  const proposals = snapshot(supplied, 'INVALID_PROPOSALS');
  if (!Array.isArray(proposals) || proposals.some((p) => !exact(p, ['id', 'meaning', 'representation'])
    || typeof p.id !== 'string' || !p.id.trim()
    || typeof p.representation !== 'string' || !p.representation.trim())) throw new Error('INVALID_PROPOSALS');
  if (new Set(proposals.map((p) => p.id)).size !== proposals.length) throw new Error('DUPLICATE_PROPOSAL_ID');

  const items = proposals.map((p) => ({ theme: THEME, subject: ['proposal', p.id], concern: CONCERN }));
  const evaluation = await evaluate({ query: snapshot(base, 'INVALID_QUERY'), proposals: snapshot(proposals, 'INVALID_PROPOSALS') },
    { themes: [THEME], items }, (state, questions) => ask(snapshot(state, 'INVALID_QUERY'), snapshot(questions, 'INVALID_QUESTIONS')));
  const [ranked] = rankJudgments(evaluation.judgments, { topK: proposals.length, themes: [THEME], items });
  const byId = new Map(proposals.map((p) => [p.id, p]));
  return {
    query: base,
    proposals: ranked.findings.map(({ subject, noul }) => ({ ...byId.get(subject[1]), evidence: { theme: THEME, noul } })),
    evaluation,
  };
}
