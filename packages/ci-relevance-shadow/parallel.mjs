// One finite #449 experiment. Files are per-job evidence, not a scheduler or shared state.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, openSync, closeSync } from 'node:fs';
import { cpus, totalmem, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, REFERENCE_KIND, REFERENCE_UNIVERSE, joinBoundedCiReference } from './winnow.mjs';

export const PLAN = Object.freeze({
  id: 'lane-a-separate-runners-5898026275',
  authority: 'https://github.com/roccho-dev/ops/issues/449#issuecomment-5898026275',
  design: 'https://github.com/roccho-dev/ops/issues/449#issuecomment-5897925586',
  parent: 'b496de62cc5b2a1cad916a35dc40cb26c6fc0065',
  base: 'a6c683101f4bc77587a9cfe4bf2db54503916eae',
  referenceKind: REFERENCE_KIND, referenceUniverse: REFERENCE_UNIVERSE,
  model: 'winnow:e4b', version: '0.7.5', topK: 1, providerTimeoutMs: 300000,
  manifestSha256: 'dd4bf88aa50bebb02e7a26fbebed14682befd037e3e89789ee22b9793f82d226',
  archiveSha256: '9e2a68a9d0762c819e94cfc30f8a8ada379c6a63f1c66dbf6a6182f77ca32353',
  binarySha256: '6b3fabf960ee78d9dccf916b9da1b08620ba6981e31a1d3950bf50c808f0cd0c',
  referenceTimeoutSeconds: 1200, providerJobMinutes: 40, referenceJobMinutes: 30, joinJobMinutes: 5,
  setupLimitsSeconds: { archive: 600, modelPull: 1200, readiness: 60 }, attempt: 1, liveRetries: 0,
});
export const MEMBERS = Object.freeze(['provider', ...REFERENCE_UNIVERSE.map(x => x.name)]);
export const jobName = member => `lane-a-separated-${member}`;
export const commandFor = member => member === 'provider'
  ? 'node packages/ci-relevance-shadow/proof.mjs "$LANE_OUT/provider" provider-only'
  : REFERENCE_UNIVERSE.find(x => x.name === member)?.script;
