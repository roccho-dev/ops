import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { PLAN, MEMBERS, PROSPECTIVE_JOB, prospectiveJobName, PROSPECTIVE_CONTROL, GO_MARKER, RELEASE_MARKER,
  assertAdmission, assertProspectiveAdmission, jobName, commandFor, timeoutFor, begin, execute, terminal,
  loadTerminal, joinTerminals, prospectiveBegin, prospectiveRun, prospectiveTerminal, loadProspectiveTerminal } from './parallel.mjs';
import { digest, REFERENCE_UNIVERSE, runWinnowRelevance } from './winnow.mjs';
const exec = promisify(execFile);
const clone = structuredClone;
const H = '1'.repeat(40), T = '2'.repeat(40), B = '3'.repeat(40);
const at = sec => new Date(Date.UTC(2026, 8, 30, 0, 0, sec)).toISOString();

async function fixture() {
  const input = { baseSha: B, headSha: H, changedPaths: ['packages/ci-relevance-shadow/parallel.mjs'], candidates: clone(REFERENCE_UNIVERSE), topK: 1 };
  const shadow = await runWinnowRelevance(input, { fetchImpl: async () => ({ ok: true, json: async () => ({
    model: 'winnow:e4b', answers: {q0:{type:'noul',noul:0.1},q1:{type:'noul',noul:0.9}} }) }) });
  // Synthetic transport label is fixture data ONLY; never emitted as live proof.
  shadow.executionKind = 'live-http';
  const source = { headSha: H, treeSha: T, parent: PLAN.parent, eventBaseSha: PLAN.base, baseSha: B, input, inputSha256: digest(input) };
  const jobs = {jobs: MEMBERS.map((member,i) => ({id: 100+i, name:jobName(member), run_id:10, run_attempt:1, head_sha:H,
    status:'completed',conclusion:'success',runner_id:200+i,runner_name:`runner-${i}`,labels:['ubuntu-24.04'],started_at:at(0),completed_at:at(30)}))};
  const terminals = MEMBERS.map((member,i) => ({schema:'ops.winnowSeparateTerminal.v1',member,authority:false,effect:false,result:'UNKNOWN',terminalAt:at(21),
    start:{schema:'ops.winnowSeparateStart.v1',member,source:clone(source),jobId:100+i,runId:10,attempt:1,
      planSha256:digest(PLAN),command:commandFor(member),timeoutSeconds:timeoutFor(member),start:at(1),
      runner:{id:200+i,name:`runner-${i}`,labels:['ubuntu-24.04']},authority:false,effect:false},
    execution:{start:at(2),end:at(20),durationMs:18000,command:commandFor(member),timeoutSeconds:timeoutFor(member),
      conclusion:'success',exitCode:0,signal:null,error:null,sourceAfter:clone(source)},
  }));
  Object.assign(terminals[0].execution,{shadow,report:{providerAttempts:1,attemptedReferenceChecks:0,observation:'PROVIDER_EXECUTED',authority:false,effect:false,
    provider:{loaded:{models:[{name:PLAN.model,digest:PLAN.manifestSha256,device:'cpu',size_vram:0}]},version:PLAN.version,manifestSha256:PLAN.manifestSha256,runtimeFiles:{archiveSha256:PLAN.archiveSha256,binarySha256:PLAN.binarySha256}}}});
  return {terminals,jobs,expected:{headSha:H,treeSha:T,runId:10,attempt:1}};
}
const paired = f => joinTerminals(f.terminals, f.jobs, f.expected, at(40));

test('pure terminal join is provider-free, exact, bounded and not an economic success', async () => {
  const f=await fixture(), original=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('network forbidden in join');};
  try {
    const result=paired(f);
    assert.equal(result.pairAdmissible,true,result.reason);
    assert.equal(result.result,'UNKNOWN');assert.equal(result.referenceKind,'bounded-ci-replay');
    assert.deepEqual(result.referenceUniverse,REFERENCE_UNIVERSE);
    assert.equal(result.providerCalls,0);assert.equal(result.cost.actualSavedExecutionMs,0);
    assert.equal(result.broaderLaneA,'UNFINISHED');assert.equal(result.authority,false);assert.equal(result.effect,false);
    assert.deepEqual(result.paired.observedOmittedFailures,[]);
  } finally {globalThis.fetch=original;}
});

