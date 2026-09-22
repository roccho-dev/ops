import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { JEV_MODEL } from '../../jev-review/core.mjs';
import { DAG_THEMES,evaluateDag,validateDagInput } from './evaluate.mjs';
import { runDagFile } from './run.mjs';
const base={contract:{purpose:'Help customers finish setup.',acceptance:['Setup completion is independently observed.'],constraints:['Do not claim completion before readback.']},world:{snapshot:'fixture-v1',facts:['The remaining setup step is known.']},dag:{nodes:[{id:'guide',actor:'product',action:'Show the customer the next required setup step.'},{id:'complete',actor:'customer',action:'Complete the required setup step.'},{id:'observe',actor:'system',action:'Read back whether setup completed.'}],edges:[{from:'guide',to:'complete',reason:'The customer needs the step before acting.'},{from:'complete',to:'observe',reason:'Completion must happen before observation.'}]}};
validateDagInput(base);validateDagInput({...base,world:{snapshot:'fixture-v1',facts:[]}});
const before=JSON.parse(JSON.stringify(base));let calls=0;
const ask=async(_,questions)=>{calls++;return{model:JEV_MODEL,answers:Object.fromEntries(Object.keys(questions).map((key,index)=>[key,{type:'noul',noul:(index+1)/20}]))};};
const result=await evaluateDag(base,ask);assert.equal(calls,1);assert.deepEqual(base,before);assert.equal(result.findings.length,15);assert.deepEqual(new Set(result.findings.map((r)=>r.theme)),new Set(DAG_THEMES.map((t)=>t.id)));assert.equal(Object.hasOwn(result,'accepted'),false);
let hardCalls=0;const never=async()=>{hardCalls++;throw new Error('JEV_SHOULD_NOT_RUN');};
for(const mutate of[(x)=>x.dag.edges.push({from:'observe',to:'guide',reason:'cycle'}),(x)=>{x.dag.edges[0]={from:'missing',to:'complete',reason:'missing'};},(x)=>x.dag.nodes.push({...x.dag.nodes[0]}),(x)=>x.dag.edges.push({...x.dag.edges[0]})]){const value=JSON.parse(JSON.stringify(base));mutate(value);const out=await evaluateDag(value,never);assert.ok(out.hard.length>0);assert.equal(out.calls,0);}assert.equal(hardCalls,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dag-eval-'));try{const input=path.join(dir,'input.json'),output=path.join(dir,'output.jsonl');fs.writeFileSync(input,JSON.stringify(base));const fileResult=await runDagFile(input,output,ask);assert.equal(fileResult.kind,'dagSemanticEvaluation.v1');const rows=fs.readFileSync(output,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].authority,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
assert.throws(()=>validateDagInput({...base,extra:true}),/INVALID_DAG_EVALUATION/);
await assert.rejects(()=>evaluateDag(base,async(_,questions)=>({model:JEV_MODEL,answers:Object.fromEntries(Object.keys(questions).slice(1).map((key)=>[key,{type:'noul',noul:.5}]))})),/INVALID_JEV_ANSWERS/);
console.log(JSON.stringify({dagSemanticEvaluationContract:'PASS',fileHowTo:'PASS',themes:DAG_THEMES.map((t)=>t.id),semanticThresholds:0,admissionAuthority:false}));
