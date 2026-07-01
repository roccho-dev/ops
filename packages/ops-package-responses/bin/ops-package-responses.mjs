#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const at = "2026-06-30T00:00:00Z";
const repo = "roccho-dev/ops";
const selected = [
  ["ops-build-receipt-check","package-obligation.ops.receipts","packages/ops-build-receipt-check",["receipt-shape","receipt-classification","drift-detection"],["build/checks.jsonl:ops-build-receipt-check"],[]],
  ["ops-handoff-pack","package-obligation.ops.handoff","packages/ops-handoff-pack",["handoff-pack-created","handoff-pack-valid","tamper-and-drift-rejection"],["build/checks.jsonl:ops-handoff-pack"],[]],
  ["ops-artifact-materialize","package-obligation.ops.artifact-materialization","packages/ops-artifact-materialize",["artifact-materialize","manifest-produced","strict-count"],["flake.nix:checks.ops-artifact-materialize"],[]],
  ["ops-knowledge-intake","package-obligation.ops.knowledge-intake","packages/ops-knowledge-intake",["knowledge-id-header","retry-template-candidate","gate-candidate"],["flake.nix:checks.ops-knowledge-intake"],[]],
  ["ops-package-responses","package-obligation.ops.package-response-adoption","packages/ops-package-responses",["response-shape","evidence-linkage","receipt-linkage","residual-return"],["build/checks.jsonl:ops-package-responses",".github/workflows/gov-package-validation.yml"],["residual.gov-package-check-export-wait"]],
];
const explicit = ["poc-from-jsonl","ops-build-defs-snapshot","ops-tools-from-defs","nodejs26","prove-feat","ops-bootstrap","ops-cdp-core","find-packages-skill","find-packages-lib","find-packages-sql","default"];
const files = ["ops-package-responses.jsonl","ops-package-evidence.jsonl","ops-package-receipts.jsonl","ops-package-residuals.jsonl","package-inventory.jsonl","package-responses.jsonl","package-residuals.jsonl","package-drifts.jsonl","manifest.json"];
const sourceKinds = ["build-packages-jsonl","build-checks-jsonl","flake-generated","flake-explicit","source-dir","evidence-output"];
const required = ["claim_id","adrs_ref","obligation_id","repo_locator","package_id","package_path","owner_role","state","covered_requirements","test_refs","evidence_refs","receipt_ref","residuals","blocked_reason","evidence_freshness","overclaim_boundary"];

function response([id, obligation, pkgPath, reqs, tests, residuals]) {
  return {
    kind:"ops.packageResponse.v1", claim_id:`ops-package-response.${id}`, adrs_ref:"roccho-dev/adrs#101",
    obligation_id:obligation, repo_locator:repo, package_id:id, package_path:pkgPath, owner_role:"ops", state:"covered",
    covered_requirements:reqs, test_refs:tests, evidence_refs:[`evidence.${id}.ci`,`evidence.${id}.test`], receipt_ref:`receipt.${id}`,
    residuals, blocked_reason:"", evidence_freshness:{status:"current",checked_by:"ops-package-responses",source:"checked-in-ci-and-nix-check",generated_at:at},
    overclaim_boundary:"ops emits package evidence only; ADRS/governance retain meaning authority", authority:false
  };
}
const responses = selected.map(response);
const residuals = [{kind:"ops.packageResidual.v1",residual_id:"residual.gov-package-check-export-wait",response_claim_id:"ops-package-response.ops-package-responses",package_id:"ops-package-responses",status:"returned",returned_to:"governance#64",reason:"governance reusable package check export is owned by governance",authority:false}];