test('completed reference failure is observed, not a semantic oracle',async()=>{
  const f=await fixture();f.jobs.jobs[1].conclusion='failure';Object.assign(f.terminals[1].execution,{conclusion:'failure',exitCode:1});
  const r=paired(f);assert.equal(r.pairAdmissible,true,r.reason);assert.deepEqual(r.paired.observedOmittedFailures,['cdp-tty-proof']);assert.equal(r.result,'UNKNOWN');
});

for (const [name,mutate,reason] of [
  ['missing terminal',f=>f.terminals.pop(),/TERMINAL_EVIDENCE_MISSING/],
  ['duplicate terminal',f=>{f.terminals[1]=f.terminals[0];},/TERMINAL_EVIDENCE_MISSING/],
  ['missing canonical job',f=>f.jobs.jobs.pop(),/JOB_EVIDENCE_MISSING/],
  ['duplicate canonical job',f=>f.jobs.jobs.push(f.jobs.jobs[0]),/JOB_EVIDENCE_MISSING/],
  ['in progress',f=>{f.jobs.jobs[2].status='in_progress';},/JOBS_NOT_TERMINAL/],
  ['terminal after join',f=>{f.jobs.jobs[1].completed_at=at(41);},/JOIN_BEFORE_TERMINAL/],
  ['wrong job commit',f=>{f.jobs.jobs[1].head_sha=B;},/JOB_SOURCE/],
  ['other run',f=>{f.jobs.jobs[1].run_id=11;},/JOB_SOURCE/],
  ['retry attempt',f=>{f.jobs.jobs[1].run_attempt=2;},/JOB_SOURCE/],
  ['expected retry',f=>{f.expected.attempt=2;},/EXACT_BINDING/],
  ['shared runner',f=>{f.jobs.jobs[1].runner_id=f.jobs.jobs[0].runner_id;},/SEPARATE_RUNNERS/],
  ['missing runner id',f=>{f.jobs.jobs[1].runner_id=null;},/SEPARATE_RUNNERS/],
  ['wrong runner labels',f=>{f.jobs.jobs[1].labels=['self-hosted'];},/SEPARATE_RUNNERS/],
  ['start missing',f=>{f.terminals[1].start=null;},/START_EVIDENCE_MISSING/],
  ['setup failure',f=>{f.terminals[1].execution=null;},/EXECUTION_EVIDENCE_MISSING/],
  ['effect granted',f=>{f.terminals[1].effect=true;},/AUTHORITY/],
  ['altered plan',f=>{f.terminals[1].start.planSha256='x';},/TERMINAL_JOB/],
  ['other job identity',f=>{f.terminals[1].start.jobId=900;},/TERMINAL_JOB/],
  ['all producers bound to a different tree',f=>{for(const t of f.terminals){t.start.source.treeSha=B;t.execution.sourceAfter.treeSha=B;}},/SOURCE_OR_TREE/],
  ['all producers actually share runner id',f=>{for(const t of f.terminals)t.start.runner.id=201;for(const j of f.jobs.jobs)j.runner_id=201;},/SEPARATE_RUNNERS/],
  ['wrong tree',f=>{f.terminals[1].start.source.treeSha=B;},/SOURCE_OR_TREE/],
  ['missing source after',f=>{delete f.terminals[1].execution.sourceAfter;},/SOURCE_OR_TREE/],
  ['wrong command',f=>{f.terminals[1].execution.command='echo pass';},/COMMAND_OR_TIMEOUT/],
  ['extended timeout',f=>{f.terminals[1].execution.timeoutSeconds=2400;},/COMMAND_OR_TIMEOUT/],
  ['clock inversion',f=>{f.terminals[1].execution.end=at(1);},/TIME_READBACK/],
  ['missing duration',f=>{delete f.terminals[1].execution.durationMs;},/TIME_READBACK/],
  ['infrastructure timeout',f=>Object.assign(f.terminals[1].execution,{conclusion:'timed_out',exitCode:124}),/EXECUTION_INCOMPLETE/],
  ['timeout mislabeled failure',f=>Object.assign(f.terminals[1].execution,{conclusion:'failure',exitCode:124}),/EXECUTION_INCOMPLETE/],
  ['cancelled job',f=>{f.jobs.jobs[1].conclusion='cancelled';},/EXECUTION_INCOMPLETE/],
  ['missing conclusion',f=>{f.jobs.jobs[1].conclusion=null;},/EXECUTION_INCOMPLETE/],
  ['signal',f=>{f.terminals[1].execution.signal='SIGTERM';},/EXECUTION_INCOMPLETE/],
  ['command absent',f=>Object.assign(f.terminals[1].execution,{conclusion:'failure',exitCode:127}),/EXECUTION_INCOMPLETE/],
  ['provider retried',f=>{f.terminals[0].execution.report.providerAttempts=2;},/PROVIDER_EXECUTION/],
  ['provider ran references',f=>{f.terminals[0].execution.report.attemptedReferenceChecks=2;},/PROVIDER_EXECUTION/],
  ['loaded runtime missing',f=>{delete f.terminals[0].execution.report.provider.loaded;},/PROVIDER_IDENTITY/],
  ['changed model',f=>{f.terminals[0].execution.report.provider.manifestSha256='a'.repeat(64);},/PROVIDER_IDENTITY/],
  ['mismatched exact input',f=>{f.terminals[0].execution.shadow.input.changedPaths=['other'];},/EXACT_INPUT/],
  ['fake transport',f=>{f.terminals[0].execution.shadow.executionKind='injected-transport';},/EXACT_INPUT/],
]) test(`reject: ${name}`,async()=>{const f=await fixture();mutate(f);const r=paired(f);assert.equal(r.pairAdmissible,false);assert.equal(r.result,'UNKNOWN');assert.match(r.reason,reason);assert.equal(r.providerCalls,0);});

