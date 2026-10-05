import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { JEV_MODEL } from './core.mjs';
import { askJev } from './jev.mjs';
import { semlint } from './semlint.mjs';

export const ENTRY_LIMITS = Object.freeze({ maxCases: 24, maxCalls: 24, maxInputBytes: 1048576, timeoutMs: 15000, deadlineMs: 60000 });
export const digest = (x) => createHash('sha256').update(JSON.stringify(x), 'utf8').digest('hex');
const fail = (code) => { throw new Error(code); };
export const exact = (x, keys) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === keys.length && keys.every((key) => {
    const p = Object.getOwnPropertyDescriptor(x, key);
    return p && p.enumerable && Object.hasOwn(p, 'value');
  });
const freeze = (x) => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };

// Descriptor reads reject getters/toJSON, sparse arrays, cycles and non-JSON values before serialization.
export function snapshotJson(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.isWellFormed()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('INVALID_ENTRY_INPUT');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    const n = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(n) || n < 0 || Reflect.ownKeys(value).length !== n + 1) fail('INVALID_ENTRY_INPUT');
    result = Array.from({ length: n }, (_, i) => {
      const p = Object.getOwnPropertyDescriptor(value, String(i));
      if (!p?.enumerable || !Object.hasOwn(p, 'value')) fail('INVALID_ENTRY_INPUT');
      return snapshotJson(p.value, seen);
    });
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_ENTRY_INPUT');
    result = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const p = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !key.isWellFormed() || !p?.enumerable || !Object.hasOwn(p, 'value')) fail('INVALID_ENTRY_INPUT');
      result[key] = snapshotJson(p.value, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function entryLimits(value = ENTRY_LIMITS) {
  const limits = snapshotJson(value);
  if (!exact(limits, Object.keys(ENTRY_LIMITS)) || Object.entries(limits).some(([k, v]) => !Number.isSafeInteger(v) || v < 1 || v > ENTRY_LIMITS[k])) fail('INVALID_ENTRY_LIMITS');
  // Canonical key order, so equal effective limits always produce the same plan digest.
  return freeze(Object.fromEntries(Object.keys(ENTRY_LIMITS).map((k) => [k, limits[k]])));
}
const structural = (limits) => Object.keys(ENTRY_LIMITS).every((k) => limits[k] === ENTRY_LIMITS[k]);

const admitted = new WeakSet();
// limitValue is the caller's ceiling. An owner input may carry its own `limits`, which may only
// reduce that ceiling. Effective non-structural limits are always embedded in the canonical plan,
// so the fixed owner entry receives them on stdin and planDigest binds all five values.
export async function preparePlan(value, limitValue = ENTRY_LIMITS) {
  const ceiling = entryLimits(limitValue);
  const input = snapshotJson(value);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > ceiling.maxInputBytes) fail('ENTRY_INPUT_TOO_LARGE');
  const embedded = input && Object.hasOwn(input, 'limits');
  if (!exact(input, embedded ? ['schema', 'cases', 'limits'] : ['schema', 'cases'])) fail('INVALID_ENTRY_PLAN');
  const limits = embedded ? entryLimits(input.limits) : ceiling;
  if (Object.keys(ENTRY_LIMITS).some((k) => limits[k] > ceiling[k])) fail('INVALID_ENTRY_LIMITS');
  const plan = structural(limits) ? { schema: input.schema, cases: input.cases } : { schema: input.schema, cases: input.cases, limits: { ...limits } };
  if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > limits.maxInputBytes) fail('ENTRY_INPUT_TOO_LARGE');
  if (plan.schema !== 'ops.semlint.real-input.v1'
    || !Array.isArray(plan.cases) || !plan.cases.length || plan.cases.length > limits.maxCases) fail('INVALID_ENTRY_PLAN');
  const ids = new Set(), expected = [];
  for (const row of plan.cases) {
    if (!exact(row, ['id', 'input']) || typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(row.id) || ids.has(row.id)) fail('INVALID_ENTRY_CASE');
    ids.add(row.id);
    let preflight;
    try {
      preflight = await semlint(row.input, async (_, questions) => ({ model: JEV_MODEL,
        answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])) }));
    } catch { fail('INVALID_ENTRY_SEMLINT'); }
    if (preflight.records.some((x) => x.status === 'EXECUTION_ERROR' || x.status === 'EVIDENCE_INVALID')) fail('ENTRY_PREFLIGHT_FAILED');
    // Synthetic values, usage, elapsed time and callback counts are NOT execution evidence.
    expected.push({ id: row.id, inputDigest: preflight.inputDigest, questionDigest: preflight.questionDigest,
      sendable: preflight.counts.sendable, records: preflight.records.map(({ noul, ...record }) => record) });
  }
  const plannedCalls = expected.filter((x) => x.sendable > 0).length;
  if (plannedCalls > limits.maxCalls) fail('ENTRY_CALL_BUDGET_EXCEEDED');
  const prepared = freeze({ plan, planDigest: digest(plan), expected, plannedCalls, limits });
  admitted.add(prepared);
  return prepared;
}

