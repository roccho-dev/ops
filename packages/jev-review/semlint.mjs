import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { evaluate } from './review.mjs';

const catalog = [
  ['Aligned', 'aligned.authority-grant', ['authorityContract'], 'The subject attributes authority unsupported by the declared accepted contract. Exact separately authorized consumer grants are legitimate.', []],
  ['Closed', 'closed.feedback-completion', ['completionContract'], 'Actor/work/reentry completion is claimed without required observations. Honest DELIVERED-only reporting is legitimate; unread references do not prove absence.', ['Measurable']],
  ['Unique', 'unique.canonical-responsibility', ['responsibilityContract'], 'A second incompatible canonical meaning or owner is introduced. Legitimate aliases, views, independent review and authorized delegation or updates are not duplication merely because they coexist.', []],
  ['Minimal', 'minimal.necessary-layer', ['requiredContracts', 'dependencyDescription'], 'Added structure is unnecessary under the required contracts. Removal must preserve scope, authority, failure/terminal protection and neighboring replaceability, including distinct judgment and admission responsibilities.', []],
  ['Measurable', 'measurable.attempt-accounting', ['accountingContract', 'registeredCases'], 'Failed, missing or invalid attempts disappear or receive semantic-success credit. Empty or unknown required coverage is not success; invalid evidence cannot erase an observed wrong decision.', []],
  ['Improving', 'improving.comparable-evidence', ['qualityContract', 'baselineEvidence'], 'Improvement lacks a comparable failure/cause/metric/regression/evidence chain. Explicit justified tradeoffs and identified multiple causes are legitimate.', []],
];
const axes = catalog.map((row) => row[0]);
const comparisonBridge = "Evaluate the caller's concern against the meaning selected by state.subject.scope within state.subject.content, not the headline or majority of other statements. Use supplied context relevant to this check's declared roles and concern as contracts, evidence or grants according to their declared meaning; role presence alone establishes no authority. Assess proposed declarations for consistency with supplied requirements without demanding execution evidence unless the concern requires it. Preserve stated exceptions, legitimate grants and authorized updates. Do not infer a violation from the concern's wording or its copy in state.checks. Other honest or compliant statements do not cancel a conflicting scoped claim. Caller concern (verbatim): ";
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = () => { throw new Error('INVALID_SEMLINT_INPUT'); };
const string = (x, nonempty = true) => typeof x === 'string' && x.isWellFormed() && (!nonempty || x.trim().length > 0);
const exact = (x, keys) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === keys.length && keys.every((k) => {
    const p = Object.getOwnPropertyDescriptor(x, k);
    return p && p.enumerable && Object.hasOwn(p, 'value');
  });
function copyRecord(x, keys) {
  if (!exact(x, keys)) fail();
  return Object.fromEntries(keys.map((k) => {
    const p = Object.getOwnPropertyDescriptor(x, k);
    if (!p || !p.enumerable || !Object.hasOwn(p, 'value')) fail();
    return [k, p.value];
  }));
}
function copyList(x) {
  const length = x && Object.getOwnPropertyDescriptor(x, 'length');
  if (!Array.isArray(x) || !length || !Object.hasOwn(length, 'value')
    || !Number.isSafeInteger(length.value) || length.value < 0
    || Reflect.ownKeys(x).length !== length.value + 1) fail();
  return Array.from({length: length.value}, (_, i) => {
    const p = Object.getOwnPropertyDescriptor(x, String(i));
    if (!p || !p.enumerable || !Object.hasOwn(p, 'value')) fail();
    return p.value;
  });
}
function record(x, keys) {
  if (!exact(x, keys) || !keys.every((k) => string(x[k], k !== 'content'))
    || !/^[a-f0-9]{64}$/.test(x.sha256) || hash(x.content) !== x.sha256) fail();
}
function snapshot(input) {
  const root = copyRecord(input, ['schema', 'subject', 'context', 'checks']);
  const version2 = root.schema === 'ops.semlint.input.v2';
  if (!version2 && root.schema !== 'ops.semlint.input.v1') fail();
  const state = {schema: root.schema,
    subject: copyRecord(root.subject, ['kind', 'ref', 'revision', 'scope', 'content', 'sha256']),
    context: copyList(root.context).map((x) => copyRecord(x, ['role', 'ref', 'revision', 'content', 'sha256'])),
    checks: copyList(root.checks).map((x) => {
      if (!version2) return x;
      const row = copyRecord(x, ['id', 'axis', 'concern', 'requiredRoles', 'crossLinks']);
      return {...row, requiredRoles: copyList(row.requiredRoles), crossLinks: copyList(row.crossLinks)};
    })};
  // Validate only this descriptor-value snapshot, never reread caller properties.
  record(state.subject, ['kind', 'ref', 'revision', 'scope', 'content', 'sha256']);
  if (!['ci-artifact', 'log-entry'].includes(state.subject.kind)) fail();
  const identities = new Set();
  for (const row of state.context) {
    record(row, ['role', 'ref', 'revision', 'content', 'sha256']);
    const id = JSON.stringify([row.role, row.ref, row.revision]);
    if (identities.has(id)) fail();
    identities.add(id);
  }
  if (version2) {
    if (!state.checks.every((row) => string(row.id) && axes.includes(row.axis) && string(row.concern)
      && row.requiredRoles.every((role) => string(role))
      && new Set(row.requiredRoles).size === row.requiredRoles.length
      && row.crossLinks.every((axis) => axes.includes(axis) && axis !== row.axis)
      && new Set(row.crossLinks).size === row.crossLinks.length)
      || new Set(state.checks.map((row) => row.id)).size !== state.checks.length) fail();
  } else if (!state.checks.every((id) => string(id) && catalog.some((row) => row[1] === id))
    || new Set(state.checks).size !== state.checks.length) fail();
  return state;
}
function freeze(x) {
  if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); }
  return x;
}
function errorCode(error, attempted) {
  let p;
  try { p = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : null; } catch { p = null; }
  const message = p && Object.hasOwn(p, 'value') && typeof p.value === 'string' ? p.value : '';
  if (['JEV_MODEL_MISMATCH', 'INVALID_JEV_ANSWERS', 'INVALID_JEV_JSON'].includes(message)) return ['EVIDENCE_INVALID', message];
  if (!attempted) return ['EXECUTION_ERROR', 'EVALUATION_PREFLIGHT_FAILED'];
  return ['EXECUTION_ERROR', 'EVALUATION_FAILED'];
}

