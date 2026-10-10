import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const digest = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const fail = code => { throw new Error(code); };
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join('\0') === [...keys].sort().join('\0');
const text = x => typeof x === 'string' && x.trim().length > 0;
const unique = xs => new Set(xs).size === xs.length;
const read = p => fs.readFileSync(p, 'utf8');
const jsonl = s => s.trim().split('\n').map(line => JSON.parse(line));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });

export function validateCases(cases, contract) {
  if (!Array.isArray(cases) || cases.length !== contract.caseCount || !unique(cases.map(c => c?.id))) fail('INVALID_CASES');
  for (const c of cases) {
    if (!exact(c, ['id','purpose','complete','body','comments']) || !text(c.id)
      || !['task','historical-record'].includes(c.purpose) || typeof c.complete !== 'boolean'
      || !text(c.body) || !Array.isArray(c.comments) || !c.comments.every(text)
      || Buffer.byteLength(JSON.stringify(c)) > 16000) fail('INVALID_CASES');
  }
}
export function validateCandidate(c) {
  if (!exact(c, ['schema','id','instructions']) || c.schema !== 'ops.sys1.prompt-candidate.v1'
    || !/^[a-z][a-z0-9-]{0,39}$/.test(c.id) || !text(c.instructions)
    || Buffer.byteLength(c.instructions) > 6000) fail('INVALID_CANDIDATE');
}
export function loadInput(candidatePath) {
  const contractText = read(path.join(ROOT, 'contract.json'));
  const contract = JSON.parse(contractText), casesText = read(path.join(ROOT, 'cases.jsonl'));
  if (contract.schema !== 'ops.sys1.eval-contract.v1' || digest(casesText) !== contract.casesSha256) fail('CORPUS_CHANGED');
  const cases = jsonl(casesText), candidate = JSON.parse(read(candidatePath));
  validateCases(cases, contract); validateCandidate(candidate);
  return {contract, contractDigest:digest(contractText), cases, candidate};
}
export function requestFor(c, candidate, contract) {
  // IDs, reference labels, scoring metadata and source code never enter model input.
  return {text:JSON.stringify({purpose:c.purpose, complete:c.complete, body:c.body, comments:c.comments}),
    criteria:structuredClone(contract.labels), instructions:candidate.instructions};
}
const sanitized = error => ['AUTH_MISSING','RERUN_FORBIDDEN','OVER_BUDGET','MODEL_CHANGED','INVALID_ANSWER','MODEL_NOT_ALLOWED','INPUT_TOO_LARGE'].includes(error?.message)
  ? error.message : error?.code === 'provider_error' ? 'PROVIDER_ERROR' : 'EVALUATION_ERROR';

