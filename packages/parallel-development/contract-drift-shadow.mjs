import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JEV_MODEL } from '../jev-review/core.mjs';
import { askJev, validateJevResponse } from '../jev-review/jev.mjs';
import { PHASES, reviewPhase, validatePhaseState } from './phases.mjs';

export const driftDigest = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const themes = PHASES.pr.map(([id]) => id);
const keys = ['contractRef', 'acceptanceRef', 'changeRef', 'contract', 'change', 'related'];
const exactChange = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}$/u;
const safeReason = (error) => ['ENOENT', 'EACCES', 'EISDIR'].includes(error?.code) ? 'INPUT_UNREADABLE'
  : /^Jev .* budget exceeded:/u.test(error?.message ?? '') ? 'INPUT_BUDGET_EXCEEDED'
  : /^(INPUT_DIGEST_MISMATCH|INVALID_CONTRACT_DRIFT_INPUT|INVALID_PHASE_STATE|PROVIDER_NOT_RUN|DECRYPT_CAPABILITY_LEAK|JEV_API_KEY_REQUIRED|JEV_HTTP_[0-9]{3}|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS))$/u.test(error?.message ?? '')
    ? error.message : 'EXECUTION_FAILED';

// expectedDigest must come from the frozen input observation, not from a changed payload.
// This verifies declared projection bytes, NOT upstream acceptance or source authenticity.
export async function reviewContractDrift(inputText, expectedDigest, ask) {
  const started = performance.now();
  const record = {
    schema: 'ops.contractDriftShadow.v2', provider: 'jev', requestedModel: JEV_MODEL,
    authority: false, effect: false, hardAuthority: false, referenceIsGroundTruth: false,
    bindingScope: 'exact-supplied-projection', sourceReadback: 'NOT_VERIFIED_BY_ADAPTER',
    comparison: 'NOT_RUN', downstreamEffect: 'UNMEASURED', cost: 'UNMEASURED',
    inputDigest: typeof inputText === 'string' ? driftDigest(inputText) : null,
    askInvocations: 0, observedResponses: 0, ranked: [], usage: {}, exchange: null,
    coverage: themes.map((theme) => ({ theme, candidates: 0, evaluated: 0 })),
    claimCeiling: 'Concerns in a static declared projection only; not contract violation, PR verdict, correction order, merge/skip authority, authenticated source acceptance, or measured usefulness.',
  };
  const finish = (status, reason = null) => ({ ...record, status, reason, elapsedMs: performance.now() - started });
  let input, state;
  try {
    if (typeof inputText !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(expectedDigest ?? '')
      || record.inputDigest !== expectedDigest) throw new Error('INPUT_DIGEST_MISMATCH');
    try { input = JSON.parse(inputText); } catch { throw new Error('INVALID_CONTRACT_DRIFT_INPUT'); }
    if (!input || Array.isArray(input) || Object.keys(input).length !== keys.length
      || !keys.every((key) => Object.hasOwn(input, key))
      || !text(input.contractRef) || !text(input.acceptanceRef) || !exactChange.test(input.changeRef ?? '')
      || !Array.isArray(input.related)) throw new Error('INVALID_CONTRACT_DRIFT_INPUT');
    state = validatePhaseState({ phase: 'pr', cut: input.contract, related: input.related, candidates: [input.change] });
    Object.assign(record, { contractRef: input.contractRef, acceptanceRef: input.acceptanceRef, changeRef: input.changeRef,
      inputText, stateDigest: driftDigest(JSON.stringify(state)),
      coverage: themes.map((theme) => ({ theme, candidates: 1, evaluated: 0 })) });
  } catch (error) { return finish('BLOCK', safeReason(error)); }

  try {
    if (typeof ask !== 'function') throw new Error('PROVIDER_NOT_RUN');
    const result = await reviewPhase(state, { topK: 1, themes }, async (reviewState, questions) => {
      const request = { model: JEV_MODEL, state: reviewState, questions };
      // Snapshot before crossing the injected boundary; mutation cannot rewrite retained evidence.
      const requestText = JSON.stringify(request);
      record.exchange = { request: JSON.parse(requestText), requestDigest: driftDigest(requestText), response: null, responseDigest: null };
      record.askInvocations++;
      const response = validateJevResponse(await ask(structuredClone(reviewState), structuredClone(questions)), questions);
      const responseText = JSON.stringify(response);
      Object.assign(record.exchange, { response: JSON.parse(responseText), responseDigest: driftDigest(responseText) });
      record.observedResponses++;
      return JSON.parse(responseText);
    });
    Object.assign(record, { ranked: result.ranked, usage: result.usage, observedModel: record.exchange.response.model,
      coverage: result.ranked.map(({ theme, candidates, evaluated }) => ({ theme, candidates, evaluated })) });
    return finish('OBSERVED');
  } catch (error) { return finish('UNKNOWN', safeReason(error)); }
}