test('admission is the frozen direct successor and attempt 1, not any future head',()=>{
  const admitted={head:H,parent:PLAN.parent,eventHead:H,eventName:'pull_request',action:'synchronize',pr:450,headRef:'proof/449-winnow-ci-relevance',attempt:1};
  assert.doesNotThrow(()=>assertAdmission(admitted));
  for (const change of [{parent:H},{eventHead:T},{eventName:'workflow_dispatch'},{action:'reopened'},{pr:451},{attempt:2},{headRef:'other'}])
    assert.throws(()=>assertAdmission({...admitted,...change}),/UNREGISTERED/);
});

test('terminal files preserve missing execution and detect changed bytes',()=>{
  const out=mkdtempSync(join(tmpdir(),'lane-a-terminal-'));
  try{
    writeFileSync(join(out,'setup.log'),'setup incomplete\n');terminal('provider',out,{LANE_JOB_STATUS:'failure'});
    const t=loadTerminal(out);assert.equal(t.reason,'SETUP_OR_EXECUTION_INCOMPLETE');assert.equal(t.execution,null);assert.equal(t.result,'UNKNOWN');
    const original=readFileSync(join(out,'terminal.json'),'utf8');terminal('provider',out);assert.equal(readFileSync(join(out,'terminal.json'),'utf8'),original);
    writeFileSync(join(out,'setup.log'),'forged\n');assert.throws(()=>loadTerminal(out),/EVIDENCE_BYTES_MISMATCH/);
  }finally{rmSync(out,{recursive:true,force:true});}
});

