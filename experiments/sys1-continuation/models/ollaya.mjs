import {modelPort} from '../portable.mjs';
export function localTransport({expected,limit,fetch:request=globalThis.fetch}) {
  if(!/^[a-z0-9-]+:[a-z0-9.-]+$/.test(expected)||!Number.isSafeInteger(limit)||limit<1)throw Error('INVALID_LOCAL_MODEL');
  let calls=0;const usage={input_tokens:0,output_tokens:0},durations=[];
  return {available:true,async post(body){
    if(calls>=limit)throw Object.assign(Error('CALL_LIMIT'),{code:'CALL_LIMIT'});
    const wire={...body,model:expected};
    if(Buffer.byteLength(JSON.stringify(wire))>24000)throw Error('INVALID_REQUEST');
    const started=performance.now();calls++;
    const response=await request('http://127.0.0.1:11435/v1/systemone',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(wire),
      redirect:'error',signal:AbortSignal.timeout(300000)
    });
    const data=await response.json();
    if(!response.ok){
      const code=['STATE_TRUNCATED','INPUT_TOO_LONG','TOO_MANY_OPTIONS','UNSUPPORTED_MODEL'].includes(data?.code)?data.code:'LOCAL_MODEL_FAILURE';
      throw Object.assign(Error(code),{code});
    }
    if(data.model!==expected||!data.answers||Object.keys(data.answers).join()!=='live')throw Error('MODEL_OR_COVERAGE_CHANGED');
    const answer=data.answers.live,probabilities=answer?.probabilities;
    if(!probabilities||Math.abs(Object.values(probabilities).reduce((n,v)=>n+v,0)-1)>0.00051
      ||probabilities[answer.choice]<Math.max(...Object.values(probabilities))-0.00011)throw Error('INVALID_PROBABILITIES');
    for(const k of Object.keys(usage))if(Number.isFinite(data.usage?.[k])&&data.usage[k]>=0)usage[k]+=data.usage[k];
    durations.push(performance.now()-started);
    return data;
  },accounting:()=>({calls,usage,cost:null,execution:'local-cpu',requestDurationsMs:[...durations]})};
}
export async function createModel({key,limit=20,expected='laya:multilingual'}) {
  if(key)throw Error('UNEXPECTED_CREDENTIAL_FOR_LOCAL_MODEL');
  const {askJevChoice}=await import('../../../packages/jev/src/client.mjs');
  const transport=localTransport({expected,limit});
  const port=modelPort({id:'ollaya/'+expected,mode:'live',choice:async q=>{
    let used=null;
    const provider={available:true,post:async body=>{
      const data=await transport.post(body);
      used=Object.fromEntries(Object.entries(data.usage??{}).filter(([k,v])=>['input_tokens','output_tokens'].includes(k)&&Number.isFinite(v)&&v>=0));
      return data;
    }};
    const result=await askJevChoice({...q,provider});
    return {label:result.choice.choice,model:result.model,usage:used};
  }});
  return {...port,accounting:transport.accounting};
}
