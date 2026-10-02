import assert from "node:assert/strict";
import fs from "node:fs";
import {test} from "node:test";
const entry = process.env.JEV_PROVIDER_ENTRY ?? new URL("../src/batch.mjs",import.meta.url);
const {judgeNamedChoices: boundJudge,JudgeProviderError,bindJev} = await import(entry);
// Reuse the literal matrix through the actual bound API, never a second transport.
const judgeNamedChoices = ({apiKey,fetch,...input}) => boundJudge({...input,provider:bindJev({apiKey,fetch})});

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
test("only typed HTTP failures retain a bounded upstream status without reading a body",async()=>{
  for(const status of [300,401,429,500,599,undefined,null,"401",200,299,600,-1,NaN,Infinity,401.5,true,{}]){
    let calls=0,reads=0;
    await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>{
      calls++;return {ok:false,status,json:async()=>{reads++;throw Error("private-body-canary");}};
    }}),error=>{
      assert.ok(error instanceof JudgeProviderError);
      assert.equal(error.code,"provider_http_error");
      assert.equal(error.message,"provider_http_error");
      const allowed=Number.isInteger(status)&&status>=300&&status<=599;
      assert.equal(Object.hasOwn(error,"upstreamStatus"),allowed);
      if(allowed)assert.equal(error.upstreamStatus,status);
      assert.ok(!JSON.stringify(error).includes("canary"));
      return true;
    });
    assert.equal(calls,1);assert.equal(reads,0);
  }
  for(const code of ["provider_timeout","provider_unavailable","provider_invalid_response","provider_contract_error","auth_missing"]){
    assert.equal(Object.hasOwn(new JudgeProviderError(code,503),"upstreamStatus"),false);
  }
  assert.deepEqual(await invoke(data()),{answers:{first:{choice:"A",confidence:0.2},second:{choice:"NONE",confidence:1,probabilities:{NONE:2}}}});
});
test("HTTP400 diagnostic is one fixed same-field vocabulary observation, never raw detail",async()=>{
  const flag="context-limit-vocabulary-observed";
  const cases=[
    [{detail:"private-canary CONTEXT length"},true],
    [{message:"not a context limit: private-canary"},true],
    [{error:{message:"reflected input context limit private-canary"}},true],
    [{detail:"context",message:"length"},false],
    [{detail:"contextual length"},false],
    [{detail:"context_length"},false],
    [{detail:["context length"]},false],
    [{input:{message:"context limit"}},false],
    [{error:{detail:"context length"}},false],
    [{detail:"private-canary unknown"},false],
    [null,false],
  ];
  for(const [value,expected]of cases){
    let calls=0,rawReads=0;
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>{
      calls++;return {ok:false,status:400,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),json(){rawReads++;throw Error("private-canary");},text(){rawReads++;throw Error("private-canary");}};
    }}),error=>{
      assert.equal(error.code,"provider_http_error");assert.equal(error.upstreamStatus,400);
      assert.equal(Object.hasOwn(error,"diagnostic"),expected);
      if(expected)assert.equal(error.diagnostic,flag);
      assert.ok(!JSON.stringify(error).includes("private-canary"));
      assert.deepEqual(Object.keys(error).sort(),expected?["code","diagnostic","name","upstreamStatus"]:["code","name","upstreamStatus"]);
      return true;
    });
    assert.equal(calls,1);assert.equal(rawReads,0);
  }
  for(const [code,status,diagnostic]of [["provider_timeout",400,flag],["provider_http_error",401,flag],["provider_http_error",400,"private-canary"]]){
    assert.equal(Object.hasOwn(new JudgeProviderError(code,status,diagnostic),"diagnostic"),false);
  }
});
test("diagnostic cap is4096 bytes with strict UTF8/JSON and no fallback read",async()=>{
  const text=JSON.stringify({message:"context limit private-canary"});
  for(const [bytes,expected]of [
    [new TextEncoder().encode(text.padEnd(4096," ")),true],
    [new TextEncoder().encode(text.padEnd(4097," ")),false],
    [new Uint8Array([255]),false],
    [new TextEncoder().encode("context limit private-canary"),false],
  ]){
    let cancels=0;
    const body=new ReadableStream({start(c){c.enqueue(bytes);},cancel(){cancels++;}});
    // Close valid-size streams; the oversize case must cancel before another read.
    const stream=bytes.length<=4096?new ReadableStream({start(c){c.enqueue(bytes);c.close();}}):body;
    await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:false,status:400,body:stream,text(){throw Error("must not fallback");},json(){throw Error("must not fallback");}})}),error=>{
      assert.equal(error.upstreamStatus,400);assert.equal(Object.hasOwn(error,"diagnostic"),expected);assert.ok(!JSON.stringify(error).includes("private-canary"));return true;
    });
    assert.equal(stream.locked,false);if(bytes.length>4096)assert.equal(cancels,1);
  }
  const exact=new TextEncoder().encode(text.padEnd(4096," "));
  for(const [chunks,expected]of [[ [exact.slice(0,2000),exact.slice(2000)],true ],[ [exact,new Uint8Array([32]),new TextEncoder().encode("private-unread-canary")],false ]]){
    let reads=0,cancels=0,releases=0;
    const reader={read:async()=>{const value=chunks[reads++];return value?{done:false,value}:{done:true};},cancel(){cancels++;},releaseLock(){releases++;}};
    await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:false,status:400,body:{getReader:()=>reader}})}),error=>{
      assert.equal(Object.hasOwn(error,"diagnostic"),expected);assert.ok(!JSON.stringify(error).includes("canary"));return true;
    });
    assert.equal(reads,expected?3:2);assert.equal(cancels,expected?0:1);assert.equal(releases,1);
  }
  // Empty non-done chunks are unsupported: stop before repeated empties or
  // subsequent matching bytes can starve the deadline or create a diagnostic.
  for(const next of [new Uint8Array(),new TextEncoder().encode(text)]){
    let reads=0,cancels=0,releases=0;
    const reader={read:async()=>({done:false,value:reads++===0?new Uint8Array():next}),cancel(){cancels++;},releaseLock(){releases++;}};
    await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:false,status:400,body:{getReader:()=>reader}})}),error=>{
      assert.equal(error.code,"provider_http_error");assert.equal(error.upstreamStatus,400);
      assert.equal(Object.hasOwn(error,"diagnostic"),false);assert.ok(!JSON.stringify(error).includes("canary"));return true;
    });
    assert.equal(reads,1);assert.equal(cancels,1);assert.equal(releases,1);
  }
  for(const body of [undefined,{}, {getReader(){throw Error("private-canary");}}]){
    await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:false,status:400,body})}),error=>error.code==="provider_http_error"&&!Object.hasOwn(error,"diagnostic")&&!JSON.stringify(error).includes("canary"));
  }
  let cancels=0,releases=0;
  const reader={read:async()=>{throw Error("private-read-canary");},cancel(){cancels++;},releaseLock(){releases++;}};
  await assert.rejects(()=>judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:false,status:400,body:{getReader:()=>reader}})}),error=>error.code==="provider_http_error"&&!Object.hasOwn(error,"diagnostic")&&!JSON.stringify(error).includes("canary"));
  assert.equal(cancels,1);assert.equal(releases,1);
});
test("legacy, other statuses and success never inspect rejection bodies",async()=>{
  for(const status of [400,401,429,503]){
    let reads=0;const fetch=async()=>({ok:false,status,get body(){reads++;throw Error("private-canary");}});
    const provider=bindJev({apiKey:key,fetch});
    await assert.rejects(()=>provider.post({legacy:true}),error=>error.code==="provider_http_error");assert.equal(reads,0);
    if(status!==400){await refuse(()=>boundJudge({request,provider}),"provider_http_error");assert.equal(reads,0);}
  }
  let reads=0;await judgeNamedChoices({request,apiKey:key,fetch:async()=>({ok:true,json:async()=>data(),get body(){reads++;throw Error("private-canary");}})});assert.equal(reads,0);
});
test("diagnostic stalled reader is cancelled and released at original deadline or caller abort",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  for(const timeout of [true,false]){
    const controller=new AbortController();let reads=0,cancels=0,releases=0,late;
    const reader={read(){reads++;return new Promise(resolve=>{late=resolve;});},cancel(){cancels++;return Promise.reject(Error("private-cancel-canary"));},releaseLock(){releases++;}};
    const pending=judgeNamedChoices({request,apiKey:key,signal:controller.signal,fetch:async()=>({ok:false,status:400,body:{getReader:()=>reader}})});
    const check=refuse(()=>pending,timeout?"provider_timeout":"cancelled");
    for(let i=0;i<6;i++)await Promise.resolve();assert.equal(reads,1);
    if(timeout)t.mock.timers.tick(10000);else controller.abort();
    await check;for(let i=0;i<6;i++)await Promise.resolve();
    assert.equal(cancels,1);assert.equal(releases,1);
    late({done:false,value:new TextEncoder().encode("private-late-canary context limit")});
    for(let i=0;i<6;i++)await Promise.resolve();assert.equal(reads,1);
  }
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
  assert.ok(!/\bprocess\b|\brequire\s*\(|node:|\bfs\b/.test(source));
  if (process.env.JEV_PROVIDER_ENTRY) assert.ok(!/\bimport\s/.test(source));
});