export async function evaluate(input, ask, metadata = {}) {
  const {contract, cases, candidate, contractDigest} = input;
  validateCases(cases,contract); validateCandidate(candidate);
  const rows = []; let stopped = false, calls = 0;
  for (const c of cases) {
    if (stopped) { rows.push({id:c.id,status:'not_run'}); continue; }
    const request = requestFor(c,candidate,contract), start = performance.now();
    try {
      if (++calls > contract.maxCallsPerCandidate) fail('OVER_BUDGET');
      const r = await ask(request);
      if (!r || !Object.hasOwn(contract.labels,r.label) || !text(r.model)) fail('INVALID_ANSWER');
      rows.push({id:c.id,status:'ok',request,prediction:r.label,model:r.model,usage:r.usage??null,elapsedMs:performance.now()-start});
    } catch(error) {
      rows.push({id:c.id,status:'error',error:sanitized(error),elapsedMs:performance.now()-start}); stopped = true;
    }
  }
  return {schema:'ops.sys1.predictions.v1',mode:metadata.mode??'test-double',sourceSha:metadata.sourceSha??null,
    runUrl:metadata.runUrl??null,contractDigest,casesDigest:contract.casesSha256,candidateDigest:digest(candidate),
    candidateId:candidate.id,modelAlias:contract.modelAlias,attemptedCases:calls,rows};
}
export function score(input, gold, predictions) {
  const {contract,cases,contractDigest,candidate} = input;
  if (!Array.isArray(gold) || gold.length !== cases.length || !unique(gold.map(g => g.id))
    || gold.some(g=>!exact(g,['id','label','basis']) || !Object.hasOwn(contract.labels,g.label) || !text(g.basis))
    || cases.some(c=>!gold.some(g=>g.id===c.id))) fail('INVALID_GOLD');
  if (predictions.schema!=='ops.sys1.predictions.v1' || predictions.contractDigest!==contractDigest
    || predictions.casesDigest!==contract.casesSha256 || predictions.candidateDigest!==digest(candidate)
    || !Array.isArray(predictions.rows) || predictions.rows.length!==cases.length
    || !unique(predictions.rows.map(r=>r.id)) || cases.some(c=>!predictions.rows.some(r=>r.id===c.id))) fail('RESULT_MISMATCH');
  let correct=0, falsePositives=0, falseNegatives=0, errors=0;
  const concerns = new Set(['body_observation','expectation_missing']);
  const rows = cases.map(c=>{
    const expected=gold.find(g=>g.id===c.id), r=predictions.rows.find(r=>r.id===c.id);
    if (!['ok','error','not_run'].includes(r.status)) fail('INVALID_RESULT');
    if (r.status==='ok' && (!Object.hasOwn(contract.labels,r.prediction)||!text(r.model)
      || JSON.stringify(r.request)!==JSON.stringify(requestFor(c,candidate,contract)))) fail('INVALID_RESULT');
    const hit=r.status==='ok' && r.prediction===expected.label;
    if (hit) correct++;
    if (r.status!=='ok') errors++;
    if (r.status==='ok' && concerns.has(r.prediction)&&!concerns.has(expected.label)) falsePositives++;
    if (r.status==='ok' && !concerns.has(r.prediction)&&concerns.has(expected.label)) falseNegatives++;
    return {...r,expected:expected.label,basis:expected.basis,correct:hit};
  });
  const models=[...new Set(rows.filter(r=>r.status==='ok').map(r=>r.model))];
  const complete=errors===0 && models.length===1;
  const usage={}; let usageRows=0;
  for (const r of rows) if (r.usage && typeof r.usage==='object') {
    usageRows++;
    for (const k of ['input_tokens','output_tokens','total_tokens']) if (Number.isFinite(r.usage[k])&&r.usage[k]>=0) usage[k]=(usage[k]??0)+r.usage[k];
  }
  return {schema:'ops.sys1.scored.v1',mode:predictions.mode,sourceSha:predictions.sourceSha,runUrl:predictions.runUrl,
    contractDigest,casesDigest:contract.casesSha256,goldDigest:contract.goldSha256,candidateDigest:predictions.candidateDigest,
    candidateId:candidate.id,models,modelAlias:predictions.modelAlias,actualCalls:predictions.actualCalls??null,
    status:complete?'EVALUATED':'STOP_EVALUATION_ERROR',correct,total:cases.length,accuracy:complete?correct/cases.length:null,
    falsePositives,falseNegatives,errors,targetReached:complete&&correct>=contract.target.correct&&falsePositives<=contract.target.falsePositives&&falseNegatives<=contract.target.falseNegatives,
    usage:usageRows?usage:null,usageCoverage:usageRows,cost:null,holdout:contract.holdout,
    goldAuthorIndependent:contract.goldOrigin.authorIndependent,qualityAdoptionAuthorized:false,rows};
}
export function compare(before,after) {
  if ([before,after].some(x=>x.schema!=='ops.sys1.scored.v1'||x.mode!=='live'||x.status!=='EVALUATED')) fail('INCOMPLETE_OR_MOCK_COMPARISON');
  for (const key of ['contractDigest','casesDigest','goldDigest','modelAlias']) if (before[key]!==after[key]) fail('CONTRACT_CHANGED');
  if (before.models.length!==1 || JSON.stringify(before.models)!==JSON.stringify(after.models)) fail('MODEL_CHANGED');
  if (before.total!==after.total || !unique(before.rows.map(r=>r.id)) || before.rows.some(r=>!after.rows.some(a=>a.id===r.id&&a.expected===r.expected))) fail('RESULT_MISMATCH');
  const resolved=before.rows.filter(r=>!r.correct&&after.rows.find(a=>a.id===r.id).correct).map(r=>r.id);
  const regressed=before.rows.filter(r=>r.correct&&!after.rows.find(a=>a.id===r.id).correct).map(r=>r.id);
  const delta=after.correct-before.correct;
  return {schema:'ops.sys1.comparison.v1',baseline:before.candidateDigest,candidate:after.candidateDigest,
    beforeCorrect:before.correct,afterCorrect:after.correct,total:before.total,delta,resolved,regressed,
    outcome:delta>0?'EFFECT_OBSERVED':delta<0?'HARM_OBSERVED':'NO_EFFECT_OBSERVED',
    best:delta>0&&regressed.length===0?after.candidateDigest:before.candidateDigest,
    targetReached:after.targetReached&&regressed.length===0,qualityAdoptionAuthorized:false,
    evidenceScope:'paired synthetic development only; no holdout or independent author'};
}

