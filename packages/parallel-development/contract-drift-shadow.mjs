import { PHASES, reviewPhase } from './phases.mjs';

const text = (value) => typeof value === 'string' && value.trim().length > 0;

export async function reviewContractDrift(input, ask) {
  if (!input || !text(input.contractRef) || !text(input.changeRef) || !input.contract || !input.change) throw new Error('INVALID_CONTRACT_DRIFT_INPUT');
  const themes = PHASES.pr.map(([id]) => id);
  const state = {
    phase: 'pr',
    cut: input.contract,
    related: Array.isArray(input.related) ? input.related : [],
    candidates: [input.change],
  };
  const result = await reviewPhase(state, { topK: 1, themes }, ask);
  return {
    schema: 'ops.contractDriftShadow.v1',
    provider: 'jev',
    authority: false,
    effect: false,
    contractRef: input.contractRef,
    changeRef: input.changeRef,
    referenceIsGroundTruth: false,
    hardAuthority: false,
    ranked: result.ranked,
    usage: result.usage,
    claimCeiling: 'Semantic drift concerns only; not contract violation, PR failure, correction order, or merge authority.',
  };
}
