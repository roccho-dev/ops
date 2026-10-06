import { JEV_MODEL, validateJevBudget } from './core.mjs';
import { bindJev } from '../jev/src/core.mjs';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

const invalid = () => { throw new Error('INVALID_JEV_ANSWERS'); };
const ownData = (value, keys) => {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) invalid();
  return Object.fromEntries(keys.map((key) => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid();
    return [key, d.value];
  }));
};

// One decoder shared by the pinned HTTP adapter and native Core judgments.
export function validateChoiceAnswer(answer) {
  const row = ownData(answer, ['type', 'choice', 'confidence', 'probabilities']);
  const probabilities = ownData(row.probabilities, ['outcomeA', 'outcomeB']);
  if (row.type !== 'choice' || !['outcomeA', 'outcomeB'].includes(row.choice)
    || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1
    || Object.values(probabilities).some((p) => !Number.isFinite(p) || p < 0 || p > 1)
    || Math.abs(probabilities.outcomeA + probabilities.outcomeB - 1) > 1e-6
    || probabilities[row.choice] !== Math.max(...Object.values(probabilities))) invalid();
  return {...row, probabilities};
}

export function validateJevResponse(data, questions) {
  if (Object.values(questions).some((q) => q.type === 'choice')) {
    const model = Object.getOwnPropertyDescriptor(data ?? {}, 'model');
    const envelope = Object.getOwnPropertyDescriptor(data ?? {}, 'answers');
    if (!model || !Object.hasOwn(model, 'value') || model.value !== JEV_MODEL) throw new Error('JEV_MODEL_MISMATCH');
    if (!envelope || !Object.hasOwn(envelope, 'value')) invalid();
    const captured = ownData(envelope.value, Object.keys(questions));
    const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      if (q.type === 'choice') return [id, validateChoiceAnswer(captured[id])];
      const a = ownData(captured[id], ['type', 'noul']);
      if (q.type !== 'noul' || a?.type !== 'noul' || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) invalid();
      return [id, a];
    }));
    const descriptor = Object.getOwnPropertyDescriptor(data, 'usage');
    if (descriptor && !Object.hasOwn(descriptor, 'value')) invalid();
    const usage = {};
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
      const d = Object.getOwnPropertyDescriptor(descriptor?.value ?? {}, key);
      if (d && !Object.hasOwn(d, 'value')) invalid();
      if (d && Number.isFinite(d.value) && d.value >= 0) usage[key] = d.value;
    }
    return {model: model.value, answers, usage};
  }
  if (data?.model !== JEV_MODEL) throw new Error('JEV_MODEL_MISMATCH');
  const answers = data.answers;
  if (!answers || Array.isArray(answers) || typeof answers !== 'object'
    || JSON.stringify(Object.keys(answers).sort()) !== JSON.stringify(Object.keys(questions).sort())
    || Object.values(answers).some((a) => a?.type !== 'noul' || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1)) {
    throw new Error('INVALID_JEV_ANSWERS');
  }
  const usage = Object.fromEntries(Object.entries(data.usage ?? {}).filter(([, value]) => Number.isFinite(value) && value >= 0));
  return { model: data.model, answers, usage };
}

// Bind once in the owner entry. Domain validation stays here; HTTP and the
// credential closure are supplied by the existing shared provider transport.
export function bindJevReview({ key, fetchImpl = fetch } = {}) {
  const provider = bindJev({ apiKey: key, fetch: (url, init) => fetchImpl(url, { ...init, redirect: 'error' }) });
  return async (state, questions, { timeoutMs }) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('JEV_API_KEY_REQUIRED');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_TIMEOUT');
    if (!questions || !Object.keys(questions).length) throw new Error('EMPTY_JEV_QUESTIONS');
    validateJevBudget(state, questions);
    let data;
    try { data = await provider.post({ model: JEV_MODEL, state, questions }, { deadlineMs: timeoutMs }); }
    catch (error) {
      if (error?.code === 'provider_http_error') throw new Error(`JEV_HTTP_${error.status}`);
      if (error?.code === 'provider_invalid_response') throw new Error('INVALID_JEV_JSON');
      if (error?.code === 'provider_timeout') throw new Error('JEV_PROVIDER_TIMEOUT');
      throw new Error('JEV_PROVIDER_FAILED');
    }
    return validateJevResponse(data, questions);
  };
}

// Preserve the legacy trusted caller's endpoint configuration. Issue input has
// no endpoint selector: the fixed owner calls bindJevReview directly instead.
export async function askJev(state, questions, { key, endpoint = ENDPOINT, timeoutMs, fetchImpl = fetch }) {
  return bindJevReview({ key, fetchImpl: (_url, init) => fetchImpl(endpoint, init) })
    (state, questions, { timeoutMs });
}
