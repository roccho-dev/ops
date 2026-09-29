const exactSha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const unique = (values) => new Set(values).size === values.length;

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_RELEVANCE_INPUT');
  if (!exactSha(input.baseSha) || !exactSha(input.headSha) || !Array.isArray(input.changedPaths) || !input.changedPaths.every(text)) throw new Error('INVALID_RELEVANCE_INPUT');
  if (!Array.isArray(input.candidates) || !input.candidates.length || !input.candidates.every((x) => x && text(x.name) && text(x.script)) || !unique(input.candidates.map((x) => x.name))) throw new Error('INVALID_RELEVANCE_INPUT');
  if (!Number.isSafeInteger(input.topK) || input.topK < 1 || input.topK > input.candidates.length) throw new Error('INVALID_RELEVANCE_INPUT');
  return input;
}

function validateProvider(data, questions) {
  const answers = data?.answers;
  if (!answers || Array.isArray(answers) || typeof answers !== 'object') throw new Error('INVALID_WINNOW_RESPONSE');
  if (JSON.stringify(Object.keys(answers).sort()) !== JSON.stringify(Object.keys(questions).sort())) throw new Error('INVALID_WINNOW_RESPONSE');
  for (const answer of Object.values(answers)) {
    if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error('INVALID_WINNOW_RESPONSE');
  }
  return data;
}

export async function runWinnowRelevance(input, {
  endpoint = 'http://127.0.0.1:11435/v1/systemone',
  model = 'ollaya.dev/library/winnow:e4b',
  timeoutMs = 120000,
  fetchImpl = fetch,
} = {}) {
  validateInput(input);
  if (!text(endpoint) || !text(model) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_WINNOW_CONFIG');
  const state = {
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedPaths: [...input.changedPaths].sort(),
    candidates: input.candidates.map(({ name, script }) => ({ name, script })),
  };
  const questions = Object.fromEntries(input.candidates.map((candidate, index) => [`q${index}`, {
    type: 'noul',
    instructions: `How likely is CI/test check ${JSON.stringify(candidate.name)} relevant to validating this exact change?`,
    criteria: {
      true: 'Running this check is materially relevant to validating the declared change.',
      false: 'Running this check is not materially relevant to validating the declared change.',
    },
  }]));
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, state, questions }),
  });
  if (!response.ok) throw new Error(`WINNOW_HTTP_${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('INVALID_WINNOW_JSON'); }
  validateProvider(data, questions);
  const ranked = input.candidates.map((candidate, index) => ({
    name: candidate.name,
    noul: data.answers[`q${index}`].noul,
  })).sort((a, b) => b.noul - a.noul || a.name.localeCompare(b.name));
  return {
    schema: 'ops.winnowCiRelevanceShadow.v1',
    provider: 'winnow',
    requestedModel: model,
    observedModel: String(data.model ?? ''),
    authority: false,
    effect: false,
    referenceIsGroundTruth: false,
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedPaths: [...input.changedPaths].sort(),
    candidates: input.candidates.map((x) => x.name),
    topK: input.topK,
    wouldSelect: ranked.slice(0, input.topK).map((x) => x.name),
    ranked,
    usage: data.usage ?? {},
  };
}

export function joinFullCiReference(shadow, reference) {
  if (!shadow || shadow.schema !== 'ops.winnowCiRelevanceShadow.v1' || shadow.authority !== false || shadow.effect !== false) throw new Error('INVALID_SHADOW_EVIDENCE');
  if (!reference || reference.headSha !== shadow.headSha || !Array.isArray(reference.checks)) throw new Error('REFERENCE_MISMATCH');
  const byName = new Map(reference.checks.map((row) => [row?.name, row]));
  if (byName.size !== reference.checks.length || shadow.candidates.some((name) => !byName.has(name))) throw new Error('INCOMPLETE_FULL_CI_REFERENCE');
  const selected = new Set(shadow.wouldSelect);
  const failed = reference.checks.filter((row) => ['failure', 'timed_out', 'cancelled'].includes(row.conclusion));
  const durations = reference.checks.map((row) => Number(row.durationMs)).filter((x) => Number.isFinite(x) && x >= 0);
  return {
    schema: 'ops.winnowCiRelevanceJoin.v1',
    headSha: shadow.headSha,
    authority: false,
    effect: false,
    referenceKind: 'full-ci',
    referenceIsGroundTruth: false,
    selectedCount: selected.size,
    candidateCount: shadow.candidates.length,
    observedSelectedFailures: failed.filter((row) => selected.has(row.name)).map((row) => row.name).sort(),
    observedOmittedFailures: failed.filter((row) => !selected.has(row.name)).map((row) => row.name).sort(),
    fullCiObservedFailures: failed.map((row) => row.name).sort(),
    fullCiMeasuredDurationMs: durations.reduce((sum, value) => sum + value, 0),
    claimCeiling: 'Observed pairing only; not semantic correctness, FP/FN, safety, or skip authority.',
  };
}
