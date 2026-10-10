import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,question,askSplit,sessionContract,projectBody} from './split.mjs';
const request={text:JSON.stringify({purpose:'task',complete:true,body:'完成状態を宣言する本文',comments:[]}),instructions:'本文とコメントを区別する。',criteria:{}};
for(const [e,o,wanted] of [['yes','yes','body_observation'],['yes','no','ok'],['no','yes','expectation_missing'],['no','no','unknown']]) {
  test(`fixed map ${e}/${o}`,()=>assert.equal(classify(e,o),wanted));
}
for(const [e,o] of [['unknown','yes'],['yes',null],[true,'yes'],['no','invented']]) {
  test(`reject invalid binary ${String(e)}/${String(o)}`,()=>assert.throws(()=>classify(e,o)));
}
test('two model calls and traces; independent prompts; no input mutation',async()=>{
  const before=structuredClone(request),trace=[],sent=[];let count=0;
  const r=await askSplit(request,async q=>{sent.push(q);return {label:++count===1?'yes':'no',model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:2}};},trace);
  assert.equal(r.label,'ok');assert.equal(count,2);assert.equal(trace.length,2);
  assert.deepEqual(r.usage,{input_tokens:20,output_tokens:4});
  assert.deepEqual(request,before);assert.notEqual(sent[0].instructions,sent[1].instructions);
  assert.equal(sent[0].text,request.text);assert.equal(sent[1].text,request.text);
});
test('model drift aborts before second call',async()=>{
  let count=0;await assert.rejects(()=>askSplit(request,async()=>{count++;return {label:'yes',model:'different'};},[]),/MODEL_CHANGED/);assert.equal(count,1);
});
test('bad answer cannot be mapped to success',async()=>{
  let count=0;await assert.rejects(()=>askSplit(request,async()=>{count++;return {label:'maybe',model:'jev-1.13.0'};},[]),/INVALID_ANSWER/);assert.equal(count,1);
});
test('provider error is not retried or interpreted',async()=>{
  let count=0;await assert.rejects(()=>askSplit(request,async()=>{count++;throw Error('test infrastructure');},[]));assert.equal(count,1);
});
test('second call failure retains first trace',async()=>{
  const trace=[];let count=0;
  await assert.rejects(()=>askSplit(request,async()=>{if(++count===2)throw Error('test');return {label:'yes',model:'jev-1.13.0'};},trace));
  assert.equal(count,2);assert.equal(trace.length,1);
});
test('declared incomplete input routes to unknown without model calls',async()=>{
  const r=await askSplit({...request,text:JSON.stringify({purpose:'task',complete:false})},()=>assert.fail('must not call'),[]);assert.equal(r.label,'unknown');
});
test('declared archive is not applicable without model calls',async()=>{
  const r=await askSplit({...request,text:JSON.stringify({purpose:'historical-record',complete:true})},()=>assert.fail('must not call'),[]);assert.equal(r.label,'not_applicable');
});
test('session changes budget and treatment, not labels/data/Gold/targets',()=>{
  const old={task:'fixed',labels:{ok:'expected'},casesSha256:'cases',goldSha256:'gold',target:{correct:8},maxCallsPerCandidate:8};
  const next=sessionContract(old);assert.notEqual(next.task,old.task);assert.equal(next.maxCallsPerCandidate,16);
  for(const k of ['labels','casesSha256','goldSha256','target'])assert.deepEqual(next[k],old[k]);assert.equal(old.maxCallsPerCandidate,8);
});
test('invalid axis rejected',()=>assert.throws(()=>question(request,'other')));

test('body projection excludes comments and preserves raw body including HTML',()=>{
  const input={...request,text:JSON.stringify({purpose:'task',complete:true,body:'要件\n<!-- 観測 -->',comments:['COMMENT_CANARY']})};
  const before=structuredClone(input),p=projectBody(input);
  assert.deepEqual(JSON.parse(p.text),{body:'要件\n<!-- 観測 -->'});
  assert.equal(p.text.includes('COMMENT_CANARY'),false);assert.deepEqual(input,before);
});
test('body-only E/O sends neither comments nor metadata to either model call',async()=>{
  const input={...request,text:JSON.stringify({purpose:'task',complete:true,body:'要件',comments:['COMMENT_CANARY']})},sent=[],trace=[];
  const result=await askSplit(input,async q=>{sent.push(q);return {label:sent.length===1?'yes':'no',model:'jev-1.13.0'};},trace,{bodyOnly:true});
  assert.equal(result.label,'ok');assert.equal(sent.length,2);
  for(const q of sent) assert.deepEqual(JSON.parse(q.text),{body:'要件'});
  assert.equal(JSON.stringify(trace).includes('COMMENT_CANARY'),false);
});
test('body-only projection cannot silently invent a missing body',()=>{
  assert.throws(()=>projectBody({...request,text:'{}'}),/INVALID_BODY/);
});