test('workflow producers have no mutual needs; join alone waits for both and cannot call Winnow',()=>{
  const w=readFileSync(new URL('../../.github/workflows/nix-check.yml',import.meta.url),'utf8');
  const provider=w.split('  lane-a-provider:\n')[1].split('  lane-a-reference:\n')[0];
  const reference=w.split('  lane-a-reference:\n')[1].split('  lane-a-join:\n')[0];
  const joinJob=w.split('  lane-a-join:\n')[1];
  for(const part of [provider,reference]){
    assert.ok(!part.includes('needs:'));assert.ok(part.includes('github.run_attempt == 1'));assert.ok(part.includes("github.event.action == 'synchronize'"));
    assert.ok(part.includes('ref: ${{ github.event.pull_request.head.sha }}'));assert.ok(part.includes('parallel.mjs begin'));assert.ok(part.includes('parallel.mjs terminal'));
    assert.ok(part.includes('if: always()'));assert.ok(!part.includes('continue-on-error: true'));
  }
  assert.ok(reference.includes('fail-fast: false'));assert.ok(reference.includes('member: [cdp-tty-proof, flake-check]'));
  assert.ok(joinJob.includes('needs: [lane-a-provider, lane-a-reference]'));assert.ok(joinJob.includes('if: always() &&'));
  assert.ok(joinJob.includes('parallel.mjs join'));assert.ok(!joinJob.includes('proof.mjs'));assert.ok(!joinJob.includes('/v1/systemone'));
  assert.ok(w.includes('proof.test.mjs packages/ci-relevance-shadow/parallel.test.mjs'));
});

test('provider-only process retains real Git binding but does not execute either reference',async()=>{
  const root=mkdtempSync(join(tmpdir(),'lane-a-provider-only-')),out=join(root,'out');let calls=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/version')return res.end(JSON.stringify({version:PLAN.version}));
    if(['/api/tags','/api/ps'].includes(req.url))return res.end(JSON.stringify({models:[{name:PLAN.model,digest:PLAN.manifestSha256}]}));
    let body='';for await(const c of req)body+=c;const request=JSON.parse(body);calls++;
    assert.ok(!body.includes('conclusion'));assert.deepEqual(request.state.candidates,REFERENCE_UNIVERSE);
    res.end(JSON.stringify({model:PLAN.model,answers:{q0:{type:'noul',noul:0.1},q1:{type:'noul',noul:0.9}}}));
  });
  try{
    mkdirSync(join(root,'packages/ci-relevance-shadow'),{recursive:true});mkdirSync(join(root,'.github/workflows'),{recursive:true});mkdirSync(out);
    for(const name of ['winnow.mjs','proof.mjs'])cpSync(new URL(`./${name}`,import.meta.url),join(root,'packages/ci-relevance-shadow',name));
    writeFileSync(join(root,'.github/workflows/nix-check.yml'),REFERENCE_UNIVERSE.map(x=>x.script).join('\n'));
    writeFileSync(join(root,'.gitignore'),'out/\n');
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
    git('init','-q');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-qm','base');
    const base=git('rev-parse','HEAD');writeFileSync(join(root,'change'),'one change');git('add','.');git('commit','-qm','change');
    writeFileSync(join(out,'runtime-files.json'),JSON.stringify({archiveSha256:PLAN.archiveSha256,binarySha256:PLAN.binarySha256}));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    await exec(process.execPath,['packages/ci-relevance-shadow/proof.mjs',out,'provider-only'],{cwd:root,env:{...process.env,WINNOW_PORT:String(server.address().port),PROOF_BASE:base,PROOF_HEAD:git('rev-parse','HEAD')}});
    const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
    assert.equal(calls,1);assert.equal(report.providerAttempts,1);assert.equal(report.attemptedReferenceChecks,0);assert.equal(report.observation,'PROVIDER_EXECUTED');
    assert.throws(()=>readFileSync(join(out,'reference.json')),/ENOENT/);assert.throws(()=>readFileSync(join(out,'paired.json')),/ENOENT/);
  }finally{await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});

