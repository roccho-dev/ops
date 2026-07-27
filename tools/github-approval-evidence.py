#!/usr/bin/env python3
from __future__ import annotations
import argparse, copy, hashlib, json, os, urllib.error, urllib.request
from pathlib import Path
from typing import Any

ADAPTER_VERSION="github-approval-evidence.v1"
PACKAGE_IDENTITY="nix:github-approval-evidence"
SCHEMA_DIGESTS={
 "authorityGrant.v1":"sha256:a0c52c668cd0267ee6187fa3f84a79ce6bd8d6a5e76b4e1d433ee976a8d60cab",
 "githubApprovalEvidence.v1":"sha256:afd88be8835b4294195050eb0354fa97361778de2dda07728f36a44587292e80",
 "approvalReceipt.v1":"sha256:d3d52f076a94dce2693827aebecae7fdc18d5345bd2e0be39c85f090bc028ff4",
 "implementationManifest.v1":"sha256:e264ffc287eb4adcdf4b2ee6e5b2194300dd76963f913fec511e387ac5663957",
}
COMPLETE,INCOMPLETE,ERROR="COMPLETE","INCOMPLETE","ERROR"
Json=dict[str,Any]
REQUIRED_KEYS={
 "kind","provider","repository_id","repository_full_name","pull_request_number","pull_request_id",
 "candidate_revision","review_id","review_commit_id","review_state","review_submitted_at",
 "review_dismissed","actor_account_id","actor_login","actor_type","observed_at",
 "provider_response_digest","adapter_manifest_digest","status","findings","claim_ceiling",
}
CODES={
"GITHUB_REPOSITORY_NOT_FOUND","GITHUB_REPOSITORY_ID_MISMATCH",
"GITHUB_PULL_REQUEST_NOT_FOUND","GITHUB_PULL_REQUEST_ID_MISMATCH",
"GITHUB_HEAD_SHA_MISMATCH","GITHUB_REVIEW_NOT_FOUND","GITHUB_REVIEW_ID_MISMATCH",
"GITHUB_REVIEW_COMMIT_MISMATCH","GITHUB_REVIEW_STATE_NOT_APPROVED",
"GITHUB_REVIEW_DISMISSED","GITHUB_REVIEW_STATE_AMBIGUOUS",
"GITHUB_ACTOR_ID_MISSING","GITHUB_ACTOR_ID_MISMATCH","GITHUB_ACTOR_LOGIN_MISMATCH",
"GITHUB_PAGINATION_INCOMPLETE","GITHUB_RATE_LIMITED","GITHUB_AUTHENTICATION_FAILED",
"GITHUB_PROVIDER_RESPONSE_MALFORMED","GITHUB_PROVIDER_RESPONSE_DIGEST_MISMATCH",
"GITHUB_OBSERVED_AT_MISSING","GITHUB_ADAPTER_UNKNOWN","GITHUB_READBACK_EXCEPTION"}

def canonical(v:Any)->str:return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"))
def digest(v:Any)->str:return "sha256:"+hashlib.sha256(canonical(v).encode()).hexdigest()
def file_digest(path:Path)->str:return "sha256:"+hashlib.sha256(path.read_bytes()).hexdigest()
def source_path()->Path:return Path(__file__).resolve()
def adapter_manifest()->Json:
 return {
  "kind":"githubApprovalAdapterManifest.v1",
  "component":"ops.github-approval-evidence",
  "version":ADAPTER_VERSION,
  "source_files":[{"path":"tools/github-approval-evidence.py","sha256":file_digest(source_path())}],
  "schema_digests":SCHEMA_DIGESTS,
  "package_identity":PACKAGE_IDENTITY,
 }
def adapter_manifest_digest()->str:return digest(adapter_manifest())
def finding(code:str,expected:Any,actual:Any,next_action:str)->Json:
 assert code in CODES
 return {"code":code,"expected":expected,"actual":actual,"owner":"ops","next_action":next_action}
def ceiling()->Json:
 return {"authority_grant_validity_proven":False,"physical_human_identity_proven":False,"account_non_compromise_proven":False,"provider_independent_non_repudiation_proven":False}

