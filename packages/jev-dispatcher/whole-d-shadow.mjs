import { evaluate } from '../jev-review/review.mjs';
import { rankJudgments } from '../jev-review/rank.mjs';

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const kinds = new Set(['route', 'hold', 'refire', 'duplicate-suppression', 'effect-interpretation', 'return', 'escalation', 'terminal']);
const forbiddenTopLevel = ['expected', 'gold', 'existingDecision', 'referenceDecision', 'answer'];

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_WHOLE_D_INPUT');
  if (forbiddenTopLevel.some((key) => Object.hasOwn(input, key))) throw new Error('D_DECISION_LEAK');
  if (!text(input.policyRef) || !text(input.observationRef) || !input.state || typeof input.state !== 'object' || Array.isArray(input.state)) throw new Error('INVALID_WHOLE_D_INPUT');
  for (const key of ['generation', 'identity', 'refs', 'active', 'duplicates', 'effects', 'history']) if (!Object.hasOwn(input.state, key)) throw new Error('INVALID_WHOLE_D_INPUT');
  if (!Array.isArray(input.candidates) || input.candidates.length < 2 || !input.candidates.every((candidate) => candidate && text(candidate.id) && kinds.has(candidate.kind) && text(candidate.description))) throw new Error('INVALID_WHOLE_D_INPUT');
  if (new Set(input.candidates.map((x) => x.id)).size !== input.candidates.length) throw new Error('INVALID_WHOLE_D_INPUT');
  return input;
}

export async function reviewWholeDDecisionPlane(input, ask) {
  validateInput(input);
  const state = {
    policyRef: input.policyRef,
    observationRef: input.observationRef,
    observed: structuredClone(input.state),
    candidates: input.candidates.map(({ id, kind, description }) => ({ id, kind, description })),
  };
  const theme = 'whole-d-next-decision';
  const items = input.candidates.map((candidate) => ({
    theme,
    subject: ['candidate', candidate.id],
    concern: `This candidate is the correct next D decision for the externally observed state: ${candidate.kind} — ${candidate.description}`,
  }));
  const evaluated = await evaluate(state, { themes: [theme], items }, ask);
  return {
    schema: 'ops.wholeDShadow.v1',
    provider: 'jev',
    authority: false,
    effect: false,
    policyRef: input.policyRef,
    observationRef: input.observationRef,
    referenceIsGroundTruth: false,
    ranked: rankJudgments(evaluated.judgments, { topK: input.candidates.length, themes: [theme], items }),
    usage: evaluated.usage,
    claimCeiling: 'Shadow/replay decision evidence only; no dispatch, refire, suppression, effect authority, return, escalation, or terminal effect.',
  };
}