export async function semlint(input, ask) {
  let state;
  try { state = freeze(snapshot(input)); } catch { fail(); }
  if (typeof ask !== 'function') fail();
  const version2 = state.schema === 'ops.semlint.input.v2';
  const rules = version2 ? state.checks.map((row) => [row.axis, row.id, row.requiredRoles, row.concern, row.crossLinks]) : catalog;
  const records = rules.map(([question, rule, roles, , crossLinks]) => {
    const selected = version2 || state.checks.includes(rule);
    const missingRoles = selected ? roles.filter((role) => !state.context.some((x) => x.role === role && x.content.trim())) : [];
    return { question, rule, subject: state.subject.ref,
      status: !selected ? 'NOT_SELECTED' : missingRoles.length ? 'INCOMPLETE' : 'OBSERVED',
      noul: null,
      contextRefs: selected ? state.context.filter((x) => roles.includes(x.role)).map(({role, ref, revision, sha256}) => ({role, ref, revision, sha256})) : [],
      missingRoles, crossLinks: [...crossLinks], cause: !selected ? 'NOT_SELECTED' : missingRoles.length ? 'REQUIRED_CONTEXT_MISSING' : null };
  });
  const items = records.filter((x) => x.status === 'OBSERVED').map((x) => ({
    theme: x.question, subject: [state.subject.kind, state.subject.ref, state.subject.revision, x.rule],
    concern: (version2 ? comparisonBridge : '') + rules.find((row) => row[1] === x.rule)[3] }));
  const themes = axes;
  const questionDigest = hash(JSON.stringify({themes, items}));
  let callbackAttempts = 0, validatedCalls = 0, usage = null;
  const start = performance.now();
  try {
    const result = await evaluate(state, {themes, items}, async (s, questions) => {
      callbackAttempts++;
      return ask(s, freeze(questions));
    });
    validatedCalls = result.calls;
    if (validatedCalls) {
      const values = Object.entries(result.usage).filter(([key]) => ['input_tokens', 'output_tokens', 'total_tokens'].includes(key));
      usage = values.length ? Object.fromEntries(values) : null;
    }
    for (const row of result.judgments) {
      if (!Number.isFinite(row.noul) || row.noul < 0 || row.noul > 1) throw new Error('INVALID_JEV_ANSWERS');
      const record = records.find((x) => x.rule === row.subject[3]);
      record.noul = row.noul;
    }
  } catch (error) {
    const [status, cause] = errorCode(error, callbackAttempts);
    validatedCalls = 0; usage = null;
    for (const row of records) if (row.status === 'OBSERVED') { row.status = status; row.noul = null; row.cause = cause; }
  }
  return { schema: version2 ? 'ops.semlint.result.v2' : 'ops.semlint.result.v1', inputDigest: hash(JSON.stringify(state)), questionDigest,
    records,
    counts: { selected: state.checks.length, sendable: items.length,
      evaluated: records.filter((x) => x.status === 'OBSERVED').length,
      missing: records.filter((x) => x.status === 'INCOMPLETE').length },
    accounting: { callbackAttempts, validatedCalls, usage, elapsedMs: performance.now() - start, providerHttpCalls: null, cost: null },
    claimCeiling: 'BOUNDED_EVIDENCE_NOT_SEMANTIC_TRUTH_OR_AUTHORITY' };
}