def base_envelope(*,observed_at:Any,status:str,findings:list[Json],facts:Json|None=None)->Json:
 facts=facts or {}
 return {
  "kind":"githubApprovalEvidence.v1","provider":"github",
  "repository_id":facts.get("repository_id"),"repository_full_name":facts.get("repository_full_name"),
  "pull_request_number":facts.get("pull_request_number"),"pull_request_id":facts.get("pull_request_id"),
  "candidate_revision":facts.get("candidate_revision"),"review_id":facts.get("review_id"),
  "review_commit_id":facts.get("review_commit_id"),"review_state":facts.get("review_state"),
  "review_submitted_at":facts.get("review_submitted_at"),"review_dismissed":facts.get("review_dismissed"),
  "actor_account_id":facts.get("actor_account_id"),"actor_login":facts.get("actor_login"),
  "actor_type":facts.get("actor_type"),"observed_at":observed_at,
  "provider_response_digest":facts.get("provider_response_digest"),
  "adapter_manifest_digest":adapter_manifest_digest(),"status":status,
  "findings":sorted(findings,key=lambda x:(x["code"],canonical(x))),"claim_ceiling":ceiling(),
 }
def error_envelope(request:Any,observed_at:Any,code:str,actual:Any)->Json:
 facts={"candidate_revision":request.get("candidate_revision") if isinstance(request,dict) else None}
 return base_envelope(observed_at=observed_at,status=ERROR,facts=facts,findings=[finding(code,"complete provider readback",actual,"repair provider readback and rerun")])

def safe_subset(repo:Json,pr:Json,review:Json)->Json:
 user=review.get("user") or {}
 return {
  "repository_id":repo.get("id"),"repository_full_name":repo.get("full_name"),
  "pull_request_number":pr.get("number"),"pull_request_id":pr.get("id"),
  "candidate_revision":(pr.get("head") or {}).get("sha"),
  "review_id":review.get("id"),"review_commit_id":review.get("commit_id"),
  "review_state":review.get("state"),"review_submitted_at":review.get("submitted_at"),
  "review_dismissed":review.get("dismissed",False),
  "actor_account_id":user.get("id"),"actor_login":user.get("login"),"actor_type":user.get("type"),
 }
def validate_shape(value:Json)->None:
 assert set(value)==REQUIRED_KEYS,set(value)^REQUIRED_KEYS
 assert value["kind"]=="githubApprovalEvidence.v1" and value["provider"]=="github"
 assert value["status"] in {COMPLETE,INCOMPLETE,ERROR}
 assert value["adapter_manifest_digest"]==adapter_manifest_digest()
 assert value["claim_ceiling"]==ceiling()