async function main() {
  const [mode,candidateName,outDir,second]=process.argv.slice(2);
  if (mode==='compare') {
    const result=compare(JSON.parse(read(candidateName)),JSON.parse(read(outDir)));
    console.log(JSON.stringify(result)); return;
  }
  if (!['evaluate','score'].includes(mode) || !/^[a-z][a-z0-9-]{0,39}$/.test(candidateName??'') || !outDir || second) fail('INVALID_COMMAND');
  const input=loadInput(path.join(ROOT,'candidates',candidateName+'.json'));
  fs.mkdirSync(outDir,{recursive:true});
  if (mode==='evaluate') {
    if (process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT!=='1') fail('RERUN_FORBIDDEN');
    let calls=0, bound, askJevChoice;
    const ask=async request=>{
      if (!process.env.JEV_API_KEY?.trim()) fail('AUTH_MISSING');
      if (!bound) {
        const client=await import('../../packages/jev/src/client.mjs');
        askJevChoice=client.askJevChoice;
        bound=client.bindJev({apiKey:process.env.JEV_API_KEY,fetch:(url,init)=>fetch(url,{...init,redirect:'error'})});
      }
      let usage=null;
      const provider=Object.freeze({available:bound.available,post:async body=>{
        if (body.model!==input.contract.modelAlias) fail('MODEL_NOT_ALLOWED');
        if (Object.keys(body.answers??{}).length || Buffer.byteLength(JSON.stringify(body))>24000) fail('INPUT_TOO_LARGE');
        if (++calls>input.contract.maxCallsPerCandidate) fail('OVER_BUDGET');
        const data=await bound.post(body,{deadlineMs:input.contract.deadlineMs});
        if (!data.answers || Object.keys(data.answers).join()!=='live') fail('INVALID_ANSWER');
        const a=data.answers.live,p=a?.probabilities;
        if (!p || Math.abs(Object.values(p).reduce((n,v)=>n+v,0)-1)>1e-5
          || p[a.choice]<Math.max(...Object.values(p))-1e-6) fail('INVALID_ANSWER');
        usage=Object.fromEntries(Object.entries(data.usage??{}).filter(([k,v])=>['input_tokens','output_tokens','total_tokens'].includes(k)&&Number.isFinite(v)&&v>=0));
        return data;
      }});
      const r=await askJevChoice({...request,provider});
      return {label:r.choice.choice,model:r.model,usage};
    };
    const report=await evaluate(input,ask,{mode:'live',sourceSha:process.env.TRIAL_SOURCE_SHA??null,
      runUrl:process.env.GITHUB_RUN_ID?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null});
    report.actualCalls=calls;
    write(path.join(outDir,'predictions.json'),report);
    if (report.rows.some(r=>r.status!=='ok')) process.exitCode=2;
  } else {
    // This command runs in a separate, key-free CI step; only here is Gold read.
    if (process.env.JEV_API_KEY) fail('KEY_PRESENT_IN_SCORER');
    const raw=read(path.join(ROOT,'expected.jsonl'));
    if (digest(raw)!==input.contract.goldSha256) fail('GOLD_CHANGED');
    const report=score(input,jsonl(raw),JSON.parse(read(path.join(outDir,'predictions.json'))));
    write(path.join(outDir,'scored.json'),report);
    console.log('SYS1_EVAL_RESULT '+JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## ${report.candidateId}\nStatus: ${report.status}\n\nCorrect: ${report.correct}/${report.total}; actual calls: ${report.actualCalls}; false positives: ${report.falsePositives}; false negatives: ${report.falseNegatives}\n\nSynthetic development only. Independent Holdout: NOT_AVAILABLE.\n`);
    if (report.status!=='EVALUATED') process.exitCode=2;
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(()=>{
  console.error('SYS1_TRIAL_STOP: input/contract/runtime failure; raw exception intentionally withheld');process.exitCode=2;
});
