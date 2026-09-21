import { JEV_MODEL, validateJevBudget } from './core.mjs';

// Shared HTTP boundary. Never log credentials or untrusted response bodies.
export async function askJev(state, questions, { key, endpoint, timeoutMs, fetchImpl = fetch }) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('JEV_API_KEY_REQUIRED');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_TIMEOUT');
  validateJevBudget(state, questions);
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  });
  if (!response.ok) throw new Error(`JEV_HTTP_${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('INVALID_JEV_JSON'); }
  if (data?.model !== JEV_MODEL) throw new Error('JEV_MODEL_MISMATCH');
  const answers = data.answers;
  if (!answers || Array.isArray(answers) || typeof answers !== 'object'
    || JSON.stringify(Object.keys(answers).sort()) !== JSON.stringify(Object.keys(questions).sort())
    || Object.values(answers).some((a) => a?.type !== 'noul' || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1)) throw new Error('INVALID_JEV_ANSWERS');
  const usage = Object.fromEntries(Object.entries(data.usage ?? {}).filter(([, v]) => Number.isFinite(v) && v >= 0));
  return { model: data.model, answers, usage };
}
