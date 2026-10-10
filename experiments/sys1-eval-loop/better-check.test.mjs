import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadInput,requestFor,score,compare,digest} from './run.mjs';

const root=new URL('./',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const observation=JSON.parse(read('results/better-check-20261010.json'));
const goldText=read('suites/role-boundaries/expected.jsonl');
const gold=goldText.trim().split('\n').map(JSON.parse);
const evaluator=fs.readFileSync(new URL('run.mjs',root));
const evaluatorBlob=createHash('sha1').update(`blob ${evaluator.length}\0`).update(evaluator).digest('hex');

// Recalculate the retained projection. This cannot independently authenticate the
// cited GitHub log, prove actual wire payloads, or turn development Gold into Holdout.
function checkProjection(record) {
  assert.equal(record.schema,'ops.sys1.better-check-observation.v1');
  assert.equal(record.evaluatorBlob,evaluatorBlob);
  assert.equal(record.goldDigest,digest(goldText));
  const reports=['baseline','candidate'].map(name=>{
    const phase=record[name];
    assert.match(phase.candidateId,/^[a-z][a-z0-9-]{0,39}$/);
    const input=loadInput(new URL('candidates/'+phase.candidateId+'.json',root),
      new URL('suites/role-boundaries/',root).pathname);
    assert.equal(record.contractDigest,input.contractDigest);
    assert.equal(record.casesDigest,input.contract.casesSha256);
    assert.equal(record.goldDigest,input.contract.goldSha256);
    assert.equal(record.maxTotalCalls,input.contract.maxTotalCalls);
    assert.equal(phase.candidateDigest,digest(input.candidate));
    assert.equal(phase.actualCalls,input.contract.caseCount);
    assert.ok(phase.actualCalls<=input.contract.maxCallsPerCandidate);
    assert.equal(phase.rows.length,input.contract.caseCount);
    const rows=phase.rows.map(row=>{
      assert.equal(row.status,'ok');
      assert.equal(row.model,input.contract.expectedModel);
      assert.ok(Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0);
      const c=input.cases.find(c=>c.id===row.id);
      assert.ok(c);
      return {...row,request:requestFor(c,input.candidate,input.contract)};
    });
    const predictions={schema:'ops.sys1.predictions.v1',mode:'live',sourceSha:record.sourceSha,
      runUrl:record.runUrl,contractDigest:input.contractDigest,casesDigest:input.contract.casesSha256,
      candidateDigest:phase.candidateDigest,candidateId:phase.candidateId,modelAlias:input.contract.modelAlias,
      actualCalls:phase.actualCalls,rows};
    const calculated=score(input,gold,predictions);
    for (const key of ['actualCalls','correct','falsePositives','falseNegatives','errors','targetReached','usage']) {
      assert.deepEqual(calculated[key],phase[key]);
    }
    assert.equal(calculated.status,'EVALUATED');
    assert.equal(calculated.qualityAdoptionAuthorized,false);
    return calculated;
  });
  const paired=compare(...reports);
  assert.deepEqual(paired,record.comparison);
  assert.equal(record.actualCalls,reports.reduce((n,r)=>n+r.actualCalls,0));
  assert.equal(record.actualCalls,record.maxTotalCalls);
  assert.equal(paired.targetReached,false);
  assert.equal(record.stop,'STOP_BUDGET');
  assert.equal(record.developmentFreeze,null);
  assert.equal(record.cost,null);
  assert.equal(record.independentQuality,'NOT_PROVEN');
  assert.equal(record.externalSys2Resume,'NOT_PROVEN');
  assert.equal(record.wholeIssueComplete,false);
  assert.equal(record.qualityAdoptionAuthorized,false);
  return paired;
}

test('retained live pair recomputes from fixed Gold with the regression preserved',()=>{
  const result=checkProjection(observation);
  assert.equal(result.best,observation.baseline.candidateDigest);
});

for (const [name,change] of [
  ['changed evaluator',r=>r.evaluatorBlob='0'.repeat(40)],
  ['changed corpus',r=>r.casesDigest='0'.repeat(64)],
  ['changed Gold',r=>r.goldDigest='0'.repeat(64)],
  ['changed candidate',r=>r.candidate.candidateDigest='0'.repeat(64)],
  ['missing case',r=>r.candidate.rows.pop()],
  ['duplicate case',r=>r.candidate.rows[1]=structuredClone(r.candidate.rows[0])],
  ['model drift',r=>r.candidate.rows[0].model='different-model'],
  ['unexecuted result credited',r=>r.candidate.rows[0].status='not_run'],
  ['unsupported answer',r=>r.candidate.rows[0].prediction='PASS'],
  ['inflated correctness',r=>r.candidate.correct=8],
  ['erased regression',r=>r.comparison.regressed=[]],
  ['incorrect Best promotion',r=>r.comparison.best=r.candidate.candidateDigest],
  ['hidden calls',r=>r.actualCalls=0],
  ['larger allowance',r=>r.maxTotalCalls=32],
  ['unknown cost called free',r=>r.cost=0],
  ['false Freeze',r=>r.developmentFreeze=r.candidate.candidateDigest],
  ['self-evaluation called independent',r=>r.independentQuality='PASS'],
  ['manual restart called autonomous',r=>r.externalSys2Resume='PASS'],
  ['trial stop called Issue completion',r=>r.wholeIssueComplete=true],
]) {
  test('refuse '+name,()=>{
    const changed=structuredClone(observation); change(changed);
    assert.throws(()=>checkProjection(changed));
  });
}
