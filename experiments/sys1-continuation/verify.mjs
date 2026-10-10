import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hash,remaining,reserve,settle} from './progress.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
export function verifyReceipt(receipt,plan,state,datasets) {
  assert.ok(['ops.sys1.portability-receipt.v1','ops.sys1.alternate-model-receipt.v1'].includes(receipt.schema));
  assert.equal(receipt.planDigest,hash(plan));
  assert.equal(receipt.id,plan.id);
  assert.equal(receipt.results.length,plan.suites.length);
  assert.equal(receipt.model,plan.expectedModel);
  assert.notEqual(receipt.secondRealModel,true);
  assert.notEqual(receipt.crossModelComparisonIncluded,true);
  assert.equal(receipt.independentHoldout,false);
  assert.equal(receipt.autonomousRestartProven,false);
  assert.equal(receipt.productionAdoption,false);
  const totals={calls:0,input:0,output:0};
  receipt.results.forEach((result,i)=>{
    const dataset=datasets[i],spec=plan.suites[i];
    assert.equal(hash(dataset.inputs),spec.inputsDigest);
    assert.equal(hash(dataset.goldText),spec.goldDigest);
    assert.equal(result.inputsDigest,spec.inputsDigest);
    assert.equal(result.core,spec.core);
    const gold=dataset.goldText.trim().split('\n').map(JSON.parse);
    assert.deepEqual(result.rows.map(x=>x.id),dataset.inputs.map(x=>x.id));
    assert.equal(gold.length,result.rows.length);
    assert.equal(new Set(gold.map(x=>x.id)).size,gold.length);
    let correct=0;
    for(const row of result.rows){
      const expected=gold.find(g=>g.id===row.id);
      assert.ok(expected);
      assert.equal(row.expected,expected.label);
      if(row.prediction===expected.label)correct++;
      assert.ok(['model','declared-input'].includes(row.source));
      for(const k of ['calls','inputTokens','outputTokens'])assert.ok(Number.isSafeInteger(row[k])&&row[k]>=0);
      if(row.source==='declared-input'){assert.equal(row.calls,0);assert.equal(row.inputTokens,0);assert.equal(row.outputTokens,0);}
      else assert.ok(row.calls>0);
      totals.calls+=row.calls;totals.input+=row.inputTokens;totals.output+=row.outputTokens;
    }
    assert.equal(result.correct,correct);
    assert.equal(result.total,gold.length);
    assert.equal(result.errors,0);
  });
  assert.equal(totals.calls,receipt.accounting.calls);
  assert.equal(totals.input,receipt.accounting.usage.input_tokens);
  assert.equal(totals.output,receipt.accounting.usage.output_tokens);
  assert.equal(receipt.accounting.cost,null);
  const settled=state.runs[plan.id],url=receipt.runUrl+'/job/'+receipt.jobId;
  assert.equal(settled.receipt,url);
  assert.equal(settled.actual,totals.calls);
  assert.equal(settled.status,'settled');
  assert.deepEqual(settle(state,plan.id,hash(plan),totals.calls,url),state);
  assert.equal(reserve(state,plan.id,hash(plan),plan.maxCalls).dispatch,false);
  return {receiptVerified:true,cores:receipt.results.map(x=>({core:x.core,correct:x.correct,total:x.total})),
    calls:totals.calls,previous:state.previous,remaining:remaining(state),modelCallsForThisVerification:0,
    p3Verified:false,p4AutonomousLoopProven:false,crossModelComparisonIncluded:false};
}
export function loadEvidence(){
  const read=p=>fs.readFileSync(path.resolve(ROOT,p),'utf8');
  const json=p=>JSON.parse(read(p));
  return {receipt:json('results/portability-v1.json'),plan:json('plan.json'),state:json('state.json'),
    datasets:[{inputs:read('../sys1-eval-loop/cases.jsonl').trim().split('\n').map(JSON.parse).map(({id,...input})=>({id,input})),goldText:read('../sys1-eval-loop/expected.jsonl')},
      {inputs:read('suites/dirtree-overlap/cases.jsonl').trim().split('\n').map(JSON.parse),goldText:read('suites/dirtree-overlap/expected.jsonl')}]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const x=loadEvidence();console.log('CONTINUATION_RECEIPT_VERIFIED '+JSON.stringify(verifyReceipt(x.receipt,x.plan,x.state,x.datasets)));
}