for(const mode of ['success','timeout'])test(`separate reference process evidence roundtrip: ${mode}`,async()=>{
  // Fake Git/Nix identities are offline fixtures. The OS process and evidence I/O are real.
  const root=mkdtempSync(join(tmpdir(),'lane-a-envelope-')),out=join(root,'out'),bin=join(root,'bin');
  const cwd=process.cwd(),path=process.env.PATH,fetch=globalThis.fetch;
  try{
    mkdirSync(out);mkdirSync(bin);mkdirSync(join(root,'.github/workflows'),{recursive:true});
    writeFileSync(join(root,'.github/workflows/nix-check.yml'),REFERENCE_UNIVERSE.map(x=>x.script).join('\n'));
    writeFileSync(join(bin,'git'),`#!/bin/sh
case "$*" in
  'rev-parse HEAD') echo '${H}';;
  'rev-parse HEAD^{tree}') echo '${T}';;
  'rev-list --parents -n 1 HEAD') echo '${H} ${PLAN.parent}';;
  merge-base*) echo '${B}';;
  'diff --name-only'*) printf 'changed\\0';;
  'diff --binary'*) echo 'fixture diff';;
  'status --porcelain --untracked-files=no') :;;
  *) exit 99;;
esac
`,{mode:0o755});
    writeFileSync(join(bin,'nix-build'),`#!/bin/sh\necho fixture\nexit ${mode==='timeout'?124:0}\n`,{mode:0o755});
    const event=join(root,'event.json');writeFileSync(event,JSON.stringify({number:450,action:'synchronize',pull_request:{head:{sha:H,ref:'proof/449-winnow-ci-relevance'}}}));
    process.chdir(root);process.env.PATH=`${bin}:${path}`;
    globalThis.fetch=async url=>{assert.ok(url.endsWith('/actions/runs/10/attempts/1/jobs?per_page=100'));return{ok:true,text:async()=>JSON.stringify({total_count:1,jobs:[{name:jobName('cdp-tty-proof'),id:101,run_id:10,run_attempt:1,head_sha:H,runner_id:201,runner_name:'fixture-runner',labels:['ubuntu-24.04']}]})};};
    await begin('cdp-tty-proof',out,{GITHUB_EVENT_PATH:event,GITHUB_REPOSITORY:'roccho-dev/ops',GITHUB_EVENT_NAME:'pull_request',GITHUB_RUN_ID:'10',GITHUB_RUN_ATTEMPT:'1',RUNNER_NAME:'fixture-runner',RUNNER_OS:'Linux',RUNNER_ARCH:'X64',GH_TOKEN:'offline-fixture'});
    assert.equal(execute('cdp-tty-proof',out),mode==='success'?0:2);
    terminal('cdp-tty-proof',out,{LANE_JOB_STATUS:mode==='success'?'success':'failure'});
    const t=loadTerminal(out);assert.equal(t.execution.conclusion,mode==='success'?'success':'timed_out');
    assert.equal(t.execution.timeoutSeconds,1200);assert.equal(t.start.runner.id,201);assert.equal(t.start.source.treeSha,T);
    assert.equal(t.result,'UNKNOWN');assert.throws(()=>execute('cdp-tty-proof',out),/EEXIST/); // no second command
  }finally{process.chdir(cwd);process.env.PATH=path;globalThis.fetch=fetch;rmSync(root,{recursive:true,force:true});}
});

const formalEnvelope = (marker, value) => `<!-- ${marker}\n${JSON.stringify(value)}\n-->`;
const formalCommentUrl = id => `https://github.com/roccho-dev/ops/pull/450#issuecomment-${id}`;

