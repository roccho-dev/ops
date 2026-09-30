// Finite read-only model experiment + unconditional replay of existing Nix checks.
// No check command, selection or scheduling decision is obtained from model output.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { digest, REFERENCE_KIND, REFERENCE_UNIVERSE, prepareWinnowRelevance, runWinnowRelevance, joinBoundedCiReference } from './winnow.mjs';

const out = process.argv[2];
const providerOnly = process.argv[3] === 'provider-only';
const prepareOnly = process.argv[3] === 'prepare-input';
if (!out || process.argv.length !== (prepareOnly ? 6 : providerOnly ? 4 : 3))
  throw new Error('usage: node proof.mjs OUTPUT_DIRECTORY [provider-only | prepare-input INPUT_JSON SHA256]');
mkdirSync(out, { recursive: true });
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const gitLine = (...args) => git(...args).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const report = { schema: 'ops.winnowCiRelevanceProof.v2', authority: false, effect: false, referenceKind: REFERENCE_KIND,
  result: 'UNKNOWN', observation: 'NOT_RUN', providerAttempts: 0, attemptedReferenceChecks: 0, completedReferenceChecks: 0 };
const port = Number(process.env.WINNOW_PORT ?? '11435');
if (!prepareOnly) requireThat(Number.isInteger(port) && port > 0 && port <= 65535, 'INVALID_LOCAL_PORT');
const origin = `http://127.0.0.1:${port}`;
const json = async (path, filename) => {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  const raw = await response.text();
  writeFileSync(join(out, filename), raw, { flag: 'wx' });
  requireThat(response.ok, `RUNTIME_HTTP_${response.status}`);
  return JSON.parse(raw);
};
const modelFrom = (tags) => {
  const models = tags.models?.filter((row) => ['winnow:e4b', 'ollaya.dev/library/winnow:e4b'].includes(row.name));
  requireThat(models?.length === 1 && /^[0-9a-f]{64}$/u.test(models[0].digest), 'MODEL_DIGEST_UNAVAILABLE');
  return models[0];
};

