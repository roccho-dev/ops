import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { JEV_MODEL } from '../../jev-review/core.mjs';
import { askJev, validateJevResponse } from '../../jev-review/jev.mjs';
import { evaluate } from '../../jev-review/review.mjs';
import { rankJudgments } from '../../jev-review/rank.mjs';
import { structural } from './lint.mjs';

// These are six hypotheses, not six findings or a completeness/acceptance rubric.
export const CONCERNS = Object.freeze([
  ['omission', 'The artifact may omit meaning necessary to achieve its stated purpose. Concision alone is not an omission.'],
  ['contradiction', 'Requirements, responsibilities, constraints or authority statements in the artifact may contradict one another.'],
  ['responsibility', 'Necessary responsibility may be unowned, ambiguous or independently duplicated rather than intentionally shared.'],
  ['closure', 'An output or completion claim may not satisfy the input or outcome needed by its consumer.'],
  ['scope', 'The artifact may allow behavior outside its stated scope or authority.'],
  ['acceptance', 'Acceptance or evidence conditions may permit the stated purpose to fail while appearing complete.'],
].map(([id, concern]) => Object.freeze({ id, concern })));
export const SCOPES = Object.freeze({
  issue: 'issue:title+body', pr: 'pr:title+body+baseSha+headSha',
  contract: 'contract:full-text', design: 'design:full-json',
});
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const digest = (value) => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')}`;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const exact = (v, names) => v && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Reflect.ownKeys(v).length === names.length && names.every((name) => {
    const d = Object.getOwnPropertyDescriptor(v, name);
    return d?.enumerable && Object.hasOwn(d, 'value');
  });
const copy = (v) => JSON.parse(JSON.stringify(v));
const seal = (v) => ({ ...v, evidenceDigest: digest(v) });
const safeError = (error) => {
  if (/^Jev (state|state\+question|request) budget exceeded:/u.test(error?.message)) return 'JEV_BUDGET_EXCEEDED';
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return 'PROVIDER_TIMEOUT';
  return /^(INVALID_ARTIFACT_(INPUT|CONTENT)|SOURCE_DIGEST_MISMATCH|JEV_API_KEY_REQUIRED|DECRYPT_CAPABILITY_LEAK|JEV_MODEL_MISMATCH|INVALID_JEV_(JSON|ANSWERS)|JEV_HTTP_[0-9]{3})$/u.test(error?.message)
    ? error.message : 'EXECUTION_FAILED';
};

// The digest binds supplied bytes, not the truth/freshness of the caller's source claim.
export function validateArtifact(input) {
  if (!exact(input, ['kind', 'sourceRef', 'revision', 'scope', 'content', 'contentSha256', 'topK'])
    || typeof input.kind !== 'string' || !Object.hasOwn(SCOPES, input.kind) || input.scope !== SCOPES[input.kind]
    || !text(input.sourceRef) || !text(input.revision) || typeof input.content !== 'string'
    || !Number.isSafeInteger(input.topK) || input.topK < 0 || input.topK > CONCERNS.length) throw new Error('INVALID_ARTIFACT_INPUT');
  if (input.contentSha256 !== digest(input.content)) throw new Error('SOURCE_DIGEST_MISMATCH');
  const source = copy(input);
  let parsed = null;
  if (source.kind !== 'contract') {
    try { parsed = JSON.parse(source.content); } catch { throw new Error('INVALID_ARTIFACT_CONTENT'); }
  }
  if (['issue', 'pr'].includes(source.kind)) {
    const fields = source.kind === 'issue' ? ['title', 'body'] : ['title', 'body', 'baseSha', 'headSha'];
    if (!exact(parsed, fields) || typeof parsed.title !== 'string' || (parsed.body !== null && typeof parsed.body !== 'string')
      || (source.kind === 'pr' && (!/^[a-f0-9]{40}$/u.test(parsed.baseSha) || !/^[a-f0-9]{40}$/u.test(parsed.headSha)
        || source.revision !== parsed.headSha))) throw new Error('INVALID_ARTIFACT_CONTENT');
  }
  const observations = source.kind === 'design' ? structural(parsed)
    : (source.kind === 'contract' ? source.content : (parsed.body ?? '')).trim() ? [] : [{ code: 'EMPTY_BODY' }];
  return { source, observations };
}