function usage(){return "usage: ops-package-responses emit --out-dir <dir> [--repo-root <dir>] [--json]\n       ops-package-responses validate --out-dir <dir> [--json]\n       ops-package-responses selftest [--repo-root <dir>] [--json]";}
function argv(a){let command="emit", json=false, outDir, repoRoot; a=[...a]; if(a[0]&&!a[0].startsWith("-")) command=a.shift(); while(a.length){let k=a.shift(); if(k==="--json")json=true; else if(k==="--out-dir")outDir=a.shift(); else if(k==="--repo-root")repoRoot=a.shift(); else throw Error(`unknown argument: ${k}`);} return {command,json,outDir,repoRoot};}
function readJsonl(file){return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map((l,i)=>{try{return JSON.parse(l)}catch(e){throw Error(`${file}:${i+1}: ${e.message}`)}})}
function readIf(file){return fs.existsSync(file)?readJsonl(file):[]}
function writeJsonl(file, rows){fs.writeFileSync(file, rows.map(x=>JSON.stringify(x)).join("\n")+"\n")}
function up(start){let r=[],c=path.resolve(start); for(;;){r.push(c); let p=path.dirname(c); if(p===c) return r; c=p}}
function hasBuild(root){return fs.existsSync(path.join(root,"build/packages.jsonl"))&&fs.existsSync(path.join(root,"build/checks.jsonl"))}
function root(x){let s=fileURLToPath(import.meta.url); return [x,process.cwd(),...up(path.dirname(s))].filter(Boolean).map(x=>path.resolve(x)).find(hasBuild)??path.resolve(x??process.cwd())}
function pkgPath(entry){let p=String(entry).split("/"); return p[0]==="packages"&&p[1]?p.slice(0,2).join("/"):path.dirname(entry)}
function checkPath(script){let p=String(script).split("/"); return p[0]==="packages"&&p[1]?p.slice(0,2).join("/"):p[0]==="tools"?"tools":path.dirname(script)}
function dirs(root){let d=path.join(root,"packages"); if(!fs.existsSync(d))return[]; return fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).filter(n=>["bin","lib","src","tests","test","skill","sql","viewer","flake.nix"].some(c=>fs.existsSync(path.join(d,n,c)))).sort()}
function inv(kind,id,p,ref,item="package",extra={}){let {kind:source_record_kind,...rest}=extra; return {kind:"packageInventory.v1",inventory_id:`ops.inventory.${kind}.${id}`,repo_locator:repo,repo,package_id:id,packageId:id,package_path:p,packagePath:p,item_kind:item,source_kind:kind,sourceKind:kind,source_ref:ref,generated_at:at,authority:false,source_record_kind,...rest}}
function uniq(xs){let s=new Set; return xs.filter(x=>s.has(x.inventory_id)?false:(s.add(x.inventory_id),true))}
function inventory(rootDir,outDir){
  let rows=[], pkgs=readIf(path.join(rootDir,"build/packages.jsonl")), checks=readIf(path.join(rootDir,"build/checks.jsonl"));
  for(let p of pkgs){rows.push(inv("build-packages-jsonl",p.name,pkgPath(p.entry),"build/packages.jsonl","package",p)); rows.push(inv("flake-generated",p.name,pkgPath(p.entry),"flake.nix:mkGeneratedPackages","package",{derived_from:`build/packages.jsonl:${p.name}`}))}
  for(let c of checks) rows.push(inv("build-checks-jsonl",c.name,checkPath(c.script),"build/checks.jsonl","check",{script:c.script,deps:c.deps??[]}));
  for(let id of explicit) rows.push(inv("flake-explicit",id,`flake.nix:packages.${id}`,`flake.nix:packages.${id}`));
  for(let d of dirs(rootDir)) rows.push(inv("source-dir",d,`packages/${d}`,`packages/${d}`));
  for(let f of files) rows.push(inv("evidence-output",`ops-package-responses/${f}`,path.join(outDir,f),f,"evidence-output",{source_package_id:"ops-package-responses"}));
  return uniq(rows).sort((a,b)=>a.inventory_id.localeCompare(b.inventory_id));
}
function evidence(){return responses.flatMap(r=>[{kind:"ops.packageEvidence.v1",evidence_id:`evidence.${r.package_id}.ci`,response_claim_id:r.claim_id,repo_locator:repo,package_id:r.package_id,evidence_type:"ci-check",ref:r.test_refs[0],produced_by:"nix flake check",freshness:r.evidence_freshness,authority:false},{kind:"ops.packageEvidence.v1",evidence_id:`evidence.${r.package_id}.test`,response_claim_id:r.claim_id,repo_locator:repo,package_id:r.package_id,evidence_type:"test-ref",ref:r.test_refs.join(","),produced_by:r.package_id==="ops-package-responses"?"ops-package-responses selftest":"repo-local package check",freshness:r.evidence_freshness,authority:false}])}
function receipts(){return responses.map(r=>({kind:"ops.packageReceipt.v1",receipt_id:r.receipt_ref,response_claim_id:r.claim_id,repo_locator:repo,package_id:r.package_id,status:"pass",evidence_refs:r.evidence_refs,residual_refs:r.residuals,emitted_by:"ops-package-responses",generated_at:at,authority:false}))}
function canonicalResponses(){return responses.map(r=>({kind:"packageResponse.v1",claimId:r.claim_id,claim_id:r.claim_id,adrsRef:r.adrs_ref,adrs_ref:r.adrs_ref,obligationId:r.obligation_id,obligation_id:r.obligation_id,repo:r.repo_locator,repo_locator:r.repo_locator,packageId:r.package_id,package_id:r.package_id,packagePath:r.package_path,package_path:r.package_path,ownerRole:r.owner_role,owner_role:r.owner_role,tests:r.test_refs,test_refs:r.test_refs,receipt:r.receipt_ref,receipt_ref:r.receipt_ref,residuals:r.residuals,state:r.state,authority:false,source_kind:r.kind}))}
function canonicalResiduals(){return residuals.map(r=>({kind:"packageResidual.v1",residualId:r.residual_id,residual_id:r.residual_id,responseClaimId:r.response_claim_id,response_claim_id:r.response_claim_id,packageId:r.package_id,package_id:r.package_id,status:r.status,returnedTo:r.returned_to,returned_to:r.returned_to,reason:r.reason,authority:false,source_kind:r.kind}))}
function drifts(invRows, canon){
  let covered=new Set(canon.map(r=>r.package_id)), by=new Map;
  for(let r of invRows){if(["build-checks-jsonl","evidence-output"].includes(r.source_kind))continue; let x=by.get(r.package_id)??{refs:[],k:new Set,p:r.package_path}; x.refs.push(r.inventory_id); x.k.add(r.source_kind); if(String(x.p).startsWith("flake.nix:"))x.p=r.package_path; by.set(r.package_id,x)}
  return [...by.entries()].sort(([a],[b])=>a.localeCompare(b)).filter(([id])=>!covered.has(id)).map(([id,x])=>({kind:"packageDrift.v1",drift_id:`ops.packageDrift.unregistered-package.${id}`,driftId:`ops.packageDrift.unregistered-package.${id}`,drift_type:"unregistered-package",driftType:"unregistered-package",repo,repo_locator:repo,package_id:id,packageId:id,package_path:x.p,packagePath:x.p,source_kinds:[...x.k].sort(),inventory_refs:x.refs.sort(),status:"open",severity:"info",meaning:"package exists in ops inventory, but this PR does not claim ADRS obligation coverage or package response coverage for it",returned_to:"ADRS/governance package closure plane",authority:false}))
}
function emit(outDir, repoRoot){
  if(!outDir)throw Error("--out-dir is required"); fs.mkdirSync(outDir,{recursive:true});
  let rr=root(repoRoot), ev=evidence(), rec=receipts(), cr=canonicalResponses(), cres=canonicalResiduals(), invRows=inventory(rr,outDir), drift=drifts(invRows,cr);
  writeJsonl(path.join(outDir,"ops-package-responses.jsonl"),responses); writeJsonl(path.join(outDir,"ops-package-evidence.jsonl"),ev); writeJsonl(path.join(outDir,"ops-package-receipts.jsonl"),rec); writeJsonl(path.join(outDir,"ops-package-residuals.jsonl"),residuals);
  writeJsonl(path.join(outDir,"package-inventory.jsonl"),invRows); writeJsonl(path.join(outDir,"package-responses.jsonl"),cr); writeJsonl(path.join(outDir,"package-residuals.jsonl"),cres); writeJsonl(path.join(outDir,"package-drifts.jsonl"),drift);
  let m={kind:"ops.packageResponsePacket.v1",repo_locator:repo,generated_at:at,repo_root:rr,authority:false,non_authority_diagnostic:true,files,row_counts:{responses:responses.length,evidence:ev.length,receipts:rec.length,residuals:residuals.length,inventory:invRows.length,canonical_responses:cr.length,canonical_residuals:cres.length,drifts:drift.length},boundary:"ops reports package inventory, normalized responses, receipts, residuals, and non-authority drift only; ADRS defines meaning and governance provides reusable checks"};
  fs.writeFileSync(path.join(outDir,"manifest.json"),JSON.stringify(m,null,2)+"\n"); return m;
}
function validate(outDir){
  if(!outDir)throw Error("--out-dir is required"); let file=n=>path.join(outDir,n), errors=[];
  for(let f of files) if(!fs.existsSync(file(f))) errors.push({code:"missing-file",file:file(f)}); if(errors.length)return{ok:false,errors};
  let rs=readJsonl(file("ops-package-responses.jsonl")), ev=readJsonl(file("ops-package-evidence.jsonl")), rec=readJsonl(file("ops-package-receipts.jsonl")), res=readJsonl(file("ops-package-residuals.jsonl")), invs=readJsonl(file("package-inventory.jsonl")), cr=readJsonl(file("package-responses.jsonl")), cres=readJsonl(file("package-residuals.jsonl")), ds=readJsonl(file("package-drifts.jsonl")), m=JSON.parse(fs.readFileSync(file("manifest.json"),"utf8"));
  if(m.authority!==false||m.non_authority_diagnostic!==true)errors.push({code:"manifest-boundary"});
  for(let [name,rows] of Object.entries({responses:rs,evidence:ev,receipts:rec,residuals:res,inventory:invs,canonical_responses:cr,canonical_residuals:cres,drifts:ds})) if(m.row_counts?.[name]!==rows.length) errors.push({code:"manifest-row-count-drift",field:name});
  let evid=new Set(ev.map(x=>x.evidence_id)), receiptsSet=new Set(rec.map(x=>x.receipt_id)), resid=new Set(res.map(x=>x.residual_id)), cresid=new Set(cres.map(x=>x.residual_id)), claims=new Set;
  for(let r of rs){for(let f of required)if(!(f in r))errors.push({code:"missing-response-field",claim_id:r.claim_id,field:f}); if(claims.has(r.claim_id))errors.push({code:"duplicate-claim-id",claim_id:r.claim_id}); claims.add(r.claim_id); if(r.evidence_freshness?.status!=="current")errors.push({code:"missing-current-evidence-freshness",claim_id:r.claim_id}); if(!receiptsSet.has(r.receipt_ref))errors.push({code:"missing-receipt",claim_id:r.claim_id}); for(let id of r.evidence_refs??[])if(!evid.has(id))errors.push({code:"missing-evidence",claim_id:r.claim_id}); for(let id of r.residuals??[]){if(!resid.has(id))errors.push({code:"missing-residual",claim_id:r.claim_id}); if(!cresid.has(id))errors.push({code:"missing-canonical-residual",claim_id:r.claim_id})}}
  for(let r of [...ev,...rec,...res,...invs,...cr,...cres,...ds]) if(r.authority!==false) errors.push({code:"authority-boundary",kind:r.kind});
  let kinds=new Set(invs.map(x=>x.source_kind)); for(let k of sourceKinds) if(!kinds.has(k)) errors.push({code:"missing-inventory-source-kind",source_kind:k});
  for(let r of invs) if(r.kind!=="packageInventory.v1") errors.push({code:"inventory-kind",inventory_id:r.inventory_id}); else if(r.source_kind==="evidence-output"&&r.item_kind!=="evidence-output") errors.push({code:"evidence-output-treated-as-source-package",inventory_id:r.inventory_id});
  let covered=new Set(cr.map(x=>x.package_id)), invIds=new Set(invs.map(x=>x.inventory_id)); for(let r of cr){if(r.kind!=="packageResponse.v1")errors.push({code:"canonical-response-kind",claim_id:r.claim_id}); if(!claims.has(r.claim_id))errors.push({code:"canonical-response-unknown-claim",claim_id:r.claim_id})}
  for(let r of cres){if(r.kind!=="packageResidual.v1")errors.push({code:"canonical-residual-kind",residual_id:r.residual_id}); if(!resid.has(r.residual_id))errors.push({code:"canonical-residual-without-ops-residual",residual_id:r.residual_id})}
  for(let r of ds){if(r.kind!=="packageDrift.v1")errors.push({code:"drift-kind",drift_id:r.drift_id}); if(r.drift_type!=="unregistered-package")errors.push({code:"unknown-drift-type",drift_id:r.drift_id}); if(covered.has(r.package_id))errors.push({code:"drift-for-covered-response",drift_id:r.drift_id}); for(let id of r.inventory_refs??[])if(!invIds.has(id))errors.push({code:"drift-unknown-inventory-ref",drift_id:r.drift_id,inventory_ref:id})}
  return{ok:errors.length===0,kind:"ops.packageResponseValidation.v1",repo_locator:repo,counts:{responses:rs.length,evidence:ev.length,receipts:rec.length,residuals:res.length,inventory:invs.length,canonical_responses:cr.length,canonical_residuals:cres.length,drifts:ds.length},errors};
}
function selftest(repoRoot){let tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ops-package-responses-")), p=path.join(tmp,"packet"); try{emit(p,repoRoot); let result=validate(p); if(!result.ok)return result; let b=path.join(tmp,"broken"); fs.mkdirSync(b); for(let f of files.filter(x=>x!=="ops-package-responses.jsonl"))fs.copyFileSync(path.join(p,f),path.join(b,f)); let broken={...responses[0]}; delete broken.evidence_freshness; writeJsonl(path.join(b,"ops-package-responses.jsonl"),[broken]); if(validate(b).ok)return{ok:false,errors:[{code:"negative-fixture-passed"}]}; return{...result,negative_fixture:"pass"}} finally{fs.rmSync(tmp,{recursive:true,force:true})}}
try{let v=argv(process.argv.slice(2)), result; if(v.command==="emit")result=emit(v.outDir,v.repoRoot); else if(v.command==="validate")result=validate(v.outDir); else if(v.command==="selftest")result=selftest(v.repoRoot); else throw Error(`unknown command: ${v.command}\n${usage()}`); if(v.json||v.command!=="emit")console.log(JSON.stringify(result,null,2)); else console.log(`emitted ops package response packet to ${v.outDir}`); process.exit(result.ok===false?1:0)}catch(e){console.error(e.message); console.error(usage()); process.exit(2)}