try {
  if (prepareOnly) {
    // No checkout, provider or command execution. This does not activate a case.
    const bytes = readFileSync(process.argv[4]);
    requireThat(/^[0-9a-f]{64}$/u.test(process.argv[5]) && sha256(bytes) === process.argv[5], 'INPUT_BYTES_MISMATCH');
    const prepared = prepareWinnowRelevance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    requireThat(prepared.input.treeSha !== undefined, 'DETACHED_INPUT_REQUIRED');
    write('prepared.json', prepared);
    Object.assign(report, { observation: 'INPUT_PREPARED', reason: 'Offline I/O validation only; no case or execution admission.',
      headSha: prepared.input.headSha, treeSha: prepared.input.treeSha, baseSha: prepared.input.baseSha,
      inputBytesSha256: sha256(bytes), inputSha256: prepared.inputSha256, requestSha256: prepared.requestSha256,
      referenceUniverse: prepared.input.candidates, providerOutput: null, wouldSelect: null, wouldOmit: null,
      pairAdmissible: false });
  } else {
  const headSha = gitLine('rev-parse', 'HEAD');
  requireThat(/^[0-9a-f]{40}$/u.test(process.env.PROOF_BASE ?? ''), 'EXACT_BASE_REQUIRED');
  requireThat(headSha === process.env.PROOF_HEAD, 'HEAD_MISMATCH');
  requireThat(!git('status', '--porcelain', '--untracked-files=no'), 'DIRTY_SOURCE');
  const baseSha = gitLine('merge-base', process.env.PROOF_BASE, headSha);
  const workflow = readFileSync('.github/workflows/nix-check.yml', 'utf8');
  const candidates = structuredClone(REFERENCE_UNIVERSE);
  requireThat(candidates.every((row) => workflow.includes(row.script)), 'REFERENCE_COMMAND_CHANGED');
  const input = { baseSha, headSha,
    changedPaths: git('diff', '--name-only', '-z', baseSha, headSha).split('\0').filter(Boolean), candidates, topK: 1 };
  Object.assign(report, { headSha, baseSha, referenceUniverse: candidates });
  const source = { headSha, treeSha: gitLine('rev-parse', 'HEAD^{tree}'), eventBaseSha: process.env.PROOF_BASE, baseSha,
    workflowSha256: sha256(workflow), diffSha256: sha256(git('diff', '--binary', '--full-index', baseSha, headSha)),
    proofBlob: gitLine('hash-object', 'packages/ci-relevance-shadow/proof.mjs'),
    coreBlob: gitLine('hash-object', 'packages/ci-relevance-shadow/winnow.mjs'),
    candidateScope: 'all two existing nix-check Nix validation entrypoints, replayed on exact PR head; not every repository workflow',
    sourceReadback: { command: 'git rev-parse HEAD', stdout: headSha },
    runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null };
  write('source.json', source); write('input.json', input);
  const runtimeVersion = await json('/api/version', 'runtime-version.json');
  requireThat(runtimeVersion.version === '0.7.5', 'RUNTIME_VERSION_MISMATCH');
  const model = modelFrom(await json('/api/tags', 'model-before.json'));
  const runtimeFiles = JSON.parse(readFileSync(join(out, 'runtime-files.json'), 'utf8'));
  requireThat(/^[0-9a-f]{64}$/u.test(runtimeFiles.archiveSha256) && /^[0-9a-f]{64}$/u.test(runtimeFiles.binarySha256), 'RUNTIME_FILE_IDENTITY_MISSING');
  report.providerAttempts = 1;
  const shadow = await runWinnowRelevance(input, { endpoint: `${origin}/v1/systemone`, timeoutMs: 300000 });
  write('shadow.json', shadow);
  const modelAfter = modelFrom(await json('/api/tags', 'model-after.json'));
  const loaded = await json('/api/ps', 'loaded-models.json');
  requireThat(model.digest === modelAfter.digest, 'MODEL_CHANGED_DURING_REQUEST');
  report.provider = { requestedModel: shadow.requestedModel, observedModel: shadow.observedModel,
    manifestSha256: model.digest, version: runtimeVersion.version, runtimeFiles, loaded };
  if (providerOnly) {
    report.observation = 'PROVIDER_EXECUTED';
    report.reason = 'Separate-runner observation; no reference execution or join in this process.';
  } else {
  report.observation = 'PROVIDER_EXECUTED_REFERENCE_PENDING';
  // Provider call completes BEFORE reference execution: no observed outcome can enter the request.
  const reference = { headSha, referenceKind: REFERENCE_KIND, source, sourceSha256: digest(source), checks: [] };
  for (const candidate of candidates) {
    const before = gitLine('rev-parse', 'HEAD');
    const fd = openSync(join(out, `${candidate.name}.log`), 'wx');
    const started = performance.now();
    let result;
    try { result = spawnSync('timeout', ['1200', 'bash', '-c', candidate.script], { stdio: ['ignore', fd, fd] }); }
    finally { closeSync(fd); }
    const durationMs = performance.now() - started;
    const after = gitLine('rev-parse', 'HEAD');
    requireThat(before === headSha && after === headSha && !git('status', '--porcelain', '--untracked-files=no'), 'REFERENCE_SOURCE_CHANGED');
    const row = { name: candidate.name, command: candidate.script, status: 'completed',
      conclusion: result.error || result.signal ? 'cancelled' : result.status === 124 ? 'timed_out' : result.status === 0 ? 'success' : 'failure',
      exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
      durationMs, sourceSha: before,
      sourceReadback: `source.json and git rev-parse HEAD before/after: ${before}/${after}`,
      logSha256: sha256(readFileSync(join(out, `${candidate.name}.log`))) };
    reference.checks.push(row);
    report.attemptedReferenceChecks++;
    if (['success', 'failure'].includes(row.conclusion)) report.completedReferenceChecks++;
    write(`${candidate.name}.reference.json`, row);
  }
  // Both run regardless of wouldSelect. This is a reference replay, never actual skipped CI.
  write('reference.json', reference);
  const paired = joinBoundedCiReference(shadow, reference);
  write('paired.json', paired);
  Object.assign(report, { observation: 'PAIRED', reason: paired.reason,
    headSha, inputSha256: shadow.inputSha256, pairedSha256: digest(paired),
    coverage: { naturalChanges: 1, independentCauseGroups: 1, provider: shadow.coverage, referenceChecks: reference.checks.length },
    cost: { requestMs: shadow.elapsedMs, referenceJobSumMs: paired.referenceMeasuredDurationMs,
      inputUsage: shadow.usage, billedMoney: null, humanAttentionMs: null, actualSavedExecutionMs: 0 },
    claimCeiling: paired.claimCeiling });
  }
  }
} catch (error) {
  report.reason = error.message;
  if (report.observation === 'PROVIDER_EXECUTED_REFERENCE_PENDING') report.observation = 'REFERENCE_INCOMPLETE';
  process.exitCode = 2; // Missing execution/readback is not a Green experiment.
} finally {
  write('report.json', report);
  console.log(JSON.stringify(report));
}
