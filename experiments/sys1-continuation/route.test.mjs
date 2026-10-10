import test from 'node:test';
import assert from 'node:assert/strict';
import {routeCore,inputsFor,selections} from './cores/route.mjs';
const cases=[{id:'g1',goal:'sample'}],catalog=[{id:'c1',when:'one'},{id:'c2',when:'two'}];
const rows=labels=>inputsFor(cases,catalog).map((x,i)=>({id:x.id,status:'ok',output:{label:labels[i]}}));
test('Cartesian selection does not execute Core functions',()=>{
  let effects=0;const result=inputsFor(cases,catalog.map(x=>({...x,run:()=>effects++})));
  assert.equal(result.length,2);assert.equal(effects,0);
});
for(const [labels,selected,status] of [
  [['skip','skip'],[],'NO_CATALOG_MATCH'],[['apply','skip'],['c1'],'SELECTED'],[['apply','apply'],['c1','c2'],'SELECTED']
])test('0..N selection '+labels.join(','),()=>{const r=selections(cases,catalog,rows(labels))[0];assert.deepEqual(r.selected,selected);assert.equal(r.status,status);assert.equal(r.executionAuthorized,false);assert.equal(r.discoveryComplete,false);});
test('unknown is not silently converted to skip',()=>{const r=selections(cases,catalog,rows(['unknown','unknown']))[0];assert.deepEqual(r.unknown,['c1','c2']);assert.equal(r.status,'NEEDS_CONTEXT');});
test('partial selection retains unresolved capabilities',()=>{const r=selections(cases,catalog,rows(['apply','unknown']))[0];assert.deepEqual(r.selected,['c1']);assert.deepEqual(r.unknown,['c2']);assert.equal(r.status,'NEEDS_CONTEXT');});
test('missing, duplicate and stale rows rejected',()=>{assert.throws(()=>selections(cases,catalog,rows(['skip','skip']).slice(1)));const r=rows(['skip','skip']);r[1].id=r[0].id;assert.throws(()=>selections(cases,catalog,r));});
test('runtime failure never means no applicable Core',()=>{const r=rows(['skip','skip']);r[0]={id:r[0].id,status:'error'};assert.equal(selections(cases,catalog,r)[0].status,'EVALUATION_ERROR');});
test('invalid predicted label rejected',()=>assert.throws(()=>selections(cases,catalog,rows(['invented','skip']))));
test('duplicate catalog IDs and malformed goals rejected',()=>{assert.throws(()=>inputsFor(cases,[catalog[0],catalog[0]]));assert.throws(()=>inputsFor([{id:'g1',goal:''}],catalog));});
test('question exposes neither case identity nor arbitrary executable fields',async()=>{
  let sent;const input={goal:'current goal',capability:{id:'c1',when:'one',secret:'DO_NOT_SEND'}};
  const before=structuredClone(input);
  const result=await routeCore.run(input,{which:async q=>{sent=q;return {label:'skip'};}});
  assert.equal(sent.text,input.goal);assert.ok(sent.criteria.apply.includes('one'));assert.equal(JSON.stringify(sent).includes('DO_NOT_SEND'),false);
  assert.deepEqual(input,before);assert.deepEqual(result,{label:'skip'});
});
test('model failure propagates, is not retried',async()=>{let calls=0;await assert.rejects(()=>routeCore.run({goal:'x',capability:catalog[0]},{which:async()=>{calls++;throw Error('test');}}));assert.equal(calls,1);});
test('choice outside contract cannot be selected',async()=>{await assert.rejects(()=>routeCore.run({goal:'x',capability:catalog[0]},{which:async()=>({label:'invented'})}));});
