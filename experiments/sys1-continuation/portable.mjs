// No Core/model names, HTTP, credentials, GitHub or optimizer policy in this runner.
import {hash} from './progress.mjs';
const fail = code => {throw new Error(code);};
export function modelPort({id,mode,choice}) {
  if(!id||!['live','test-double'].includes(mode)||typeof choice!=='function')fail('INVALID_MODEL_PORT');
  return {id,mode,async which(q) {
    if(!q||typeof q.text!=='string'||!q.text.trim()||typeof q.instructions!=='string'||!q.instructions.trim()
      ||!q.criteria||Array.isArray(q.criteria)||Object.keys(q.criteria).length<2
      ||Object.values(q.criteria).some(s=>typeof s!=='string'))fail('INVALID_QUESTION');
    const answer=await choice(structuredClone(q));
    if(!answer||!Object.hasOwn(q.criteria,answer.label)||typeof answer.model!=='string'||!answer.model)fail('INVALID_MODEL_ANSWER');
    return answer;
  }};
}
export async function evaluate(core,rows,model,identity) {
  if(!core?.id||typeof core.run!=='function'||!Array.isArray(core.labels)||!model?.which
    ||!Array.isArray(rows)||!rows.length||new Set(rows.map(x=>x.id)).size!==rows.length
    ||rows.some(x=>!x.id||!x.input||Object.keys(x).sort().join()!=='id,input'))fail('INVALID_EVALUATION');
  const result=[];let stopped=false;
  for(const row of rows) {
    const traces=[];
    if(stopped){result.push({id:row.id,status:'not_run',traces});continue;}
    const port={...model,which:async q=>{
      const a=await model.which(q);traces.push({question:structuredClone(q),...a});return a;
    }};
    try {
      const output=await core.run(structuredClone(row.input),port);
      if(!core.labels.includes(output?.label))fail('INVALID_CORE_OUTPUT');
      result.push({id:row.id,status:'ok',output,traces});
    } catch(error) {
      stopped=true;
      const kind=['STATE_TRUNCATED','INPUT_TOO_LONG','TOO_MANY_OPTIONS','UNSUPPORTED_MODEL'].includes(error?.code)?error.code:'CORE_OR_MODEL_FAILURE';
      result.push({id:row.id,status:'error',error:kind,traces});
    }
  }
  return {schema:'ops.sys1.portable-result.v1',core:core.id,model:model.id,mode:model.mode,
    identity,inputsDigest:hash(rows),rows:result,complete:!stopped};
}
export function score(core,inputs,gold,r) {
  const ids=inputs.map(x=>x.id);
  if(r?.core!==core.id||r.inputsDigest!==hash(inputs)||!Array.isArray(gold)||gold.length!==ids.length
    ||new Set(gold.map(x=>x.id)).size!==ids.length||gold.some(x=>!ids.includes(x.id)||!core.labels.includes(x.label))
    ||!Array.isArray(r.rows)||r.rows.length!==ids.length||r.rows.some((x,i)=>x.id!==ids[i]))fail('INCOMPLETE_OR_CHANGED_RESULT');
  let correct=0,errors=0;const confusion={};
  const rows=r.rows.map(row=>{
    if(!['ok','error','not_run'].includes(row.status))fail('INVALID_STATUS');
    if(row.status==='ok'&&!core.labels.includes(row.output?.label))fail('INVALID_LABEL');
    const wanted=gold.find(g=>g.id===row.id).label;
    if(row.status!=='ok')errors++;
    const actual=row.status==='ok'?row.output.label:row.status;
    const key=JSON.stringify([wanted,actual]);confusion[key]=(confusion[key]??0)+1;
    const hit=wanted===actual;if(hit)correct++;
    return {...row,expected:wanted,correct:hit};
  });
  return {...r,rows,correct,total:ids.length,errors,confusion,accuracy:errors?null:correct/ids.length,
    targetReached:!errors&&correct===ids.length,scope:'author-created development/portability only',independentHoldout:false};
}