// One bounded proof invocation through the existing envs jev-api capability. No CI hook,
// retries, secret acquisition, adoption, or semantic threshold is introduced here.
export async function writeDriftProof(inputFile, expectedDigest, outputFile, env = process.env) {
  const fd = fs.openSync(outputFile, 'wx', 0o600); // Must fail before any provider call on reuse.
  const append = (row) => fs.writeSync(fd, `${JSON.stringify(row)}\n`);
  try {
    append({ kind: 'manifest', schema: 'ops.contractDriftProof.v1', requestedModel: JEV_MODEL,
      opsSha: env.OPS_SHA ?? null, envsSha: env.ENVS_SHA ?? null, node: process.version,
      expectedDigest, transport: 'shared-askJev', effectAuthority: 0, maxAskInvocations: 1,
      implementation: ['contract-drift-shadow.mjs', 'phases.mjs', '../jev-review/core.mjs', '../jev-review/jev.mjs', '../jev-review/review.mjs', '../jev-review/rank.mjs']
        .map((path) => ({ path, digest: driftDigest(fs.readFileSync(new URL(path, import.meta.url))) })),
      sourceIdentity: 'producer-declared; independent readback required', comparison: 'NOT_RUN' });
    let result;
    try {
      const inputText = fs.readFileSync(inputFile, 'utf8');
      const ask = !env.JEV_API_KEY?.trim() ? undefined : async (state, questions) => {
        if (['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD'].some((key) => env[key])) throw new Error('DECRYPT_CAPABILITY_LEAK');
        return askJev(state, questions, { key: env.JEV_API_KEY, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000 });
      };
      result = await reviewContractDrift(inputText, expectedDigest, ask);
    } catch (error) {
      result = { schema: 'ops.contractDriftShadow.v2', status: 'BLOCK', reason: safeReason(error), authority: false,
        effect: false, askInvocations: 0, observedResponses: 0, ranked: [], comparison: 'NOT_RUN' };
    }
    append({ kind: 'result', ...result });
    fs.fsyncSync(fd);
    // Do not print Jev concerns into R's independent-review surface.
    return { status: result.status, reason: result.reason, inputDigest: result.inputDigest ?? null };
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputFile, expectedDigest, outputFile, ...extra] = process.argv.slice(2);
  if (!inputFile || !expectedDigest || !outputFile || extra.length) {
    console.error('usage: node contract-drift-shadow.mjs INPUT.json sha256:FROZEN_DIGEST NEW_REPORT.jsonl');
    process.exitCode = 1;
  } else {
    writeDriftProof(inputFile, expectedDigest, outputFile).then((result) => {
      console.log(JSON.stringify(result));
      if (result.status !== 'OBSERVED') process.exitCode = 1;
    }).catch(() => { console.error('PROOF_OUTPUT_FAILED'); process.exitCode = 1; });
  }
}
