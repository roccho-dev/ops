import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JEV_MODEL, parseJsonl } from '../lib/core.mjs';
import { askJev } from '../lib/jev.mjs';
import { BUILTIN_THEMES, review, structural } from './lint.mjs';

const cases = parseJsonl(fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8'));
assert.equal(cases.length,20);
const base = cases[0].design;
const alter = (fn) => { const d=structuredClone(base); fn(d); return d; };
const hardCases = [
  [null,'INVALID_DESIGN'],
  [alter((d)=>d.units.push(structuredClone(d.units[0]))),'DUPLICATE_ID'],
  [alter((d)=>d.units[0].in=['missing']),'MISSING_INPUT'],
  [alter((d)=>d.out=['missing']),'MISSING_RESULT'],
  [alter((d)=>d.units[0].in=['result']),'CYCLE'],
  [alter((d)=>d.units.push({...d.units[0],id:'extra',out:['unused']})),'UNUSED_UNIT'],
  [alter((d)=>d.units[0].out.push('unused')),'UNUSED_OUTPUT'],
  [alter((d)=>d.units.push({...d.units[0],id:'extra'})),'DUPLICATE_OUTPUT'],
  [alter((d)=>d.units[0].in.push('request')),'DUPLICATE_PORT'],
  [alter((d)=>d.in.push('unused')),'UNUSED_INPUT'],
];
let calls=0;
for (const [d,code] of hardCases) {
  assert.ok(structural(d).includes(code),code);
  await review(d,{topK:5},async()=>{calls++;throw new Error('MUST_NOT_CALL');});
}
assert.equal(calls,0);
for (const row of cases) assert.equal(structural(row.design).length===0,Boolean(row.theme),row.id);
await assert.rejects(()=>review(base,{topK:-1},null),/INVALID_TOP_K/);
await assert.rejects(()=>review(base,{topK:5,themes:[]},null),/INVALID_THEMES/);
await assert.rejects(()=>review(base,{topK:5,themes:[{id:'x',scope:'unknown',concern:'x'}]},null),/INVALID_THEMES/);
await assert.rejects(()=>review(alter((d)=>d.purpose='x'.repeat(40000)),{topK:5},async()=>{}),/budget exceeded/);

const questions={q:{type:'noul',instructions:'Is there a concern?'}}, payload={model:JEV_MODEL,answers:{q:{type:'noul',noul:.5}}};
const options={key:'fixture-only',endpoint:'https://example.invalid',timeoutMs:1000};
const mock=(body,ok=true)=>({...options,fetchImpl:async()=>({ok,status:503,json:async()=>body})});
for (const body of [{...payload,model:'other'},{...payload,answers:{}},{...payload,answers:{q:{type:'noul',noul:2}}},{...payload,answers:{q:{type:'choice',noul:1}}}]) await assert.rejects(()=>askJev(base,questions,mock(body)));
await assert.rejects(()=>askJev(base,questions,mock(payload,false)),/JEV_HTTP_503/);
await assert.rejects(()=>askJev(base,questions,{...mock(payload),key:''}),/KEY_REQUIRED/);
await assert.rejects(()=>askJev(base,questions,{...options,fetchImpl:async()=>{throw new Error('network');}}),/network/);
await assert.rejects(()=>askJev(base,questions,{...options,fetchImpl:async()=>({ok:true,json:async()=>{throw new Error('bad');}})}),/INVALID_JEV_JSON/);

const multi=structuredClone(cases.find((x)=>x.id==='classify-a').design);
const unitTheme={id:'domain-risk',scope:'unit',concern:'This unit may be risky.'};
const ranked=await review(multi,{topK:2,themes:[unitTheme]},async(state,qs)=>({answers:{'domain-risk':{type:'noul',noul:state.unit.id==='audit'?.9:state.unit.id==='ui'?.6:.1}}}));
assert.deepEqual(ranked.ranked[0].findings.map((x)=>x.subject),['unit:audit','unit:ui']);
assert.equal(ranked.ranked[0].findings.length,2);
assert.equal(ranked.calls,3);
assert.equal(Object.keys(BUILTIN_THEMES).includes('threshold'),false);
console.log(JSON.stringify({designContract:'PASS',cases:cases.length,hardCounterexamples:hardCases.length,mechanicalJevCalls:calls,thresholds:0,live:false}));
