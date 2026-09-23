import { evaluate } from '../jev-review/review.mjs';
import { rankJudgments } from '../jev-review/rank.mjs';

export const PHASES = Object.freeze({
  cut: Object.freeze([
    ['purpose-coverage', 'The candidate parallel cut set may fail to cover the Issue purpose or close conditions.'],
    ['responsibility-overlap', 'Two or more cuts may redundantly own materially the same responsibility.'],
    ['semantic-closure', 'A declared output may not semantically satisfy a dependent cut input or required overall result.'],
    ['independent-cut', 'A cut may depend on another cut implementation detail instead of only its declared contract.'],
    ['scope-leakage', 'The cut set may include behavior outside the Issue purpose or explicit constraints.'],
    ['acceptance-weakness', 'One or more cut acceptance conditions may be too weak to establish the cut goal.'],
  ]),
  pr: Object.freeze([
    ['goal-fulfillment', 'The implementation may fail to fulfill the accepted cut goal.'],
    ['responsibility-contradiction', 'The implementation may contradict the accepted cut responsibility or constraints.'],
    ['semantic-io-drift', 'The implementation input or output meaning may drift from the accepted cut contract.'],
    ['scope-leakage', 'The implementation may change behavior outside the accepted write scope.'],
    ['evidence-weakness', 'The submitted evidence may be too weak to establish the accepted cut acceptance conditions.'],
    ['semantic-duplication', 'The implementation may duplicate responsibility owned by a related cut instead of consuming its declared contract.'],
  ]),
  join: Object.freeze([
    ['purpose-coverage', 'The composed Root result may fail the original Issue purpose or close conditions.'],
    ['cross-cut-mismatch', 'Accepted PR outputs may be connected with incompatible semantic meaning in the composition.'],
    ['duplicate-responsibility', 'The Join may reimplement responsibility already owned by an accepted child PR.'],
    ['missing-behavior', 'Behavior required by the Issue may be missing because no accepted child or Join owns it.'],
    ['scope-leakage', 'The Join may introduce behavior or effects outside the original Issue scope.'],
    ['whole-acceptance', 'The Root acceptance may be too weak to establish the whole Issue purpose after composition.'],
  ]),
});

const text = (x) => typeof x === 'string' && x.trim().length > 0;
const strings = (x) => Array.isArray(x) && x.every(text);
const exact = (x, names) => x && [Object.prototype, null].includes(Object.getPrototypeOf(x))
  && Reflect.ownKeys(x).length === names.length && names.every((name) => Object.hasOwn(x, name));
const unique = (xs) => new Set(xs).size === xs.length;

function issue(value) {
  return exact(value, ['purpose', 'close_conditions']) && text(value.purpose) && strings(value.close_conditions) && value.close_conditions.length;
}
function candidateSet(state) {
  return Array.isArray(state.candidates) && state.candidates.length > 0
    && state.candidates.every((candidate) => text(candidate?.id))
    && unique(state.candidates.map((candidate) => candidate.id));
}
function cut(value) {
  return exact(value, ['id', 'goal', 'in','out', 'deps', 'write_scope', 'acceptance', 'design'])
    && text(value.id) && text(value.goal) && strings(value.in) && strings(value.out) && value.out.length
    && strings(value.deps) && strings(value.write_scope) && strings(value.acceptance) && value.acceptance.length && text(value.design);
}
function cutCandidate(value) {
  return exact(value, ['id', 'cuts']) && text(value.id) && Array.isArray(value.cuts) && value.cuts.length
    && value.cuts.every(cut) && unique(value.cuts.map((x) => x.id));
}
function cutContract(value) {
  return exact(value, ['id', 'goal', 'scope', 'in', 'out', 'acceptance']) && text(value.id) && text(value.goal)
    && strings(value.scope) && value.scope.length && strings(value.in) && strings(value.out) && value.out.length
    && strings(value.acceptance) && value.acceptance.length;
}
function related(value) {
  return exact(value, ['id', 'responsibility', 'out']) && text(value.id) && text(value.responsibility) && strings(value.out) && value.out.length;
}
function prCandidate(value) {
  return exact(value, ['id', 'changed_scope', 'implementation', 'outputs', 'evidence']) && text(value.id)
    && strings(value.changed_scope) && value.changed_scope.length && text(value.implementation)
    && strings(value.outputs) && value.outputs.length && strings(value.evidence) && value.evidence.length;
}
function acceptedPr(value) {
  return exact(value, ['id', 'goal','out','evidence']) && text(value.id) && text(value.goal)
    && strings(value.out) && value.out.length && strings(value.evidence) && value.evidence.length;
}
function joinCandidate(value) {
  return exact(value, ['id', 'composition', 'outputs', 'acceptance','effects']) && text(value.id) && text(value.composition)
    && strings(value.outputs) && value.outputs.length && strings(value.acceptance) && value.acceptance.length && strings(value.effects);
}

export function validatePhaseState(state) {
  if (!state || !text(state.phase) || !PHASES[state.phase]) throw new Error('INVALID_PHASE_STATE');
  if (state.phase === 'cut') {
    if (!exact(state, ['phase', 'issue', 'candidates']) || !issue(state.issue) || !candidateSet(state) || !state.candidates.every(cutCandidate)) throw new Error('INVALID_PHASE_STATE');
  } else if (state.phase === 'pr') {
    if (!exact(state, ['phase', 'cut', 'related', 'candidates']) || !cutContract(state.cut)
      || !Array.isArray(state.related) || !state.related.every(related) || !candidateSet(state) || !state.candidates.every(prCandidate)) throw new Error('INVALID_PHASE_STATE');
  } else if (state.phase === 'join') {
    if (!exact(state, ['phase', 'issue', 'accepted_prs', 'candidates']) || !issue(state.issue)
      || !Array.isArray(state.accepted_prs) || !state.accepted_prs.length || !state.accepted_prs.every(acceptedPr)
      || !candidateSet(state) || !state.candidates.every(joinCandidate)) throw new Error('INVALID_PHASE_STATE');
  }
  return state;
}

export function validateBenchmarkCase(row) {
  if (!exact(row, ['caseId', 'phase', 'theme', 'state']) || !/^case-[0-9]{2}$/u.test(row.caseId ?? '')
    || !PHASES[row.phase] || !PHASES[row.phase].some(([theme]) => theme === row.theme)
    || row.state?.phase !== row.phase) throw new Error('INVALID_BENCHMARK_CASE');
  validatePhaseState(row.state);
  return row;
}

export async function reviewPhase(state, { topK = 2, themes = null } = {}, ask) {
  validatePhaseState(state);
  if (!Number.isSafeInteger(topK) || topK < 0) throw new Error('INVALID_TOP_K');
  const selected = themes == null ? PHASES[state.phase] : PHASES[state.phase].filter(([id]) => themes.includes(id));
  if (!selected.length || (themes != null && selected.length !== themes.length)) throw new Error('INVALID_PHASE_THEMES');
  const themeIds = selected.map(([id]) => id);
  const items = selected.flatMap(([theme, concern]) => state.candidates.map((candidate) => ({
    theme, subject: ['candidate', candidate.id], concern,
  })));
  if (topK === 0) return { calls: 0, ranked: rankJudgments([], { topK, themes: themeIds, items }), usage: {} };
  const result = await evaluate(state, { themes: themeIds, items }, ask);
  return { calls: result.calls, ranked: rankJudgments(result.judgments, { topK, themes: themeIds, items }), usage: result.usage };
}
