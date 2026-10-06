import { JEV_MODEL, validateJevBudget } from './core.mjs';
import { bindJev } from '../jev/src/core.mjs';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export function validateJevResponse(data, questions) {
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

// Legacy call signature, not another HTTP client or arbitrary provider selector.
export async function askJev(state, questions, { key, endpoint = ENDPOINT, timeoutMs, fetchImpl = fetch }) {
  if (endpoint !== ENDPOINT) throw new Error('INVALID_JEV_ENDPOINT');
  return bindJevReview({ key, fetchImpl })(state, questions, { timeoutMs });
}