export async function reviewSemanticArtifact(input, ask) {
  const { source, observations } = validateArtifact(input);
  if (ask !== undefined && typeof ask !== 'function') throw new Error('INVALID_ARTIFACT_INPUT');
  const mode = ask === undefined ? 'live' : 'injected';
  // Source names/revisions and comparison labels are NOT model-visible. All content bytes are.
  const state = { artifact: { kind: source.kind, scope: source.scope, content: source.content } };
  const themes = ['semantic-lint'];
  const items = CONCERNS.map(({ id, concern }) => ({ theme: themes[0], subject: ['artifact', id],
    concern: `For the whole supplied artifact (the second target element names the concern lens): ${concern}` }));
  const record = {
    schema: 'ops.semanticLintShadow.v2', provider: 'jev', requestedModel: JEV_MODEL,
    authority: false, effect: false, effectAuthority: 0, referenceIsGroundTruth: false,
    source, inputDigest: digest(source),
    projection: { method: 'identity-on-declared-scope', sourceAuthentication: 'NOT_VERIFIED',
      sourceBytes: Buffer.byteLength(source.content, 'utf8'), projectedBytes: Buffer.byteLength(state.artifact.content, 'utf8'),
      contentDigest: digest(state.artifact.content), scope: source.scope },
    projectionDigest: digest(state), questionContract: { themes, items },
    questionContractDigest: digest({ themes, items }), structuralReference: observations,
    execution: { mode, status: 'UNKNOWN', reason: null, calls: 0, transportInvocations: 0,
      httpRequests: mode === 'live' ? 0 : null, ms: 0 },
    observedModel: null, request: null, response: null, raw: [], ranked: [],
    coverage: { candidates: items.length, evaluated: 0, returned: 0 }, usage: {},
    comparison: { status: 'UNKNOWN', reason: 'NO_INDEPENDENT_COMPARISON', cost: null, attentionMs: null },
    claimCeiling: 'Concerns over supplied snapshot scope only; no source authentication, exhaustive coverage, artifact verdict, acceptance, forced correction, merge/skip authority or proven value.',
  };
  if (source.topK === 0) {
    record.execution.reason = 'DISABLED';
    record.ranked = rankJudgments([], { topK: 0, themes, items });
    return seal(record);
  }
  const started = performance.now();
  try {
    const result = await evaluate(state, { themes, items }, async (sentState, questions) => {
      record.request = copy({ model: JEV_MODEL, state: sentState, questions });
      record.requestDigest = digest(record.request);
      record.execution.transportInvocations++;
      let response;
      if (ask) response = await ask(copy(sentState), copy(questions));
      else {
        if (['SOPS_AGE_KEY', 'SOPS_AGE_KEY_FILE', 'SOPS_AGE_KEY_CMD'].some((key) => process.env[key])) throw new Error('DECRYPT_CAPABILITY_LEAK');
        response = await askJev(sentState, questions, { key: process.env.JEV_API_KEY, endpoint: ENDPOINT, timeoutMs: 15000,
          fetchImpl: (...args) => { record.execution.httpRequests++; return fetch(...args); } });
      }
      // Retain only validated response fields; do not persist arbitrary error/HTTP bodies.
      record.response = copy(validateJevResponse(response, questions));
      record.responseDigest = digest(record.response);
      return record.response;
    });
    record.raw = result.judgments;
    record.ranked = rankJudgments(result.judgments, { topK: source.topK, themes, items });
    record.coverage.evaluated = result.judgments.length;
    record.coverage.returned = record.ranked[0].returned;
    record.usage = result.usage;
    record.observedModel = record.response.model;
    record.execution.calls = result.calls;
    record.execution.status = 'OBSERVED'; // Execution only, including explicitly injected tests.
  } catch (error) {
    record.execution.reason = safeError(error);
    record.execution.status = ['JEV_BUDGET_EXCEEDED', 'JEV_API_KEY_REQUIRED', 'DECRYPT_CAPABILITY_LEAK'].includes(record.execution.reason) ? 'BLOCK' : 'UNKNOWN';
    record.raw = []; record.ranked = [];
  }
  record.execution.ms = Math.round(performance.now() - started);
  return seal(record);
}

// One-shot existing-envs consumer. No credential provisioning, retries, queue or writes to GitHub.
async function main() {
  const [inputFile, outputFile, extra] = process.argv.slice(2);
  if (!inputFile || !outputFile || extra) throw new Error('USAGE');
  const fd = fs.openSync(outputFile, 'wx', 0o600);
  const append = (row) => fs.writeSync(fd, `${JSON.stringify(row)}\n`);
  try {
    const raw = fs.readFileSync(inputFile, 'utf8');
    const sources = ['./artifact-lint.mjs', './lint.mjs', '../../jev-review/core.mjs', '../../jev-review/jev.mjs', '../../jev-review/review.mjs', '../../jev-review/rank.mjs'];
    const closure = Object.fromEntries(sources.map((p) => [p, digest(fs.readFileSync(new URL(p, import.meta.url), 'utf8'))]));
    const manifest = { kind: 'manifest', mode: 'live', inputFileDigest: digest(raw), implementation: closure,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      opsSha: /^[a-f0-9]{40}$/u.test(process.env.OPS_SHA ?? '') ? process.env.OPS_SHA : null,
      endpoint: ENDPOINT, model: JEV_MODEL, effectAuthority: 0 };
    append(seal(manifest));
    let input;
    try { input = JSON.parse(raw); } catch { throw new Error('INVALID_ARTIFACT_INPUT'); }
    const result = await reviewSemanticArtifact(input);
    const envelope = seal({ kind: 'result', manifestDigest: digest(manifest), result });
    append(envelope);
    const summary = { kind: 'summary', status: result.execution.status, reason: result.execution.reason,
      calls: result.execution.calls, httpRequests: result.execution.httpRequests, evidenceDigest: envelope.evidenceDigest,
      semanticResult: 'UNKNOWN', effectAuthority: 0 };
    append(summary); console.log(JSON.stringify(summary));
    if (result.execution.status !== 'OBSERVED') process.exitCode = 1;
  } catch (error) {
    const summary = { kind: 'summary', status: 'BLOCK', reason: safeError(error), semanticResult: 'UNKNOWN', effectAuthority: 0 };
    append(summary); console.log(JSON.stringify(summary)); process.exitCode = 1;
  } finally { fs.closeSync(fd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('ARTIFACT_REPORT_NOT_WRITTEN'); process.exitCode = 1; });
}
