// Pure finite one-target evidence transitions. Identity strings and receipts require independent verification.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const str=x=>typeof x==='string'&&x.trim().length>0;
const int=x=>Number.isSafeInteger(x)&&x>=0;
const requireThat=(ok,why)=>{if(!ok)throw Error(why);};
const costKeys=['humanMinutes','sys2Calls','sys1Calls','ciSeconds','computeSeconds','reworkMinutes','paidUsd'];
export function openTrial(spec){
  requireThat(str(spec?.id)&&str(spec?.world?.id)&&str(spec?.world?.version)&&str(spec?.world?.scope),'INVALID_WORLD');
  requireThat(['goalDigest','coverageDigest','criteriaDigest','comparisonDigest'].every(k=>isHash(spec[k])),'UNFIXED_OBJECTIVE');
  requireThat(str(spec.criteriaFixedRef)&&str(spec.permissionOwner),'MISSING_OWNERSHIP');
  requireThat(int(spec.maxCycles)&&spec.maxCycles>0&&int(spec.maxSteps)&&spec.maxSteps>=3,'UNBOUNDED_TRIAL');
  requireThat(Array.isArray(spec.allowedEffects)&&new Set(spec.allowedEffects).size===spec.allowedEffects.length&&spec.allowedEffects.every(str),'INVALID_PERMISSIONS');
  requireThat(!['gold','questions','holdoutCases','secret'].some(k=>Object.hasOwn(spec,k)),'SEALED_CONTENT_FORBIDDEN');
  return {schema:'ops.sys1.one-target.v1',contract:structuredClone(spec),phase:'OBSERVE',worldVersion:spec.world.version,
    cycles:0,events:[],active:null,result:'NOT_PROVEN',independentHoldout:false,automatedLoopProven:false,qualityProven:false};
}
export function transition(previous,event){
  requireThat(previous?.schema==='ops.sys1.one-target.v1'&&str(event?.id)&&str(event?.kind),'INVALID_EVENT');
  const digest=hash(event),repeat=previous.events.find(x=>x.id===event.id);
  if(repeat){requireThat(repeat.hash===digest,'CONFLICTING_EVENT');return {state:previous,changed:false};}
  requireThat(!['DONE','STOPPED'].includes(previous.phase),'TERMINAL_TRIAL');
  const s=structuredClone(previous),contract=s.contract;
  if(s.events.length>=contract.maxSteps){s.phase='STOPPED';s.result='STEP_LIMIT';return {state:s,changed:true};}
  const phase=name=>requireThat(s.phase===name,'INVALID_TRANSITION');
  const world=x=>requireThat(x.worldId===contract.world.id&&x.worldVersion===s.worldVersion,'STALE_WORLD');
  const evidence=x=>requireThat(str(x?.ref)&&str(x?.author)&&str(x?.reviewer)&&x.author!==x.reviewer&&x.criteriaDigest===contract.criteriaDigest,'INCOMPLETE_EVIDENCE');
  const coverage=x=>requireThat(x.coverageDigest===contract.coverageDigest,'CHANGED_COVERAGE');
  const verdict=x=>requireThat(['GAP','NO_GAP','UNKNOWN'].includes(x),'INVALID_VERDICT');
  switch(event.kind){
    case 'OBSERVED':
      phase('OBSERVE');world(event);coverage(event);evidence(event.evidence);verdict(event.verdict);
      s.active={observed:{ref:event.evidence.ref,verdict:event.verdict}};
      if(event.verdict==='NO_GAP'){s.phase='DONE';s.result='TARGET_REPORTED_MET';}
      else if(event.verdict==='UNKNOWN'){s.phase='BLOCKED';s.result='NEEDS_OBSERVATION';}
      else s.phase='DISCOVER';
      break;
    case 'PROPOSED':
      phase('DISCOVER');
      requireThat(str(event.author)&&isHash(event.proposalDigest)&&Array.isArray(event.questions)&&event.questions.length>0,'INVALID_PROPOSAL');
      requireThat(new Set(event.questions.map(x=>x.id)).size===event.questions.length,'DUPLICATE_QUESTION');
      for(const q of event.questions)requireThat(str(q.id)&&str(q.reason)&&['KNOWN','MISSING'].includes(q.route)&&(q.route==='MISSING'||str(q.coreId)),'INVALID_QUESTION');
      s.active.proposal={digest:event.proposalDigest,author:event.author,questions:structuredClone(event.questions)};s.phase='VERIFY';
      break;
    case 'VERIFIED':
      phase('VERIFY');evidence(event.evidence);
      requireThat(event.proposalDigest===s.active.proposal.digest&&event.evidence.author===s.active.proposal.author,'WRONG_PROPOSAL');
      requireThat(['PASS','REJECT','UNKNOWN'].includes(event.verdict),'INVALID_REVIEW');
      if(event.verdict==='PASS'){s.active.verification=event.evidence.ref;s.phase='ADMIT';}
      else if(event.verdict==='REJECT'){s.phase='DISCOVER';s.result='PROPOSAL_REJECTED';}
      else{s.phase='BLOCKED';s.result='REVIEW_UNKNOWN';}
      break;
    case 'ADMITTED':
      phase('ADMIT');requireThat(str(event.operation)&&str(event.authorizationRef),'INVALID_ADMISSION');
      requireThat(event.proposalDigest===s.active.proposal.digest
        &&event.worldId===contract.world.id&&event.worldVersion===s.worldVersion,'STALE_OR_UNBOUND_ADMISSION');
      if(event.operation==='NO_EFFECT'){s.active.admission={operation:'NO_EFFECT',ref:event.authorizationRef};s.phase='READBACK';}
      else if(!contract.allowedEffects.includes(event.operation)){s.phase='BLOCKED';s.result='PERMISSION_MISSING';}
      else{requireThat(str(event.effectKey),'MISSING_EFFECT_KEY');s.active.admission={operation:event.operation,key:event.effectKey,ref:event.authorizationRef};s.phase='EFFECT';}
      break;
    case 'EFFECT_RECORDED':
      phase('EFFECT');world(event);
      requireThat(event.effectKey===s.active.admission.key&&str(event.receiptRef)&&str(event.resultWorldVersion)&&str(event.actor),'MISSING_EFFECT_RECEIPT');
      s.active.effect={key:event.effectKey,receiptRef:event.receiptRef,version:event.resultWorldVersion,actor:event.actor};s.phase='READBACK';
      break;
    case 'READBACK':
      phase('READBACK');coverage(event);evidence(event.evidence);verdict(event.verdict);
      requireThat(event.worldId===contract.world.id&&event.worldVersion===(s.active.effect?.version??s.worldVersion),'WRONG_READBACK_WORLD');
      requireThat(event.evidence.reviewer!==s.active.proposal.author&&event.evidence.reviewer!==s.active.effect?.actor,'SELF_READBACK');
      requireThat(event.cost&&costKeys.every(k=>Object.hasOwn(event.cost,k)&&(event.cost[k]===null||(Number.isFinite(event.cost[k])&&event.cost[k]>=0))),'UNKNOWN_OR_INVALID_COST');
      s.active.readback={ref:event.evidence.ref,verdict:event.verdict,cost:structuredClone(event.cost)};
      s.worldVersion=event.worldVersion;s.cycles++;
      if(event.verdict==='NO_GAP'){s.phase='DONE';s.result='TARGET_REPORTED_MET';}
      else if(event.verdict==='UNKNOWN'){s.phase='BLOCKED';s.result='NEEDS_OBSERVATION';}
      else if(s.cycles>=contract.maxCycles){s.phase='STOPPED';s.result='CYCLE_LIMIT';}
      else{s.phase='OBSERVE';s.result='GAP_REMAINS';}
      break;
    case 'RESUMED':
      phase('BLOCKED');requireThat(str(event.newEvidenceRef)&&str(event.reason),'NO_RESUME_EVIDENCE');
      requireThat(event.newEvidenceRef!==s.active?.readback?.ref&&event.newEvidenceRef!==s.active?.observed?.ref,'STALE_RESUME_EVIDENCE');
      s.phase='OBSERVE';s.result='NOT_PROVEN';
      break;
    default:throw Error('UNKNOWN_EVENT_KIND');
  }
  s.events.push({id:event.id,kind:event.kind,hash:digest,after:s.phase});
  return {state:s,changed:true};
}