function prospectiveRecords({ evaluatorSha, packetSha, packetBase64, baseSha, workflowSha,
  goId = 123, releaseId = 456, goMutate = x => x, releaseMutate = x => x, edited = null }) {
  const release = releaseMutate({ control: PROSPECTIVE_CONTROL, packetId: 'formal-pilot-1', packetSha256: packetSha, packetBase64 });
  const go = goMutate({ control: PROSPECTIVE_CONTROL, releaseCommentId: releaseId, releaseCommentUrl: formalCommentUrl(releaseId),
    packetSha256: packetSha, evaluatorSha, baseSha, workflowSha, attempt: 1, effectAuthority: false, skipAuthority: false });
  const stamp = '2026-10-01T00:00:00Z';
  const record = (id, body, which) => ({ id, issue_url: 'https://api.github.com/repos/roccho-dev/ops/issues/450',
    html_url: formalCommentUrl(id), created_at: stamp, updated_at: edited === which ? '2026-10-01T00:00:01Z' : stamp, body });
  return { goId, releaseId, go: record(goId, formalEnvelope(GO_MARKER, go), 'go'),
    release: record(releaseId, formalEnvelope(RELEASE_MARKER, release), 'release') };
}

async function prospectiveFixture({ goMutate, releaseMutate, edited, priorRun = false, brokenRuns = false } = {}) {
  const { createHash } = await import('node:crypto');
  const root = mkdtempSync(join(tmpdir(), 'lane-a-prospective-')), out = join(root, 'out'), bin = join(root, 'bin');
  const input = { baseSha: '4'.repeat(40), headSha: '5'.repeat(40), treeSha: '6'.repeat(40),
    changedPaths: ['formal.txt'], patches: [{ filename: 'formal.txt', patch: '@@ -1 +1 @@\n-before\n+after\n' }],
    beforeFacts: null, candidates: [
      { id: 'workflow-a/job-a', name: 'job-a' }, { id: 'workflow-b/job-b', name: 'job-b' }], topK: 1 };
  const bytes = Buffer.from(JSON.stringify(input)), packetSha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(out); mkdirSync(bin); mkdirSync(join(root, 'packages/ci-relevance-shadow'), { recursive: true });
  for (const name of ['proof.mjs', 'winnow.mjs'])
    cpSync(new URL('./' + name, import.meta.url), join(root, 'packages/ci-relevance-shadow', name));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '-qm', 'evaluator'); const evaluatorSha = git('rev-parse', 'HEAD');
  const baseSha = '7'.repeat(40), workflowSha = '8'.repeat(40), label = 'lane-a-go-123';
  const records = prospectiveRecords({ evaluatorSha, packetSha, packetBase64: bytes.toString('base64'), baseSha, workflowSha,
    goMutate, releaseMutate, edited });
  const event = join(root, 'event.json');
  writeFileSync(event, JSON.stringify({ action: 'labeled', number: 450, label: { name: label },
    pull_request: { head: { sha: evaluatorSha, ref: 'proof/449-winnow-ci-relevance' }, base: { sha: baseSha } } }));
  const env = { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'roccho-dev/ops',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '1', GITHUB_WORKFLOW_SHA: workflowSha,
    RUNNER_NAME: 'fixture-runner', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', GH_TOKEN: 'offline-fixture' };
  const oldFetch = globalThis.fetch, cwd = process.cwd(), oldPath = process.env.PATH;
  const jsonResponse = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
  globalThis.fetch = async url => {
    url = String(url);
    if (url.endsWith('/issues/comments/123')) return jsonResponse(records.go);
    if (url.endsWith('/issues/comments/456')) return jsonResponse(records.release);
    if (url.includes('/actions/workflows/nix-check.yml/runs?')) {
      if (brokenRuns) return { ok: false, status: 503, text: async () => 'unavailable' };
      const current = { id: 77, run_attempt: 1, head_sha: evaluatorSha, display_title: 'ordinary-pr-title', conclusion: null };
      const workflow_runs = priorRun ? [{ ...current, id: 66, conclusion: 'failure' }, current] : [current];
      return jsonResponse({ total_count: workflow_runs.length, workflow_runs });
    }
    if (url.endsWith('/actions/runs/66/attempts/1/jobs?per_page=100'))
      return jsonResponse({ total_count: 1, jobs: [{ name: prospectiveJobName(label), id: 801, run_id: 66, run_attempt: 1,
        head_sha: evaluatorSha, runner_id: 802, runner_name: 'prior-runner', labels: ['ubuntu-24.04'] }] });
    if (url.endsWith('/actions/runs/77/attempts/1/jobs?per_page=100'))
      return jsonResponse({ total_count: 1, jobs: [{ name: prospectiveJobName(label), id: 901, run_id: 77, run_attempt: 1,
        head_sha: evaluatorSha, runner_id: 902, runner_name: 'fixture-runner', labels: ['ubuntu-24.04'] }] });
    throw new Error('unexpected fetch ' + url);
  };
  process.chdir(root);
  return { root, out, bin, input, bytes, packetSha, evaluatorSha, baseSha, workflowSha, label, env, oldFetch, cwd, oldPath };
}

