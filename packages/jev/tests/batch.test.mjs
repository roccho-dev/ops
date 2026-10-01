import assert from "node:assert/strict";
import fs from "node:fs";
import {test} from "node:test";
const entry = process.env.JEV_PROVIDER_ENTRY ?? new URL("../src/batch.mjs",import.meta.url);
const {judgeNamedChoices,JudgeProviderError} = await import(entry);

const request = {state:{text:"fixture"},questions:{first:{instruction:"Choose",options:{NONE:"none",A:"option"}},second:{instruction:"Choose",options:{NONE:"none",B:"option"}}}};
const data = () => ({model:"synthetic-model-canary",extra:"allowed",answers:{first:{type:"choice",choice:"A",confidence:0.2},second:{type:"choice",choice:"NONE",confidence:1,probabilities:{NONE:2}}}});
const key = "synthetic-key-canary";
const invoke = (body, extra={}) => judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:true,json:async()=>body}),...extra});
const refuse = (fn,code) => assert.rejects(fn,e=>e instanceof JudgeProviderError && e.code===code && e.message===code);

test("one named batch POST, neutral descriptors and model discard",async()=>{
  let calls=0;
  const result=await judgeNamedChoices({request,apiKey:key,fetch:async(url,init)=>{
    calls++; assert.equal(init.method,"POST"); assert.equal(init.headers.authorization,"Bearer "+key);
    assert.equal(new URL(url).hostname,"api.typesafe.ai");
    const wire=JSON.parse(init.body);assert.deepEqual(wire.state,request.state);
    assert.deepEqual(Object.keys(wire.questions),["first","second"]);
    assert.deepEqual(wire.questions.first,{type:"choice",criteria:request.questions.first.options,instructions:"Choose"});
    return {ok:true,json:async()=>data()};
  }});
  assert.equal(calls,1);assert.deepEqual(result,{answers:{first:{choice:"A",confidence:0.2},second:{choice:"NONE",confidence:1,probabilities:{NONE:2}}}});
  assert.ok(!JSON.stringify(result).includes("canary"));
});
test("compatibility: optional/subset finite probabilities and endpoint confidence",async()=>{
  for(const confidence of [0,0.49,0.5,1]){const x=data();x.answers.first.confidence=confidence;await invoke(x);}
  for(const probabilities of [{},{A:-2},{NONE:2,A:0}]){const x=data();x.answers.first.probabilities=probabilities;await invoke(x);}
  const x=data();x.model="";await invoke(x);
});
test("generic envelope/answer/choice contract refuses without raw detail",async()=>{
  const mutations=[
    x=>{delete x.model;},x=>{x.model={};},x=>{x.answers=null;},
    x=>{delete x.answers.second;},x=>{x.answers.extra=x.answers.first;},
    x=>{x.answers.first.extra="synthetic-body-canary";},x=>{x.answers.first.type="other";},
    x=>{x.answers.first.choice="unoffered";},x=>{x.answers.first.confidence=-0.1;},
    x=>{x.answers.first.confidence=1.1;},x=>{x.answers.first.confidence=NaN;},
    x=>{x.answers.first.probabilities=null;},x=>{x.answers.first.probabilities={unoffered:1};},
    x=>{x.answers.first.probabilities={A:Infinity};},
  ];
  for(const mutate of mutations){const x=data();mutate(x);await refuse(()=>invoke(x),"provider_contract_error");}
});
test("invalid descriptors and missing auth perform no fetch",async()=>{
  let calls=0;const fetch=async()=>{calls++;throw Error("must not call");};
  await refuse(()=>judgeNamedChoices({request,fetch}),"auth_missing");
  for(const bad of [null,{}, {...request,extra:true},{...request,state:"text"},{...request,state:new Date(0)},{...request,questions:{}},
    {...request,questions:{first:{instruction:"",options:{A:"a",B:"b"}}}},
    {...request,questions:{first:{instruction:"choose",options:{A:"a"}}}}]){
    await refuse(()=>judgeNamedChoices({request:bad,apiKey:key,fetch}),"input_invalid");
  }
  assert.equal(calls,0);
});
test("network/http/json failures are closed and never retried",async()=>{
  for(const [fetch,code] of [
    [async()=>{throw Error("synthetic-error-canary");},"provider_unavailable"],
    [async()=>({ok:false,status:503}),"provider_http_error"],
    [async()=>({ok:true,json:async()=>{throw Error("synthetic-json-canary");}}),"provider_invalid_response"],
  ]){let calls=0;await refuse(()=>judgeNamedChoices({request,apiKey:key,fetch:(...args)=>{calls++;return fetch(...args);}}),code);assert.equal(calls,1);}
});
test("single ten-second deadline covers hung headers and body",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  for(const body of [false,true]){
    let calls=0,signal;
    const pending=judgeNamedChoices({request,apiKey:key,fetch:async(_,init)=>{calls++;signal=init.signal;return body?{ok:true,json:()=>new Promise(()=>{})}:new Promise(()=>{});}});
    let settled=false;pending.then(()=>{settled=true;},()=>{settled=true;});
    const check=refuse(()=>pending,"provider_timeout");
    await Promise.resolve();await Promise.resolve();t.mock.timers.tick(9_999);
    await Promise.resolve();assert.equal(settled,false);
    t.mock.timers.tick(1);await check;
    assert.equal(calls,1);assert.equal(signal.aborted,true);
  }
});
test("caller cancellation has closed cause",async()=>{
  const controller=new AbortController();
  const pending=judgeNamedChoices({request,apiKey:key,signal:controller.signal,fetch:()=>new Promise(()=>{})});
  const check=refuse(()=>pending,"cancelled");controller.abort();await check;
  let calls=0;
  await refuse(()=>judgeNamedChoices({request,apiKey:key,signal:controller.signal,fetch:()=>{calls++;}}),"cancelled");
  assert.equal(calls,0);
});
test("entry is self-contained and portable, not a CLI import",()=>{
  const source=fs.readFileSync(entry,"utf8");
  assert.ok(!/\bimport\s|\bprocess\b|\brequire\s*\(|node:|\bfs\b/.test(source));
});