def normalize_github_approval_evidence(provider_bundle:Json,request:Json,observed_at:str|None)->Json:
 findings:list[Json]=[]
 if not observed_at:return error_envelope(request,observed_at,"GITHUB_OBSERVED_AT_MISSING",observed_at)
 if not isinstance(provider_bundle,dict):return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED",type(provider_bundle).__name__)
 if set(provider_bundle)-{"repository","pull_request","reviews","pagination_complete","provider_response_digest"}:return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED","unknown provider bundle keys")
 request_keys={"repository","repository_id","pull_request_number","pull_request_id","review_id","candidate_revision","actor_account_id","actor_login"}
 if not isinstance(request,dict) or set(request)!=request_keys:return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED","closed request required")
 repo,pr,reviews=provider_bundle.get("repository"),provider_bundle.get("pull_request"),provider_bundle.get("reviews")
 if not isinstance(repo,dict):return error_envelope(request,observed_at,"GITHUB_REPOSITORY_NOT_FOUND",repo)
 if not isinstance(pr,dict):return error_envelope(request,observed_at,"GITHUB_PULL_REQUEST_NOT_FOUND",pr)
 if not isinstance(reviews,list):return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED","reviews list required")
 if provider_bundle.get("pagination_complete") is not True:findings.append(finding("GITHUB_PAGINATION_INCOMPLETE",True,provider_bundle.get("pagination_complete"),"fetch all pages before selecting review"))
 selected=[r for r in reviews if isinstance(r,dict) and r.get("id")==request.get("review_id")]
 if not selected:findings.append(finding("GITHUB_REVIEW_NOT_FOUND",request.get("review_id"),0,"read exact review id"))
 elif len(selected)>1:findings.append(finding("GITHUB_REVIEW_STATE_AMBIGUOUS",1,len(selected),"reject duplicate provider review objects"))
 review=selected[0] if len(selected)==1 else {}
 facts=safe_subset(repo,pr,review)
 if repo.get("full_name")!=request.get("repository"):findings.append(finding("GITHUB_REPOSITORY_NOT_FOUND",request.get("repository"),repo.get("full_name"),"read requested repository"))
 if repo.get("id")!=request.get("repository_id"):findings.append(finding("GITHUB_REPOSITORY_ID_MISMATCH",request.get("repository_id"),repo.get("id"),"bind numeric repository id"))
 if pr.get("number")!=request.get("pull_request_number"):findings.append(finding("GITHUB_PULL_REQUEST_NOT_FOUND",request.get("pull_request_number"),pr.get("number"),"read requested pull request"))
 if pr.get("id")!=request.get("pull_request_id"):findings.append(finding("GITHUB_PULL_REQUEST_ID_MISMATCH",request.get("pull_request_id"),pr.get("id"),"bind provider pull request id"))
 if facts["candidate_revision"]!=request.get("candidate_revision"):findings.append(finding("GITHUB_HEAD_SHA_MISMATCH",request.get("candidate_revision"),facts["candidate_revision"],"re-read current head or request exact candidate"))
 if review:
  if review.get("commit_id")!=request.get("candidate_revision"):findings.append(finding("GITHUB_REVIEW_COMMIT_MISMATCH",request.get("candidate_revision"),review.get("commit_id"),"review exact candidate revision"))
  if review.get("state")!="APPROVED":findings.append(finding("GITHUB_REVIEW_STATE_NOT_APPROVED","APPROVED",review.get("state"),"use an approved review"))
  if review.get("dismissed") is True or review.get("state")=="DISMISSED":findings.append(finding("GITHUB_REVIEW_DISMISSED",False,True,"exclude dismissed review"))
  user=review.get("user") or {}
  if user.get("id") in (None,""):findings.append(finding("GITHUB_ACTOR_ID_MISSING","numeric account id",user.get("id"),"read provider numeric actor id"))
  elif user.get("id")!=request.get("actor_account_id"):findings.append(finding("GITHUB_ACTOR_ID_MISMATCH",request.get("actor_account_id"),user.get("id"),"bind numeric actor id"))
  if user.get("login")!=request.get("actor_login"):findings.append(finding("GITHUB_ACTOR_LOGIN_MISMATCH",request.get("actor_login"),user.get("login"),"read login alias for numeric id"))
 calculated=digest(facts)
 facts["provider_response_digest"]=calculated
 if provider_bundle.get("provider_response_digest")!=calculated:findings.append(finding("GITHUB_PROVIDER_RESPONSE_DIGEST_MISMATCH",calculated,provider_bundle.get("provider_response_digest"),"recompute canonical provider subset digest"))
 incomplete={"GITHUB_REVIEW_NOT_FOUND","GITHUB_REVIEW_STATE_AMBIGUOUS","GITHUB_PAGINATION_INCOMPLETE","GITHUB_ACTOR_ID_MISSING","GITHUB_PROVIDER_RESPONSE_MALFORMED"}
 status=INCOMPLETE if {f["code"] for f in findings}&incomplete else COMPLETE
 out=base_envelope(observed_at=observed_at,status=status,facts=facts,findings=findings)
 validate_shape(out);return out