const cleanupProspective = f => {
  process.env.PATH = f.oldPath; globalThis.fetch = f.oldFetch; process.chdir(f.cwd);
  rmSync(f.root, { recursive: true, force: true });
};

test('prospective admission is labeled, exact, harness-bound and attempt-one only', () => {
  const admitted = { repository: 'roccho-dev/ops', eventName: 'pull_request', action: 'labeled', pr: 450,
    headRef: 'proof/449-winnow-ci-relevance', label: 'lane-a-go-123', attempt: 1,
    evaluatorSha: H, eventHead: H, actualHead: H, baseSha: B, eventBase: B,
    workflowSha: T, actualWorkflowSha: T, goCommentId: 123 };
  assert.doesNotThrow(() => assertProspectiveAdmission(admitted));
  for (const change of [
    { eventName: 'workflow_dispatch' }, { action: 'synchronize' }, { pr: 451 }, { headRef: 'proposals' },
    { label: 'lane-a-go-x' }, { attempt: 2 }, { eventHead: T }, { eventBase: H }, { actualWorkflowSha: H },
  ]) assert.throws(() => assertProspectiveAdmission({ ...admitted, ...change }), /PROSPECTIVE_/);
  assert.throws(() => assertAdmission({ head: H, parent: PLAN.parent, eventHead: H, eventName: 'pull_request',
    action: 'labeled', pr: 450, headRef: 'proof/449-winnow-ci-relevance', attempt: 1 }), /UNREGISTERED/);
});

test('prospective begin seals exact immutable GO/release records before provider execution', async () => {
  const f = await prospectiveFixture();
  try {
    await prospectiveBegin(f.out, f.env);
    const start = JSON.parse(readFileSync(join(f.out, 'start.json'), 'utf8'));
    const prepared = JSON.parse(readFileSync(join(f.out, 'prepared.json'), 'utf8'));
    assert.equal(start.evaluator.headSha, f.evaluatorSha); assert.equal(start.case.headSha, f.input.headSha);
    assert.equal(start.harness.baseSha, f.baseSha); assert.equal(start.harness.workflowSha, f.workflowSha);
    assert.equal(start.activation.goCommentId, 123); assert.equal(start.activation.releaseCommentId, 456);
    assert.equal(start.activation.label, f.label); assert.equal(start.jobName, prospectiveJobName(f.label));
    assert.match(start.activation.goBody, new RegExp(GO_MARKER)); assert.match(start.activation.releaseBody, new RegExp(RELEASE_MARKER));
    assert.deepEqual(JSON.parse(readFileSync(join(f.out, 'packet.json'), 'utf8')), f.input);
    const modelVisible = JSON.stringify(prepared.request);
    assert.ok(!modelVisible.includes(GO_MARKER)); assert.ok(!modelVisible.includes(RELEASE_MARKER));
    assert.ok(!modelVisible.includes('effectAuthority')); assert.ok(!modelVisible.includes('releaseCommentId'));
  } finally { cleanupProspective(f); }
});

