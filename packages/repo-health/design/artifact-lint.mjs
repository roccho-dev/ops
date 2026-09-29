import { BUILTIN_THEMES, review } from './lint.mjs';

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const kinds = new Set(['issue', 'pr', 'contract', 'design']);

export async function reviewSemanticArtifact(input, ask) {
  if (!input || !kinds.has(input.kind) || !text(input.sourceRef) || !input.design) throw new Error('INVALID_SEMANTIC_LINT_INPUT');
  const result = await review(input.design, { topK: Number.isSafeInteger(input.topK) ? input.topK : 3, themes: BUILTIN_THEMES }, ask);
  return {
    schema: 'ops.semanticLintShadow.v1',
    provider: 'jev',
    authority: false,
    effect: false,
    sourceKind: input.kind,
    sourceRef: input.sourceRef,
    referenceIsGroundTruth: false,
    structuralReference: result.hard,
    ranked: result.ranked,
    usage: result.usage,
    claimCeiling: 'Semantic concerns only; not artifact PASS/FAIL, acceptance, forced correction, or merge authority.',
  };
}