def api_get(url:str,token:str)->Any:
 req=urllib.request.Request(url,headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":ADAPTER_VERSION},method="GET")
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
 except urllib.error.HTTPError as exc:
  if exc.code in (401,403):raise RuntimeError("GITHUB_AUTHENTICATION_FAILED") from exc
  if exc.code==404:raise RuntimeError("GITHUB_PROVIDER_RESPONSE_MALFORMED") from exc
  if exc.code==429:raise RuntimeError("GITHUB_RATE_LIMITED") from exc
  raise RuntimeError("GITHUB_READBACK_EXCEPTION") from exc

def read_github_approval_evidence(repository:str,pull_request_number:int,review_id:int,candidate_revision:str,observed_at:str,token:str,repository_id:int,pull_request_id:int,actor_account_id:int,actor_login:str)->Json:
 base=f"https://api.github.com/repos/{repository}"
 try:
  repo=api_get(base,token);pr=api_get(f"{base}/pulls/{pull_request_number}",token);reviews=[];page=1
  while True:
   rows=api_get(f"{base}/pulls/{pull_request_number}/reviews?per_page=100&page={page}",token)
   if not isinstance(rows,list):raise RuntimeError("GITHUB_PROVIDER_RESPONSE_MALFORMED")
   reviews.extend(rows)
   if len(rows)<100:break
   page+=1
   if page>100:raise RuntimeError("GITHUB_PAGINATION_INCOMPLETE")
  selected=[r for r in reviews if r.get("id")==review_id]
  if len(selected)==1:selected[0]["dismissed"]=selected[0].get("state")=="DISMISSED"
  subset=safe_subset(repo,pr,selected[0] if len(selected)==1 else {})
  bundle={"repository":repo,"pull_request":pr,"reviews":reviews,"pagination_complete":True,"provider_response_digest":digest(subset)}
  request={"repository":repository,"repository_id":repository_id,"pull_request_number":pull_request_number,"pull_request_id":pull_request_id,"review_id":review_id,"candidate_revision":candidate_revision,"actor_account_id":actor_account_id,"actor_login":actor_login}
  return normalize_github_approval_evidence(bundle,request,observed_at)
 except RuntimeError as exc:
  code=str(exc) if str(exc) in CODES else "GITHUB_READBACK_EXCEPTION";return error_envelope({"candidate_revision":candidate_revision},observed_at,code,str(exc))
 except Exception as exc:return error_envelope({"candidate_revision":candidate_revision},observed_at,"GITHUB_READBACK_EXCEPTION",type(exc).__name__)

def fixture()->tuple[Json,Json,str]:
 repo={"id":1285891542,"full_name":"roccho-dev/diagrams"};pr={"number":15,"id":90000015,"head":{"sha":"a"*40}}
 review={"id":7001,"state":"APPROVED","commit_id":"a"*40,"submitted_at":"2026-07-20T12:00:00Z","dismissed":False,"user":{"id":40359643,"login":"roccho-dev","type":"User"}}
 subset=safe_subset(repo,pr,review)
 bundle={"repository":repo,"pull_request":pr,"reviews":[review],"pagination_complete":True,"provider_response_digest":digest(subset)}
 request={"repository":"roccho-dev/diagrams","repository_id":1285891542,"pull_request_number":15,"pull_request_id":90000015,"review_id":7001,"candidate_revision":"a"*40,"actor_account_id":40359643,"actor_login":"roccho-dev"}
 return bundle,request,"2026-07-20T12:01:00Z"

def selftest()->Json:
 bundle,request,observed=fixture();ok=normalize_github_approval_evidence(bundle,request,observed)
 assert ok["status"]==COMPLETE and not ok["findings"],ok
 assert canonical(ok)==canonical(normalize_github_approval_evidence(bundle,request,observed))
 assert ok["adapter_manifest_digest"]==digest(adapter_manifest())
 assert adapter_manifest()["source_files"][0]["sha256"]==file_digest(source_path())
 assert ok["adapter_manifest_digest"]!="sha256:"+hashlib.sha256(ADAPTER_VERSION.encode()).hexdigest()
 mutations=[
 ("D01-repo-id",lambda b,r,h:b["repository"].__setitem__("id",1),"GITHUB_REPOSITORY_ID_MISMATCH"),
 ("D02-pr-id",lambda b,r,h:b["pull_request"].__setitem__("id",1),"GITHUB_PULL_REQUEST_ID_MISMATCH"),
 ("D03-head",lambda b,r,h:b["pull_request"]["head"].__setitem__("sha","f"*40),"GITHUB_HEAD_SHA_MISMATCH"),
 ("D04-review-commit",lambda b,r,h:b["reviews"][0].__setitem__("commit_id","f"*40),"GITHUB_REVIEW_COMMIT_MISMATCH"),
 ("D05-review-absent",lambda b,r,h:b.__setitem__("reviews",[]),"GITHUB_REVIEW_NOT_FOUND"),
 ("D06-review-duplicate",lambda b,r,h:b["reviews"].append(copy.deepcopy(b["reviews"][0])),"GITHUB_REVIEW_STATE_AMBIGUOUS"),
 ("D07-commented",lambda b,r,h:b["reviews"][0].__setitem__("state","COMMENTED"),"GITHUB_REVIEW_STATE_NOT_APPROVED"),
 ("D08-changes",lambda b,r,h:b["reviews"][0].__setitem__("state","CHANGES_REQUESTED"),"GITHUB_REVIEW_STATE_NOT_APPROVED"),
 ("D09-dismissed",lambda b,r,h:b["reviews"][0].__setitem__("dismissed",True),"GITHUB_REVIEW_DISMISSED"),
 ("D10-actor-id",lambda b,r,h:b["reviews"][0]["user"].__setitem__("id",1),"GITHUB_ACTOR_ID_MISMATCH"),
 ("D11-actor-missing",lambda b,r,h:b["reviews"][0]["user"].__setitem__("id",None),"GITHUB_ACTOR_ID_MISSING"),
 ("D12-pagination",lambda b,r,h:b.__setitem__("pagination_complete",False),"GITHUB_PAGINATION_INCOMPLETE"),
 ("D13-malformed",lambda b,r,h:b.__setitem__("repository",None),"GITHUB_REPOSITORY_NOT_FOUND"),
 ("D14-digest",lambda b,r,h:b.__setitem__("provider_response_digest","sha256:"+"0"*64),"GITHUB_PROVIDER_RESPONSE_DIGEST_MISMATCH"),
 ("D15-auth",lambda b,r,h:h.__setitem__("direct",error_envelope(r,h["observed"],"GITHUB_AUTHENTICATION_FAILED","401")),"GITHUB_AUTHENTICATION_FAILED"),
 ("D16-permission",lambda b,r,h:b.__setitem__("current_permission","admin"),"GITHUB_PROVIDER_RESPONSE_MALFORMED"),
 ("D17-observed",lambda b,r,h:h.__setitem__("observed",None),"GITHUB_OBSERVED_AT_MISSING"),
 ("D18-other-repo",lambda b,r,h:b["repository"].__setitem__("full_name","roccho-dev/ops"),"GITHUB_REPOSITORY_NOT_FOUND"),
 ("D19-secret",lambda b,r,h:b.__setitem__("token","secret"),"GITHUB_PROVIDER_RESPONSE_MALFORMED"),
 ("D20-review-state-unknown",lambda b,r,h:b["reviews"][0].__setitem__("state","UNKNOWN"),"GITHUB_REVIEW_STATE_NOT_APPROVED"),
 ("D21-actor-login",lambda b,r,h:b["reviews"][0]["user"].__setitem__("login","other"),"GITHUB_ACTOR_LOGIN_MISMATCH"),
 ("D22-exception",lambda b,r,h:h.__setitem__("direct",error_envelope(r,h["observed"],"GITHUB_READBACK_EXCEPTION","TypeError")),"GITHUB_READBACK_EXCEPTION"),
 ]
 rejected=[]
 for name,mutate,expected in mutations:
  b,r,o=copy.deepcopy(bundle),copy.deepcopy(request),{"observed":observed}
  mutate(b,r,o)
  candidate=o.get("direct") or normalize_github_approval_evidence(b,r,o["observed"])
  codes={x["code"] for x in candidate["findings"]}
  assert expected in codes,(name,candidate)
  assert not (candidate["status"]==COMPLETE and not candidate["findings"]),(name,candidate)
  validate_shape(candidate);rejected.append(name)
 return {"kind":"githubApprovalEvidence.selftest.v1","status":"PASS","positiveCases":1,"destructiveCases":len(rejected),"adapterManifestDigest":adapter_manifest_digest(),"schemaDigest":SCHEMA_DIGESTS["githubApprovalEvidence.v1"],"cases":rejected,"claim_ceiling":ceiling()}

def main()->int:
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest="command",required=True)
 sub.add_parser("selftest");sub.add_parser("manifest")
 live=sub.add_parser("read")
 for name,typ in [("repository",str),("pull-request-number",int),("review-id",int),("candidate-revision",str),("observed-at",str),("repository-id",int),("pull-request-id",int),("actor-account-id",int),("actor-login",str)]:live.add_argument("--"+name,required=True,type=typ)
 live.add_argument("--token-env",default="GITHUB_TOKEN")
 args=p.parse_args()
 if args.command=="selftest":value=selftest()
 elif args.command=="manifest":value={**adapter_manifest(),"manifest_digest":adapter_manifest_digest()}
 else:value=read_github_approval_evidence(args.repository,args.pull_request_number,args.review_id,args.candidate_revision,args.observed_at,os.environ.get(args.token_env,""),args.repository_id,args.pull_request_id,args.actor_account_id,args.actor_login)
 print(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":")));return 0 if value.get("status") in {COMPLETE,"PASS"} else 1
if __name__=="__main__":raise SystemExit(main())