test("one binding reuses private credential without per-operation key and isolates calls",async()=>{
  const signals=[],headers=[];
  const provider=bindJev({apiKey:key,fetch:async(_,init)=>{
    signals.push(init.signal);headers.push(init.headers.authorization);
    return {ok:true,json:async()=>data()};
  }});
  assert.equal(Object.isFrozen(provider),true);
  assert.deepEqual(Object.keys(provider),["available","post"]);
  await Promise.all([boundJudge({request,provider}),boundJudge({request,provider})]);
  assert.deepEqual(headers,["Bearer "+key,"Bearer "+key]);
  assert.notEqual(signals[0],signals[1]);
  let otherCalls=0;
  const other=bindJev({apiKey:"other-synthetic-key",fetch:async(_,init)=>{
    otherCalls++;assert.equal(init.headers.authorization,"Bearer other-synthetic-key");
    return {ok:true,json:async()=>data()};
  }});
  await boundJudge({request,provider:other});assert.equal(otherCalls,1);
});
test("cancelling one bound call leaves its concurrent sibling and another binding alive",async()=>{
  const controller=new AbortController();let release;
  const provider=bindJev({apiKey:key,fetch:async(_,init)=>{
    if(init.signal.aborted) throw Error("synthetic-abort-detail");
    return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>data()});});
  }});
  const first=boundJudge({request,provider,signal:controller.signal});
  const sibling=boundJudge({request,provider});
  const check=refuse(()=>first,"cancelled");controller.abort();await check;
  release();await sibling;
  await boundJudge({request,provider:bindJev({apiKey:key,fetch:async()=>({ok:true,json:async()=>data()})})});
});
test("native-style abort rejection cannot replace the caller cancellation cause",async()=>{
  for(const body of [false,true]){
    const controller=new AbortController();let calls=0;
    const provider=bindJev({apiKey:key,fetch:async(_,init)=>{
      calls++;
      const pending=()=>new Promise((_,reject)=>{
        init.signal.addEventListener("abort",()=>reject(Error("synthetic-abort-canary")),{once:true});
      });
      return body?{ok:true,json:pending}:pending();
    }});
    const result=boundJudge({request,provider,signal:controller.signal});
    const check=refuse(()=>result,"cancelled");
    await Promise.resolve();await Promise.resolve();controller.abort();await check;
    assert.equal(calls,1);
  }
});
