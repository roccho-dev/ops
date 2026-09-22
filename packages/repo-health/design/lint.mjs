import { evaluate } from '../../jev-review/review.mjs';
import { rankJudgments } from '../../jev-review/rank.mjs';

export const BUILTIN_THEMES = Object.freeze([
  { id: 'purpose', scope: 'design', concern: 'The design may fail to achieve the stated purpose or may only achieve a weaker outcome.' },
  { id: 'responsibility', scope: 'unit', concern: 'The unit design may fail to fulfill its declared responsibility.' },
  { id: 'closure', scope: 'edge', concern: 'The producer output may not semantically satisfy what the consumer needs from this connection.' },
  { id: 'duplicate', scope: 'pair', concern: 'The units may independently own materially the same responsibility rather than intentionally sharing one dependency.' },
  { id: 'scope', scope: 'unit', concern: 'The unit may contain behavior unrelated to the stated purpose or explicit constraints.' },
  { id: 'acceptance', scope: 'design', concern: 'The acceptance conditions may allow the stated purpose to fail while still passing.' },
].map(Object.freeze));

const text = (x) => typeof x === 'string' && x.trim().length > 0;
const list = (x) => Array.isArray(x) && Reflect.ownKeys(x).length === x.length + 1
  && Array.from({ length: x.length }, (_, i) => Object.getOwnPropertyDescriptor(x, String(i))).every((p) => p && Object.hasOwn(p, 'value'));
const strings = (x) => list(x) && x.every(text);
const unique = (x) => new Set(x).size === x.length;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const keys = (x, names) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === names.length && names.every((k) => {
    const p = Object.getOwnPropertyDescriptor(x, k);
    return p && p.enumerable && Object.hasOwn(p, 'value');
  });

export function structural(d) {
  const hard = [], add = (code, subject, port = null) => hard.push({ code, subject, port });
  if (!keys(d, ['purpose', 'acceptance', 'constraints', 'in', 'out', 'units']) || !text(d.purpose)
    || !strings(d.acceptance) || !d.acceptance.length || !strings(d.constraints)
    || !strings(d.in) || !strings(d.out) || !d.out.length || !list(d.units) || !d.units.length) {
    add('INVALID_DESIGN', ['design']); return hard;
  }
  d.units.forEach((u, i) => {
    if (!keys(u, ['id', 'kind', 'responsibility', 'in', 'out', 'design'])
      || !['id', 'kind', 'responsibility', 'design'].every((k) => text(u[k]))
      || !strings(u.in) || !strings(u.out) || !u.out.length) add('INVALID_UNIT', ['units', i]);
  });
  if (hard.length) return hard;
  const ids = new Set(), providers = new Map();
  for (const u of d.units) {
    if (ids.has(u.id)) add('DUPLICATE_ID', ['unit', u.id]);
    ids.add(u.id);
    for (const port of u.out) {
      if (providers.has(port) || d.in.includes(port)) add('DUPLICATE_OUTPUT', ['unit', u.id], port);
      providers.set(port, u.id);
    }
  }
  for (const [subject, value] of [[['design'], d], ...d.units.map((u) => [['unit', u.id], u])]) {
    for (const field of ['in', 'out']) {
      const seen = new Set();
      for (const port of value[field]) { if (seen.has(port)) add('DUPLICATE_PORT', [...subject, field], port); seen.add(port); }
    }
  }
  if (hard.length) return hard;
  const consumed = new Set(d.units.flatMap((u) => u.in)), needed = new Set([...d.out, ...consumed]);
  for (const u of d.units) {
    for (const port of u.in) if (!providers.has(port) && !d.in.includes(port)) add('MISSING_INPUT', ['unit', u.id], port);
    for (const port of u.out) if (!needed.has(port)) add('UNUSED_OUTPUT', ['unit', u.id], port);
  }
  for (const port of d.out) if (!providers.has(port)) add('MISSING_RESULT', ['design'], port);
  for (const port of d.in) if (!consumed.has(port)) add('UNUSED_INPUT', ['design'], port);
  const deps = new Map(d.units.map((u) => [u.id, u.in.filter((p) => providers.has(p)).map((p) => providers.get(p))]));
  const seen = new Set(), visiting = new Set(), live = new Set();
  function visit(id) {
    if (visiting.has(id)) { add('CYCLE', ['unit', id]); return; }
    if (seen.has(id)) return;
    visiting.add(id); for (const dep of deps.get(id) ?? []) visit(dep); visiting.delete(id); seen.add(id);
  }
  function use(id) { if (id === undefined || live.has(id)) return; live.add(id); for (const dep of deps.get(id) ?? []) use(dep); }
  d.units.forEach((u) => visit(u.id));
  d.out.forEach((port) => use(providers.get(port)));
  for (const u of d.units) if (!live.has(u.id)) add('UNUSED_UNIT', ['unit', u.id]);
  return hard.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
}

// Shared by review and benchmark coverage checks; subjects are lossless tuples.
export function subjects(d, scope) {
  const units = [...d.units].sort((a, b) => compare(a.id, b.id));
  if (scope === 'design') return [['design']];
  if (scope === 'unit') return units.map((u) => ['unit', u.id]);
  if (scope === 'pair') return units.flatMap((u, i) => units.slice(i + 1).map((v) => ['pair', u.id, v.id]));
  if (scope === 'edge') {
    const providers = new Map(units.flatMap((u) => u.out.map((p) => [p, u.id])));
    return units.flatMap((u) => [...u.in].sort().filter((p) => providers.has(p)).map((p) => ['edge', providers.get(p), u.id, p]));
  }
  throw new Error('INVALID_THEME_SCOPE');
}

export async function review(design, options, ask) {
  if (!options || !keys(options, Object.hasOwn(options, 'themes') ? ['topK', 'themes'] : ['topK'])
    || !Number.isSafeInteger(options.topK) || options.topK < 0) throw new Error('INVALID_TOP_K');
  const { topK, themes = BUILTIN_THEMES } = options;
  if (!list(themes) || !themes.length || !unique(themes.map((t) => t?.id))
    || !Array.from(themes).every((t) => keys(t, ['id', 'scope', 'concern']) && text(t.id) && text(t.concern)
      && ['design', 'unit', 'edge', 'pair'].includes(t.scope))) throw new Error('INVALID_THEMES');
  const hard = structural(design);
  if (hard.length) return { hard, calls: 0, ranked: themes.map((t) => ({ theme: t.id, status: 'blocked', candidates: null, evaluated: 0, returned: 0, findings: [] })), usage: {} };
  const state = JSON.parse(JSON.stringify(design));
  state.units.sort((a, b) => compare(a.id, b.id));
  const themeIds = themes.map((theme) => theme.id);
  const items = themes.flatMap((theme) => subjects(state, theme.scope).map((subject) => ({ theme: theme.id, subject, concern: theme.concern })));
  if (topK === 0) return { hard, calls: 0, ranked: rankJudgments([], { topK, themes: themeIds, items }), usage: {} };
  const result = await evaluate(state, { themes: themeIds, items }, ask);
  return { hard, calls: result.calls, ranked: rankJudgments(result.judgments, { topK, themes: themeIds, items }), usage: result.usage };
}
