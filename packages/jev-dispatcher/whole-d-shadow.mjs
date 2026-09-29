import { createHash } from 'node:crypto';
import { evaluate } from '../jev-review/review.mjs';
import { rankJudgments } from '../jev-review/rank.mjs';
import { JEV_MODEL } from '../jev-review/core.mjs';

export const decisionKinds = Object.freeze(['route', 'hold', 'refire', 'duplicate-suppression', 'effect-interpretation', 'return', 'escalation', 'terminal']);
export const ambiguity = Object.freeze({ minScore: 0.75, minGap: 0.1 });
export const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const text = (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 2048;
const integer = (x) => Number.isSafeInteger(x) && x >= 0;
const sha = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const fail = (reason) => { throw new Error(reason); };
const exact = (x, keys) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === keys.length && keys.every((key) => {
    const p = Object.getOwnPropertyDescriptor(x, key);
    return p && p.enumerable && Object.hasOwn(p, 'value');
  });
const list = (x) => Array.isArray(x) && x.length <= 128 && Reflect.ownKeys(x).length === x.length + 1
  && Array.from({ length: x.length }, (_, i) => Object.getOwnPropertyDescriptor(x, String(i))).every((p) => p && p.enumerable && Object.hasOwn(p, 'value'));
const identity = (x) => exact(x, ['actor', 'thread']) && text(x.actor) && text(x.thread);
const turn = (x) => exact(x, ['actor', 'thread', 'generation']) && text(x.actor) && text(x.thread) && integer(x.generation);
const events = new Set(['requested', 'started', 'stopped', 'effect-reported', 'readback-observed', 'work-finished', 'review-finished']);

// Closed observation schema: no prose/history summaries or comparator decisions.
// Identity aliases preserve equality while preventing answer text in IDs/refs.
export function projectWholeDInput(input) {
  if (!exact(input, ['policy', 'observation'])) fail('INVALID_WHOLE_D_INPUT');
  const { policy, observation } = input;
  if (!exact(policy, ['ref', 'sha256', 'content']) || !text(policy.ref)
    || typeof policy.content !== 'string' || !policy.content.trim() || policy.content.length > 20000
    || policy.sha256 !== sha256(policy.content)) fail('INVALID_POLICY_BINDING');
  if (!exact(observation, ['ref', 'sha256', 'state']) || !text(observation.ref)) fail('INVALID_OBSERVATION_BINDING');
  const s = observation.state;
  if (!exact(s, ['generation', 'identity', 'refs', 'active', 'duplicates', 'effects', 'readback', 'history'])
    || !integer(s.generation) || !identity(s.identity)
    || !exact(s.refs, ['head', 'observedHead']) || !sha(s.refs.head) || !sha(s.refs.observedHead)
    || ![s.active, s.duplicates, s.effects, s.readback, s.history].every(list)
    || !s.active.every(turn) || !s.duplicates.every(turn)) fail('INVALID_OBSERVATION');
  if (!s.effects.every((x) => exact(x, ['id', 'generation', 'status']) && text(x.id) && integer(x.generation)
    && ['pending', 'succeeded', 'failed', 'unknown'].includes(x.status))
    || !s.readback.every((x) => exact(x, ['effectId', 'generation', 'status']) && text(x.effectId) && integer(x.generation)
    && ['applied', 'absent', 'unknown'].includes(x.status))
    || !s.history.every((x) => exact(x, ['seq', 'generation', 'event', 'actor', 'thread', 'head'])
      && integer(x.seq) && integer(x.generation) && events.has(x.event) && text(x.actor) && text(x.thread) && sha(x.head))) fail('INVALID_OBSERVATION');
  if (s.history.some((x, i) => i > 0 && x.seq <= s.history[i - 1].seq)) fail('UNORDERED_HISTORY');
  // Hash only after structural validation, never invoking an input getter/toJSON.
  if (observation.sha256 !== sha256(s)) fail('INVALID_OBSERVATION_BINDING');
  const aliases = new Map();
  const alias = (kind, value) => {
    const key = `${kind}\0${value}`;
    if (!aliases.has(key)) aliases.set(key, `${kind}${aliases.size}`);
    return aliases.get(key);
  };
  const who = (x) => ({ actor: alias('actor', x.actor), thread: alias('thread', x.thread) });
  const observed = {
    generation: s.generation, identity: who(s.identity),
    refs: { head: alias('ref', s.refs.head), observedHead: alias('ref', s.refs.observedHead) },
    active: s.active.map((x) => ({ ...who(x), generation: x.generation })),
    duplicates: s.duplicates.map((x) => ({ ...who(x), generation: x.generation })),
    effects: s.effects.map((x) => ({ id: alias('effect', x.id), generation: x.generation, status: x.status })),
    readback: s.readback.map((x) => ({ effectId: alias('effect', x.effectId), generation: x.generation, status: x.status })),
    history: s.history.map((x) => ({ seq: x.seq, generation: x.generation, event: x.event, ...who(x), head: alias('ref', x.head) })),
  };
  return { policy: policy.content, observed, candidates: [...decisionKinds] };
}

// Stable ranking is presentation only; low, tied and near-tied scores abstain.
export async function reviewWholeDDecisionPlane(input, ask) {
  const state = projectWholeDInput(input);
  if (typeof ask !== 'function') fail('JEV_ADAPTER_REQUIRED');
  const theme = 'whole-d-next-decision';
  const items = decisionKinds.map((kind) => ({ theme, subject: ['candidate', kind],
    concern: `Under the supplied policy, ${kind} is the next D decision for these external observations. This is a shadow candidate, not permission to execute.` }));
  const result = {
    schema: 'ops.wholeDShadow.v2', provider: 'jev', model: JEV_MODEL,
    authority: false, effect: false, referenceIsGroundTruth: false,
    policyRef: input.policy.ref, policySha256: input.policy.sha256,
    observationRef: input.observation.ref, observationSha256: input.observation.sha256,
    projectionSha256: sha256(state), ambiguity, status: 'UNKNOWN', decision: null,
    callsAttempted: 0, callsCompleted: 0, evaluated: 0, candidates: decisionKinds.length,
    ranked: [], usage: {}, providerResponse: null,
    claimCeiling: 'Shadow evidence only. No merge/adoption/skip/effect/dispatch/refire/contract/terminal authority. Scores are not calibrated safety probabilities.',
  };
  const start = performance.now();
  try {
    const evaluated = await evaluate(state, { themes: [theme], items }, async (visible, questions) => {
      result.callsAttempted += 1;
      const response = await ask(visible, questions);
      // Retain only the protocol fields, not arbitrary provider metadata.
      result.providerResponse = JSON.parse(JSON.stringify({ model: response?.model, answers: response?.answers, usage: response?.usage }));
      return response;
    });
    result.callsCompleted = evaluated.calls;
    result.evaluated = evaluated.judgments.length;
    result.coverage = evaluated.coverage;
    result.usage = evaluated.usage;
    result.ranked = rankJudgments(evaluated.judgments, { topK: decisionKinds.length, themes: [theme], items });
    const [first, second] = result.ranked[0].findings;
    const gap = first.noul - second.noul;
    if (first.noul >= ambiguity.minScore && gap > ambiguity.minGap + Number.EPSILON) {
      result.status = 'CANDIDATE';
      result.decision = first.subject[1];
    } else result.reason = 'AMBIGUOUS_OR_LOW_SCORE';
  } catch (error) {
    result.reason = /^(JEV_[A-Z_0-9]+|INVALID_JEV_[A-Z_]+)$/.test(error?.message ?? '')
      ? error.message : error?.name === 'TimeoutError' ? 'JEV_TIMEOUT' : 'EXECUTION_OR_RESPONSE_FAILURE';
  }
  result.elapsedMs = performance.now() - start;
  return result;
}

// Comparator and actual readback are NEVER passed to evaluate/ask.
export function compareWholeD(result, reference) {
  if (!exact(reference, ['kind', 'policySha256', 'observationSha256', 'decision', 'readback'])
    || !['observed-D', 'preregistered-fixture'].includes(reference.kind)
    || !decisionKinds.includes(reference.decision)
    || !exact(reference.readback, ['ref', 'sha256', 'content']) || !text(reference.readback.ref)
    || typeof reference.readback.content !== 'string' || !reference.readback.content.trim()
    || reference.readback.sha256 !== sha256(reference.readback.content)
    || reference.policySha256 !== result.policySha256 || reference.observationSha256 !== result.observationSha256) {
    return { status: 'BLOCK', reason: 'UNBOUND_REFERENCE_OR_READBACK', referenceIsGroundTruth: false };
  }
  return { status: result.status === 'CANDIDATE' ? (result.decision === reference.decision ? 'MATCH' : 'DIFFER') : 'UNKNOWN',
    kind: reference.kind, decision: reference.decision, readback: structuredClone(reference.readback), referenceIsGroundTruth: false };
}