export async function runPlan(prepared, ask, { now = () => performance.now() } = {}) {
  if (!admitted.has(prepared) || typeof ask !== 'function' || typeof now !== 'function') fail('ENTRY_NOT_ADMITTED');
  const start = now(), cases = [];
  let callbackAttempts = 0;
  for (const row of prepared.plan.cases) {
    const result = await semlint(row.input, async (state, questions) => {
      const remaining = prepared.limits.deadlineMs - (now() - start);
      if (remaining <= 0) fail('ENTRY_DEADLINE_EXCEEDED');
      if (callbackAttempts >= prepared.limits.maxCalls) fail('ENTRY_CALL_BUDGET_EXCEEDED');
      callbackAttempts++;
      // ask owns the bounded provider operation; this module never retries it.
      return ask(state, questions, { caseId: row.id, timeoutMs: Math.max(1, Math.floor(Math.min(remaining, prepared.limits.timeoutMs))) });
    });
    cases.push({ id: row.id, result, provider: null });
  }
  return { schema: 'ops.semlint.real-result.v2', model: JEV_MODEL, planDigest: prepared.planDigest, cases,
    accounting: { callbackAttempts, validatedCalls: cases.reduce((n, x) => n + x.result.accounting.validatedCalls, 0),
      providerHttpCalls: null, completedHttpCalls: null, validatedResponses: null, unknownHttpCalls: null,
      cost: null }, claimCeiling: 'BOUNDED_EVIDENCE_NOT_SEMANTIC_TRUTH_OR_AUTHORITY' };
}

export async function executeOwnerPlan(prepared, key, fetchImpl = fetch) {
  if (!admitted.has(prepared) || typeof fetchImpl !== 'function') fail('ENTRY_NOT_ADMITTED');
  const providers = new Map(prepared.plan.cases.map(({ id }) => [id, {
    attemptedHttpCalls: 0, completedHttpCalls: 0, validatedResponses: 0, statusClass: 'NOT_RUN',
    validatedModel: null, usage: null, elapsedMs: 0, responseDigest: null,
  }]));
  let nativeAttempts = 0;
  const output = await runPlan(prepared, async (state, questions, { caseId, timeoutMs }) => {
    const provider = providers.get(caseId), start = performance.now();
    try {
      // Observe the existing client at the native fetch boundary, not at its callback wrapper.
      const observedFetch = async (url, init) => {
        if (url !== 'https://api.typesafe.ai/v1/systemone' || init.method !== 'POST' || init.redirect !== 'error'
          || !(init.signal instanceof AbortSignal) || nativeAttempts >= prepared.limits.maxCalls) fail('ENTRY_REQUEST_REFUSED');
        init.signal.throwIfAborted();
        nativeAttempts++; provider.attemptedHttpCalls++; provider.statusClass = 'REQUEST_ERROR';
        const response = await fetchImpl(url, init);
        provider.completedHttpCalls++; provider.statusClass = 'HTTP_' + Math.floor(response.status / 100) + 'XX';
        if (!response.ok) return response;
        // Same response/body/signal, consumed once. No clone, independent timer or retry.
        const bytes = Buffer.from(await response.arrayBuffer());
        init.signal.throwIfAborted();
        provider.responseDigest = createHash('sha256').update(bytes).digest('hex');
        return { ok: response.ok, status: response.status, json: async () => JSON.parse(bytes.toString('utf8')) };
      };
      const answer = await askJev(state, questions, {
        key, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs, fetchImpl: observedFetch,
      });
      provider.validatedResponses = 1; provider.validatedModel = JEV_MODEL; provider.statusClass = 'VALIDATED_RESPONSE';
      const usage = Object.entries(answer.usage).filter(([name]) => ['input_tokens', 'output_tokens', 'total_tokens'].includes(name));
      provider.usage = usage.length ? Object.fromEntries(usage) : null;
      return answer;
    } finally { provider.elapsedMs = performance.now() - start; }
  });
  for (const row of output.cases) row.provider = providers.get(row.id);
  output.accounting.providerHttpCalls = nativeAttempts;
  output.accounting.completedHttpCalls = output.cases.reduce((n, x) => n + x.provider.completedHttpCalls, 0);
  output.accounting.validatedResponses = output.cases.reduce((n, x) => n + x.provider.validatedResponses, 0);
  // Request throw/timeout does not prove that the remote service performed zero work.
  output.accounting.unknownHttpCalls = nativeAttempts - output.accounting.completedHttpCalls;
  return output;
}

// Shared fixed-program stdin handler. It does not interpret argv or choose executable code.
export async function ownerMain() {
  let bytes = 0, chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > ENTRY_LIMITS.maxInputBytes) fail('ENTRY_INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('INVALID_ENTRY_JSON'); }
  const prepared = await preparePlan(input);
  // Only the already-authorized target owner may inject this environment; consumers never read it.
  const result = await executeOwnerPlan(prepared, process.env.JEV_API_KEY);
  process.stdout.write(JSON.stringify(result) + '\n');
}

export function entryError(error) {
    const allowed = ['INVALID_ENTRY_ARGS', 'ENTRY_INPUT_TOO_LARGE', 'INVALID_ENTRY_JSON', 'INVALID_ENTRY_PLAN', 'INVALID_ENTRY_LIMITS',
      'INVALID_ENTRY_CASE', 'INVALID_ENTRY_SEMLINT', 'ENTRY_PREFLIGHT_FAILED', 'ENTRY_CALL_BUDGET_EXCEEDED'];
    process.stdout.write(JSON.stringify({ schema: 'ops.semlint.entry-error.v1', status: 'REJECTED',
      cause: allowed.includes(error?.message) ? error.message : 'ENTRY_FAILED', authority: false }) + '\n');
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    if (process.argv.length !== 2) fail('INVALID_ENTRY_ARGS');
    await ownerMain();
  })().catch(entryError);
}
