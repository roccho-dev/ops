import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadEvidence,verifyReceipt} from './verify.mjs';
import {hash,remaining} from './progress.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
export function compareModels(base,other,otherPlan) {
  verifyReceipt(base.receipt,base.plan,base.state,base.datasets);
  verifyReceipt(other,otherPlan,base.state,base.datasets);
  assert.notEqual(base.receipt.model,other.model);
  assert.deepEqual(base.plan.suites,otherPlan.suites);
  assert.equal(base.plan.frozenCandidateDigest,otherPlan.frozenCandidateDigest);
  assert.equal(other.runtime.archiveSha256,otherPlan.runtime.archiveSha256);
  assert.equal('v'+other.runtime.version,otherPlan.runtime.tag);
  assert.match(other.runtime.modelDigest,/^[a-f0-9]{64}$/);
  assert.equal(other.runtime.device,'cpu');
  const rows=base.receipt.results.map((a,i)=>{
    const b=other.results[i];
    assert.deepEqual(a.rows.map(x=>x.id),b.rows.map(x=>x.id));
    return {core:a.core,total:a.total,baseline:a.correct,alternate:b.correct,
      regressed:a.rows.filter((r,j)=>r.prediction===r.expected&&b.rows[j].prediction!==r.expected).map(x=>x.id),
      improved:a.rows.filter((r,j)=>r.prediction!==r.expected&&b.rows[j].prediction===r.expected).map(x=>x.id)};
  });
  const noRegression=rows.every(x=>x.regressed.length===0);
  return {schema:'ops.sys1.model-comparison.v1',baseline:base.receipt.model,alternate:other.model,
    baselineEvidence:hash(base.receipt),alternateEvidence:hash(other),
    sameInputsAndGold:true,sameFrozenCandidate:true,rows,
    exchangeExecutionVerified:true,qualityEquivalentOnTheseCases:noRegression&&rows.every(x=>x.baseline===x.alternate),
    retainBaseline:!noRegression,remaining:remaining(base.state),
    liveCallsInVerification:0,independentHoldout:false,productionAdoption:false,
    scope:'different model binding with unchanged Core meaning; development fixtures only'};
}
export function loadModelComparison(){
  const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
  return {base:loadEvidence(),other:read('results/ollaya-v1.json'),otherPlan:read('ollaya-plan.json')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const x=loadModelComparison();console.log('MODEL_COMPARISON_VERIFIED '+JSON.stringify(compareModels(x.base,x.other,x.otherPlan)));
}