export const timeoutFor = member => member === 'provider' ? 360 : PLAN.referenceTimeoutSeconds;
const requireThat = (ok, reason) => { if (!ok) throw new Error(reason); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const put = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const now = () => new Date().toISOString();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const line = (...args) => git(...args).trim();
const stamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const hex40 = s => typeof s === 'string' && /^[a-f0-9]{40}$/u.test(s);
const providerIdentity = p => p?.version === PLAN.version && p.manifestSha256 === PLAN.manifestSha256
  && p.runtimeFiles?.archiveSha256 === PLAN.archiveSha256 && p.runtimeFiles.binarySha256 === PLAN.binarySha256
  && p.loaded?.models?.filter(x => x.name === PLAN.model && x.digest === PLAN.manifestSha256
    && x.device === 'cpu' && x.size_vram === 0).length === 1;


export function assertAdmission({ head, parent, eventHead, eventName, action, pr, headRef, attempt }) {
  requireThat(hex40(head) && head === eventHead && parent === PLAN.parent, 'UNREGISTERED_SOURCE');
  requireThat(eventName === 'pull_request' && action === 'synchronize' && pr === 450
    && headRef === 'proof/449-winnow-ci-relevance' && attempt === PLAN.attempt, 'UNREGISTERED_ATTEMPT');
}

export function sourceIdentity() {
  const headSha = line('rev-parse', 'HEAD'), treeSha = line('rev-parse', 'HEAD^{tree}');
  requireThat(!git('status', '--porcelain', '--untracked-files=no'), 'DIRTY_SOURCE');
  const parents = line('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1);
  requireThat(parents.length === 1, 'UNREGISTERED_SOURCE');
  const baseSha = line('merge-base', PLAN.base, headSha);
  const input = { baseSha, headSha, changedPaths: git('diff', '--name-only', '-z', baseSha, headSha).split('\0').filter(Boolean),
    candidates: structuredClone(REFERENCE_UNIVERSE), topK: PLAN.topK };
  const workflow = readFileSync('.github/workflows/nix-check.yml');
  requireThat(REFERENCE_UNIVERSE.every(x => workflow.toString().includes(x.script)), 'REFERENCE_COMMAND_CHANGED');
  return { headSha, treeSha, parent: parents[0], eventBaseSha: PLAN.base, baseSha, input, inputSha256: digest(input),
    workflowSha256: hash(workflow), diffSha256: hash(git('diff', '--binary', '--full-index', baseSha, headSha)) };
}

// Read-only GitHub metadata; deliberately no provider endpoint, retries or unbounded polling.
async function jobsReadback(env, out) {
  requireThat(/^\d+$/u.test(env.GITHUB_RUN_ID ?? '') && env.GITHUB_RUN_ATTEMPT === '1', 'UNREGISTERED_ATTEMPT');
  const url = `https://api.github.com/repos/roccho-dev/ops/actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`;
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' } });
  const raw = await r.text();
  writeFileSync(join(out, 'jobs-api.json'), raw, { flag: 'wx' });
  requireThat(r.ok, `JOBS_READBACK_HTTP_${r.status}`);
  const data = JSON.parse(raw);
  requireThat(Array.isArray(data.jobs) && data.jobs.length === data.total_count, 'JOBS_READBACK_INCOMPLETE');
  return data;
}

export async function begin(member, out, env = process.env) {
  requireThat(MEMBERS.includes(member), 'UNDECLARED_MEMBER');
  requireThat(env.GITHUB_REPOSITORY === 'roccho-dev/ops', 'REPOSITORY_MISMATCH');
  const event = read(env.GITHUB_EVENT_PATH), source = sourceIdentity();
  assertAdmission({ head: source.headSha, parent: source.parent, eventHead: event.pull_request?.head?.sha,
    eventName: env.GITHUB_EVENT_NAME, action: event.action, pr: event.number,
    headRef: event.pull_request?.head?.ref, attempt: Number(env.GITHUB_RUN_ATTEMPT) });
  const jobs = await jobsReadback(env, out);
  const matches = jobs.jobs.filter(x => x.name === jobName(member) && x.run_attempt === 1 && String(x.run_id) === env.GITHUB_RUN_ID);
  requireThat(matches.length === 1, 'RUNNER_JOB_UNRESOLVED');
  const job = matches[0];
  requireThat(job.head_sha === source.headSha && job.runner_name === env.RUNNER_NAME
    && job.runner_id > 0 && same(job.labels, ['ubuntu-24.04']), 'RUNNER_IDENTITY_MISMATCH');
  put(join(out, 'start.json'), { schema: 'ops.winnowSeparateStart.v1', planSha256: digest(PLAN), source,
    member, jobName: jobName(member), jobId: job.id, runId: job.run_id, attempt: 1,
    command: commandFor(member), timeoutSeconds: timeoutFor(member), jobTimeoutMinutes: member === 'provider' ? PLAN.providerJobMinutes : PLAN.referenceJobMinutes, providerTimeoutMs: member === 'provider' ? PLAN.providerTimeoutMs : null,
    start: now(), runner: { id: job.runner_id, name: job.runner_name, labels: job.labels,
      hostname: hostname(), os: env.RUNNER_OS, arch: env.RUNNER_ARCH,
      logicalCpus: cpus().length, cpuModel: cpus()[0]?.model ?? null, memoryBytes: totalmem() },
    authority: false, effect: false });
}

export function execute(member, out) {
  requireThat(MEMBERS.includes(member), 'UNDECLARED_MEMBER');
  const start = read(join(out, 'start.json'));
  requireThat(start.member === member && same(start.source, sourceIdentity()), 'SOURCE_CHANGED');
  const commandStart = now(), t = performance.now();
  const args = member === 'provider' ? [process.execPath, 'packages/ci-relevance-shadow/proof.mjs', join(out, 'provider'), 'provider-only']
    : ['bash', '-c', commandFor(member)];
  const fd = openSync(join(out, 'command.log'), 'wx');
  let result;
  try { result = spawnSync('timeout', ['--kill-after=10', String(timeoutFor(member)), ...args], {
    stdio: ['ignore', fd, fd], env: { ...process.env, PROOF_HEAD: start.source.headSha, PROOF_BASE: PLAN.base },
  }); } finally { closeSync(fd); }
  const end = now();
  const execution = { start: commandStart, end, durationMs: performance.now() - t, command: commandFor(member),
    timeoutSeconds: timeoutFor(member), argv: args, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    conclusion: result.error || result.signal ? 'cancelled' : [124, 137].includes(result.status) ? 'timed_out'
      : [126, 127].includes(result.status) || result.status === null ? 'not_executed' : result.status === 0 ? 'success' : 'failure',
    logSha256: hash(readFileSync(join(out, 'command.log'))) };
  try {
    requireThat(same(start.source, sourceIdentity()), 'SOURCE_CHANGED');
    execution.sourceAfter = start.source;
    if (member === 'provider') {
      execution.report = read(join(out, 'provider/report.json'));
      if (existsSync(join(out, 'provider/shadow.json'))) execution.shadow = read(join(out, 'provider/shadow.json'));
      const p = execution.report.provider;
      requireThat(providerIdentity(p), 'PROVIDER_IDENTITY_MISMATCH');
      requireThat(execution.report.providerAttempts === 1 && execution.report.attemptedReferenceChecks === 0
        && execution.report.observation === 'PROVIDER_EXECUTED', 'PROVIDER_EXECUTION_INCOMPLETE');
    }
  } catch (e) { execution.reason = e.message; }
  put(join(out, 'execution.json'), execution);
  return execution.conclusion === 'success' && !execution.reason ? 0 : 2;
}

function fileHashes(out, prefix = '') {
  return Object.fromEntries(readdirSync(join(out, prefix), { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(e => {
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (name === 'terminal.json') return [];
    requireThat(!e.isSymbolicLink(), 'EVIDENCE_SYMLINK');
    return e.isDirectory() ? Object.entries(fileHashes(out, name)) : [[name, hash(readFileSync(join(out, name)))]];
  }));
}

export function terminal(member, out, env = process.env) {
  if (existsSync(join(out, 'terminal.json'))) return; // Never overwrite an earlier terminal.
  const start = existsSync(join(out, 'start.json')) ? read(join(out, 'start.json')) : null;
  const execution = existsSync(join(out, 'execution.json')) ? read(join(out, 'execution.json')) : null;
  put(join(out, 'terminal.json'), { schema: 'ops.winnowSeparateTerminal.v1', member, start, execution,
    terminalAt: now(), jobStatusAtFinalizer: env.LANE_JOB_STATUS ?? null, result: 'UNKNOWN', authority: false, effect: false,
    reason: execution?.reason ?? (execution ? execution.conclusion : 'SETUP_OR_EXECUTION_INCOMPLETE'),
    memberSha256: fileHashes(out) });
}

export function loadTerminal(out) {
  const terminal = read(join(out, 'terminal.json'));
  requireThat(same(terminal.memberSha256, fileHashes(out)), 'EVIDENCE_BYTES_MISMATCH');
  if (terminal.start) requireThat(same(terminal.start, read(join(out, 'start.json'))), 'START_EVIDENCE_MISMATCH');
  if (terminal.execution) requireThat(same(terminal.execution, read(join(out, 'execution.json'))), 'EXECUTION_EVIDENCE_MISMATCH');
  return terminal;
}

// Pure function: no provider call, process execution or network. API facts are separate inputs.
export function joinTerminals(terminals, jobs, expected, joinedAt = now()) {
  const report = { schema: 'ops.winnowSeparateJoin.v1', planSha256: digest(PLAN), ...expected, joinedAt,
    referenceKind: REFERENCE_KIND, referenceUniverse: structuredClone(REFERENCE_UNIVERSE),
    observation: 'INCOMPLETE', result: 'UNKNOWN', pairAdmissible: false, providerCalls: 0, liveRetries: 0,
    authority: false, effect: false, broaderLaneA: 'UNFINISHED',
    terminalsSha256: digest(terminals), jobsSha256: digest(jobs) };
  try {
    requireThat(hex40(expected.headSha) && hex40(expected.treeSha) && expected.attempt === 1, 'EXACT_BINDING_REQUIRED');
    requireThat(terminals.length === MEMBERS.length && new Set(terminals.map(x => x.member)).size === MEMBERS.length
      && MEMBERS.every(m => terminals.some(x => x.member === m)), 'TERMINAL_EVIDENCE_MISSING');
    const observedJobs = MEMBERS.map(member => {
      const matches = jobs.jobs?.filter(j => j.name === jobName(member));
      requireThat(matches?.length === 1, 'JOB_EVIDENCE_MISSING');
      return matches[0];
    });
    requireThat(observedJobs.every(j => j.status === 'completed' && stamp(j.completed_at)), 'JOBS_NOT_TERMINAL');
    requireThat(stamp(joinedAt) && observedJobs.every(j => Date.parse(j.completed_at) <= Date.parse(joinedAt)), 'JOIN_BEFORE_TERMINAL');
    requireThat(observedJobs.every(j => j.run_id === expected.runId && j.run_attempt === 1 && j.head_sha === expected.headSha), 'JOB_SOURCE_OR_ATTEMPT_MISMATCH');
    requireThat(observedJobs.every(j => j.runner_id > 0 && same(j.labels, ['ubuntu-24.04']))
      && new Set(observedJobs.map(j => j.runner_id)).size === MEMBERS.length, 'SEPARATE_RUNNERS_UNPROVEN');
    report.jobs = observedJobs.map(({ id, name, runner_id, runner_name, labels, started_at, completed_at, conclusion }) =>
      ({ id, name, runner_id, runner_name, labels, started_at, completed_at, conclusion }));
    for (const t of terminals) {
      requireThat(t.start, 'START_EVIDENCE_MISSING');
      requireThat(t.execution, 'EXECUTION_EVIDENCE_MISSING');
      const s = t.start, e = t.execution, j = observedJobs.find(x => x.name === jobName(t.member));
      requireThat(t.schema === 'ops.winnowSeparateTerminal.v1' && t.authority === false && t.effect === false
        && t.result === 'UNKNOWN' && s?.authority === false && s?.effect === false, 'TERMINAL_AUTHORITY_MISMATCH');
      requireThat(s.planSha256 === digest(PLAN) && s.member === t.member && s.jobId === j.id && s.runId === expected.runId
        && s.attempt === 1 && s.runner.id === j.runner_id && s.runner.name === j.runner_name && same(s.runner.labels, j.labels), 'TERMINAL_JOB_MISMATCH');
      requireThat(s.source.headSha === expected.headSha && s.source.treeSha === expected.treeSha && s.source.parent === PLAN.parent
        && s.source.eventBaseSha === PLAN.base && hex40(s.source.baseSha) && same(e?.sourceAfter, s.source), 'SOURCE_OR_TREE_MISMATCH');
      requireThat(s.source.inputSha256 === digest(s.source.input) && same(s.source.input.candidates, REFERENCE_UNIVERSE)
        && s.source.input.topK === PLAN.topK && s.source.input.headSha === expected.headSha, 'INPUT_UNIVERSE_MISMATCH');
      requireThat(s.command === commandFor(t.member) && s.timeoutSeconds === timeoutFor(t.member)
        && e.command === s.command && e.timeoutSeconds === s.timeoutSeconds, 'COMMAND_OR_TIMEOUT_MISMATCH');
      requireThat(stamp(s.start) && stamp(e.start) && stamp(e.end) && stamp(t.terminalAt) && stamp(j.started_at)
        && Date.parse(s.start) <= Date.parse(e.start) && Date.parse(e.start) <= Date.parse(e.end)
        && Date.parse(e.end) <= Date.parse(t.terminalAt) && Date.parse(t.terminalAt) <= Date.parse(joinedAt)
        && Date.parse(e.start) >= Date.parse(j.started_at) - 2000 && Date.parse(e.end) <= Date.parse(j.completed_at) + 2000
        && Number.isFinite(e.durationMs) && e.durationMs >= 0
        && Math.abs((Date.parse(e.end) - Date.parse(e.start)) - e.durationMs) < 2000, 'TIME_READBACK_INVALID');
      requireThat(['success', 'failure'].includes(j.conclusion) && ['success', 'failure'].includes(e.conclusion)
        && Number.isInteger(e.exitCode) && ![124, 126, 127, 137].includes(e.exitCode) && !e.signal && !e.error && !e.reason
        && (e.conclusion === 'success') === (e.exitCode === 0), 'EXECUTION_INCOMPLETE');
    }
    const p = terminals.find(x => x.member === 'provider'), pReport = p.execution.report;
    requireThat(observedJobs.find(j => j.name === jobName('provider')).conclusion === 'success'
      && p.execution.conclusion === 'success' && pReport?.providerAttempts === 1 && pReport.attemptedReferenceChecks === 0
      && pReport.observation === 'PROVIDER_EXECUTED' && pReport.authority === false && pReport.effect === false, 'PROVIDER_EXECUTION_INCOMPLETE');
    requireThat(providerIdentity(pReport.provider), 'PROVIDER_IDENTITY_MISMATCH');
    const shadow = p.execution.shadow;
    requireThat(terminals.every(t => same(t.start.source, p.start.source))
      && same(shadow?.input, p.start.source.input) && shadow.executionKind === 'live-http', 'EXACT_INPUT_MISMATCH');
    const reference = { headSha: expected.headSha, referenceKind: REFERENCE_KIND,
      checks: REFERENCE_UNIVERSE.map(c => {
        const t = terminals.find(x => x.member === c.name);
        return { name: c.name, command: t.execution.command, status: 'completed', conclusion: t.execution.conclusion,
          durationMs: t.execution.durationMs, sourceSha: t.start.source.headSha,
          sourceReadback: `job ${t.start.jobId}; git HEAD/tree before and after; ${t.start.source.treeSha}` };
      }) };
    report.paired = joinBoundedCiReference(shadow, reference);
    report.reference = reference;
    Object.assign(report, { observation: 'PAIRED', pairAdmissible: true, reason: report.paired.reason,
      cost: { requestMs: shadow.elapsedMs, referenceJobSumMs: report.paired.referenceMeasuredDurationMs,
        billedMoney: null, humanAttentionMs: null, actualSavedExecutionMs: 0 } });
  } catch (error) { report.reason = error.message; }
  return report;
}

async function main() {
  const [mode, outArg, member] = process.argv.slice(2);
  requireThat(outArg && ['begin', 'run', 'terminal', 'join'].includes(mode), 'usage: parallel.mjs begin|run|terminal|join OUTPUT [MEMBER]');
  const out = resolve(outArg); mkdirSync(out, { recursive: true });
  try {
    if (mode === 'begin') await begin(member, out);
    if (mode === 'run') process.exitCode = execute(member, out);
    if (mode === 'terminal') terminal(member, out);
    if (mode === 'join') {
      const expected = { headSha: line('rev-parse', 'HEAD'), treeSha: line('rev-parse', 'HEAD^{tree}'),
        runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) };
      const jobs = await jobsReadback(process.env, out), terminals = [];
      const inputRoot = process.env.LANE_INPUT;
      requireThat(inputRoot, 'TERMINAL_EVIDENCE_MISSING');
      for (const member of MEMBERS) {
        const path = join(inputRoot, `lane-a-separated-${expected.headSha}-${expected.runId}-${expected.attempt}-${member}`);
        if (existsSync(join(path, 'terminal.json'))) terminals.push(loadTerminal(path));
      }
      const report = joinTerminals(terminals, jobs, expected);
      put(join(out, 'join.json'), report); console.log(JSON.stringify(report));
      if (!report.pairAdmissible) process.exitCode = 2;
    }
  } catch (e) {
    const report = { schema: 'ops.winnowSeparateError.v1', phase: mode, member: member ?? null,
      result: 'UNKNOWN', observation: 'INCOMPLETE', pairAdmissible: false, reason: e.message,
      authority: false, effect: false, providerCalls: ['join', 'begin'].includes(mode) ? 0 : null, at: now() };
    put(join(out, `${mode}-error.json`), report); console.error(JSON.stringify(report)); process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
