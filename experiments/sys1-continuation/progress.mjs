// Pure restart/accounting rules. Persist each transition through Git compare-and-swap.
import {createHash} from 'node:crypto';
const fail = code => {throw new Error(code);};
const integer = n => Number.isSafeInteger(n) && n >= 0;
const value = x => typeof x === 'string' && x.trim().length > 0;
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export function remaining(s) {
  if(s?.schema !== 'ops.sys1.progress.v1' || !integer(s.limit) || !integer(s.previous)
    || !s.runs || typeof s.runs !== 'object' || Array.isArray(s.runs)) fail('INVALID_PROGRESS');
  let spent=s.previous;
  for(const [id,r] of Object.entries(s.runs)) {
    if(!value(id)||!value(r.binding)||!integer(r.reserved)||r.reserved===0||!['reserved','settled'].includes(r.status))fail('INVALID_RUN');
    if(r.status==='settled'&&(!integer(r.actual)||r.actual>r.reserved||!value(r.receipt)))fail('INVALID_RECEIPT');
    spent+=r.status==='settled'?r.actual:r.reserved;
  }
  if(spent>s.limit)fail('ACCOUNTING_OVERFLOW');
  return s.limit-spent;
}
export function reserve(s,id,binding,calls) {
  const available=remaining(s);
  if(!/^[a-z0-9-]+$/.test(id)||!value(binding)||!integer(calls)||calls===0)fail('INVALID_RESERVATION');
  if(Object.hasOwn(s.runs,id)) {
    if(s.runs[id].binding!==binding||s.runs[id].reserved!==calls)fail('RESERVATION_CONFLICT');
    return {state:s,dispatch:false};
  }
  if(calls>available)fail('RESERVATION_EXCEEDS_ALLOWANCE');
  const out=structuredClone(s);out.runs[id]={binding,reserved:calls,status:'reserved'};
  return {state:out,dispatch:true};
}
export function settle(s,id,binding,actual,receipt) {
  remaining(s);const r=s.runs[id];
  if(!r||r.binding!==binding)fail('UNKNOWN_OR_STALE_RESULT');
  if(!integer(actual)||actual>r.reserved||!value(receipt))fail('INVALID_RECEIPT');
  if(r.status==='settled') {
    if(r.actual!==actual||r.receipt!==receipt)fail('CONFLICTING_RESULT');
    return s;
  }
  const out=structuredClone(s);out.runs[id]={...r,status:'settled',actual,receipt};return out;
}
export function selectPhase(phases,verified,blocked=[]) {
  const seen=new Set();
  for(const p of phases) {
    if(!value(p.id)||seen.has(p.id)||!Array.isArray(p.deps))fail('INVALID_PHASES');seen.add(p.id);
  }
  for(const p of phases)if(p.deps.some(d=>!seen.has(d)))fail('UNKNOWN_DEPENDENCY');
  return phases.find(p=>!verified.includes(p.id)&&!blocked.includes(p.id)&&p.deps.every(d=>verified.includes(d)))?.id??null;
}
export function holdoutIntake(m,optimizerId) {
  // Validate provenance references only. This cannot attest that their claims are true.
  const missing=[];
  const need=(condition,key)=>{if(!condition)missing.push(key);};
  need(m?.schema==='ops.sys1.holdout-manifest.v1','schema');
  need(value(m?.packageId),'packageId');need(value(m?.candidateDigest),'candidateDigest');
  need(value(m?.author?.id)&&value(m?.author?.receipt),'author');
  need(value(m?.reviewer?.id)&&value(m?.reviewer?.receipt),'reviewer');
  need(m?.author?.id!==optimizerId&&m?.reviewer?.id!==optimizerId&&m?.author?.id!==m?.reviewer?.id,'independent-identities');
  need(m?.privateArtifact?.visibility==='sealed'&&value(m?.privateArtifact?.locator)&&/^[a-f0-9]{64}$/.test(m?.privateArtifact?.digest??''),'sealed-artifact');
  need(value(m?.population)&&integer(m?.count)&&m.count>0,'population-count');
  need(value(m?.criteria?.digest)&&value(m?.criteria?.fixedBeforeEvaluation),'fixed-criteria');
  need(m?.exposure?.optimizerSaw===false&&m?.exposure?.usedForTuning===false&&value(m?.exposure?.receipt),'unexposed-history');
  if(m&&['cases','gold','answers','questions'].some(k=>Object.hasOwn(m,k)))fail('HOLDOUT_CONTENT_MUST_NOT_ENTER_OPTIMIZER');
  return {status:missing.length?'NEEDS_INPUT':'READY_FOR_INDEPENDENT_VERIFICATION',missing,p3Complete:false};
}