for (const [name, options, expected] of [
  ['edited GO', { edited: 'go' }, /FORMAL_COMMENT_EDITED/],
  ['edited release', { edited: 'release' }, /FORMAL_COMMENT_EDITED/],
  ['GO release digest mismatch', { releaseMutate: x => ({ ...x, packetSha256: 'a'.repeat(64) }) }, /RELEASE_PACKET_MISMATCH/],
  ['reused activation after failed prior run', { priorRun: true }, /FORMAL_ACTIVATION_REUSED/],
  ['missing run-history readback', { brokenRuns: true }, /RUN_HISTORY_HTTP_503/],
]) test(`prospective begin rejects ${name} before provider`, async () => {
  const f = await prospectiveFixture(options);
  try { await assert.rejects(prospectiveBegin(f.out, f.env), expected);
    assert.throws(() => readFileSync(join(f.out, 'execution.json')), /ENOENT/);
    assert.throws(() => readFileSync(join(f.out, 'provider', 'shadow.json')), /ENOENT/);
  } finally { cleanupProspective(f); }
});

test('prospective provider evidence binds evaluator and released packet, seals once and never runs a reference', async () => {
  const f = await prospectiveFixture();
  const calls = join(f.root, 'timeout-calls');
  const fakeTimeout = `#!/usr/bin/env node
const fs=require('fs'),crypto=require('crypto');
const a=process.argv.slice(2),out=a[4],packet=a[6],sha=a[7];
fs.mkdirSync(out,{recursive:true});
const input=JSON.parse(fs.readFileSync(packet,'utf8'));
const inputSha=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
const manifest=${JSON.stringify(PLAN.manifestSha256)},archive=${JSON.stringify(PLAN.archiveSha256)},binary=${JSON.stringify(PLAN.binarySha256)},model=${JSON.stringify(PLAN.model)},version=${JSON.stringify(PLAN.version)};
const shadow={executionKind:'live-http',input};
const report={providerAttempts:1,attemptedReferenceChecks:0,completedReferenceChecks:0,observation:'PROVIDER_EXECUTED',authority:false,effect:false,referenceKind:null,pairAdmissible:false,comparisonOwner:'product-r',inputBytesSha256:sha,inputSha256:inputSha,provider:{version,manifestSha256:manifest,runtimeFiles:{archiveSha256:archive,binarySha256:binary},loaded:{models:[{name:model,digest:manifest,device:'cpu',size_vram:0}]}}};
fs.writeFileSync(out+'/shadow.json',JSON.stringify(shadow)+'\\n',{flag:'wx'});
fs.writeFileSync(out+'/report.json',JSON.stringify(report)+'\\n',{flag:'wx'});
fs.appendFileSync(${JSON.stringify(calls)},'one\\n');
`;
  writeFileSync(join(f.bin, 'timeout'), fakeTimeout, { mode: 0o755 });
  try {
    await prospectiveBegin(f.out, f.env);
    globalThis.fetch = f.oldFetch; process.env.PATH = `${f.bin}:${f.oldPath}`;
    const packet = join(f.out, 'packet.json');
    assert.equal(prospectiveRun(f.out, packet), 0);
    prospectiveTerminal(f.out, { LANE_JOB_STATUS: 'success' });
    const terminal = loadProspectiveTerminal(f.out);
    assert.equal(readFileSync(calls, 'utf8'), 'one\n'); assert.equal(terminal.sealed, true);
    assert.equal(terminal.observation, 'PROVIDER_OUTPUT_SEALED'); assert.equal(terminal.result, 'UNKNOWN');
    assert.equal(terminal.comparisonOwner, 'product-r'); assert.equal(terminal.authority, false);
    assert.deepEqual(terminal.execution.shadow.input, f.input);
    assert.throws(() => readFileSync(join(f.out, 'provider/reference.json')), /ENOENT/);
    assert.throws(() => readFileSync(join(f.out, 'provider/paired.json')), /ENOENT/);
    assert.throws(() => prospectiveRun(f.out, packet), /EEXIST/);
    assert.equal(readFileSync(calls, 'utf8'), 'one\n');
  } finally { cleanupProspective(f); }
});
