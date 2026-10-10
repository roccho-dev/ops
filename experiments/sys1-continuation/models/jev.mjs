import {modelPort} from '../portable.mjs';
export async function jevModel({key,limit=20,expected='jev-1.13.0'}) {
  const {bindJev,askJevChoice}=await import('../../../packages/jev/src/client.mjs');
  if(!key?.trim())throw Error('AUTH_MISSING');
  const provider=bindJev({apiKey:key,fetch:(u,i)=>fetch(u,{...i,redirect:'error'})});
  let calls=0;const usage={input_tokens:0,output_tokens:0};
  const port=modelPort({id:'jev-choice/'+expected,mode:'live',choice:async q=>{
    let used=null;
    const bounded={available:provider.available,post:async body=>{
      if(body.model!=='jev-latest'||Buffer.byteLength(JSON.stringify(body))>24000)throw Error('INVALID_REQUEST');
      if(calls>=limit)throw Error('CALL_LIMIT');calls++;
      const d=await provider.post(body,{deadlineMs:15000});
      if(d.model!==expected||!d.answers||Object.keys(d.answers).join()!=='live')throw Error('MODEL_OR_COVERAGE_CHANGED');
      const p=d.answers.live?.probabilities;
      if(!p||Math.abs(Object.values(p).reduce((n,v)=>n+v,0)-1)>1e-5)throw Error('INVALID_PROBABILITIES');
      used=Object.fromEntries(Object.entries(d.usage??{}).filter(([k,v])=>['input_tokens','output_tokens'].includes(k)&&Number.isFinite(v)&&v>=0));
      for(const k of Object.keys(usage))usage[k]+=used[k]??0;
      return d;
    }};
    const r=await askJevChoice({...q,provider:bounded});
    return {label:r.choice.choice,model:r.model,usage:used};
  }});
  return {...port,accounting:()=>({calls,usage,cost:null})};
}
export const createModel=jevModel;
