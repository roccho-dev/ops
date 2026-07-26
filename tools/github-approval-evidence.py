#!/usr/bin/env python3
from __future__ import annotations
import argparse, copy, hashlib, json, os, urllib.error, urllib.request
from pathlib import Path
from typing import Any

ADAPTER_VERSION="github-approval-evidence.v1"
ADAPTER_DIGEST="sha256:"+hashlib.sha256(ADAPTER_VERSION.encode()).hexdigest()
COMPLETE,INCOMPLETE,ERROR="COMPLETE","INCOMPLETE","ERROR"
Json=dict[str,Any]
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
def finding(code:str,expected:Any,actual:Any,next_action:str)->Json:
    assert code in CODES
    return {"code":code,"expected":expected,"actual":actual,"owner":"ops","next_action":next_action}
def ceiling()->Json:
    return {"authority_grant_validity_proven":False,"physical_human_identity_proven":False,"account_non_compromise_proven":False,"provider_independent_non_repudiation_proven":False}
def safe_subset(repo:Json,pr:Json,review:Json)->Json:
    return {
      "repository":{"id":repo.get("id"),"full_name":repo.get("full_name")},
      "pull_request":{"number":pr.get("number"),"id":pr.get("id"),"node_id":pr.get("node_id"),"head_sha":(pr.get("head") or {}).get("sha"),"base_ref":(pr.get("base") or {}).get("ref"),"base_sha":(pr.get("base") or {}).get("sha")},
      "review":{"id":review.get("id"),"node_id":review.get("node_id"),"state":review.get("state"),"commit_id":review.get("commit_id"),"submitted_at":review.get("submitted_at"),"dismissed":review.get("dismissed",False)},
      "actor":{"account_id":(review.get("user") or {}).get("id"),"login":(review.get("user") or {}).get("login"),"type":(review.get("user") or {}).get("type")},
    }

def error_envelope(request:Any,observed_at:Any,code:str,actual:Any)->Json:
    return {"kind":"githubApprovalEvidence.v1","provider":"github","repository":None,"pull_request":None,"review":None,"actor":None,"request":{"candidate_revision":request.get("candidate_revision") if isinstance(request,dict) else None},"observation":{"observed_at":observed_at,"provider_response_digest":None,"adapter_digest":ADAPTER_DIGEST},"status":ERROR,"current_approval":False,"findings":[finding(code,"complete provider readback",actual,"repair provider readback and rerun")],"claim_ceiling":ceiling()}

def normalize_github_approval_evidence(provider_bundle:Json,request:Json,observed_at:str|None,adapter_identity:Json)->Json:
    """Normalize recorded provider facts. Authority is intentionally not evaluated."""
    findings:list[Json]=[]
    if not observed_at:return error_envelope(request,observed_at,"GITHUB_OBSERVED_AT_MISSING",observed_at)
    if adapter_identity!={"version":ADAPTER_VERSION,"digest":ADAPTER_DIGEST}:return error_envelope(request,observed_at,"GITHUB_ADAPTER_UNKNOWN",adapter_identity)
    if not isinstance(provider_bundle,dict):return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED",type(provider_bundle).__name__)
    if set(provider_bundle)-{"repository","pull_request","reviews","pagination_complete","provider_response_digest"}:return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED","unknown provider bundle keys")
    if not isinstance(request,dict) or set(request)!={"repository","repository_id","pull_request_number","pull_request_id","review_id","candidate_revision","actor_account_id","actor_login"}:return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED","closed request required")
    repo,pr,reviews=provider_bundle.get("repository"),provider_bundle.get("pull_request"),provider_bundle.get("reviews")
    if not isinstance(repo,dict):return error_envelope(request,observed_at,"GITHUB_REPOSITORY_NOT_FOUND",repo)
    if not isinstance(pr,dict):return error_envelope(request,observed_at,"GITHUB_PULL_REQUEST_NOT_FOUND",pr)
    if not isinstance(reviews,list):return error_envelope(request,observed_at,"GITHUB_PROVIDER_RESPONSE_MALFORMED","reviews list required")
    if provider_bundle.get("pagination_complete") is not True:findings.append(finding("GITHUB_PAGINATION_INCOMPLETE",True,provider_bundle.get("pagination_complete"),"fetch all pages before selecting review"))
    selected=[r for r in reviews if isinstance(r,dict) and r.get("id")==request.get("review_id")]
    if not selected:findings.append(finding("GITHUB_REVIEW_NOT_FOUND",request.get("review_id"),0,"read exact review id"))
    elif len(selected)>1:findings.append(finding("GITHUB_REVIEW_STATE_AMBIGUOUS",1,len(selected),"reject duplicate provider review objects"))
    review=selected[0] if len(selected)==1 else {}
    if repo.get("full_name")!=request.get("repository"):findings.append(finding("GITHUB_REPOSITORY_NOT_FOUND",request.get("repository"),repo.get("full_name"),"read requested repository"))
    if repo.get("id")!=request.get("repository_id"):findings.append(finding("GITHUB_REPOSITORY_ID_MISMATCH",request.get("repository_id"),repo.get("id"),"bind numeric repository id"))
    if pr.get("number")!=request.get("pull_request_number"):findings.append(finding("GITHUB_PULL_REQUEST_NOT_FOUND",request.get("pull_request_number"),pr.get("number"),"read requested pull request"))
    if pr.get("id")!=request.get("pull_request_id"):findings.append(finding("GITHUB_PULL_REQUEST_ID_MISMATCH",request.get("pull_request_id"),pr.get("id"),"bind provider pull request id"))
    head=(pr.get("head") or {}).get("sha")
    if head!=request.get("candidate_revision"):findings.append(finding("GITHUB_HEAD_SHA_MISMATCH",request.get("candidate_revision"),head,"re-read current head or request exact candidate"))
    if review:
        if review.get("id")!=request.get("review_id"):findings.append(finding("GITHUB_REVIEW_ID_MISMATCH",request.get("review_id"),review.get("id"),"select exact review"))
        if review.get("commit_id")!=request.get("candidate_revision"):findings.append(finding("GITHUB_REVIEW_COMMIT_MISMATCH",request.get("candidate_revision"),review.get("commit_id"),"review exact candidate revision"))
        if review.get("state")!="APPROVED":findings.append(finding("GITHUB_REVIEW_STATE_NOT_APPROVED","APPROVED",review.get("state"),"use an approved review"))
        if review.get("dismissed") is True or review.get("state")=="DISMISSED":findings.append(finding("GITHUB_REVIEW_DISMISSED",False,True,"exclude dismissed review"))
        user=review.get("user") or {}
        if user.get("id") in (None,""):findings.append(finding("GITHUB_ACTOR_ID_MISSING","numeric account id",user.get("id"),"read provider numeric actor id"))
        elif user.get("id")!=request.get("actor_account_id"):findings.append(finding("GITHUB_ACTOR_ID_MISMATCH",request.get("actor_account_id"),user.get("id"),"bind numeric actor id"))
        if user.get("login")!=request.get("actor_login"):findings.append(finding("GITHUB_ACTOR_LOGIN_MISMATCH",request.get("actor_login"),user.get("login"),"read login alias for numeric id"))
    subset=safe_subset(repo,pr,review);calculated=digest(subset)
    if provider_bundle.get("provider_response_digest")!=calculated:findings.append(finding("GITHUB_PROVIDER_RESPONSE_DIGEST_MISMATCH",calculated,provider_bundle.get("provider_response_digest"),"recompute canonical provider subset digest"))
    incomplete={"GITHUB_REVIEW_NOT_FOUND","GITHUB_REVIEW_STATE_AMBIGUOUS","GITHUB_PAGINATION_INCOMPLETE","GITHUB_ACTOR_ID_MISSING","GITHUB_PROVIDER_RESPONSE_MALFORMED"}
    status=INCOMPLETE if {f["code"] for f in findings}&incomplete else COMPLETE
    current_approval=status==COMPLETE and not findings
    return {"kind":"githubApprovalEvidence.v1","provider":"github","repository":subset["repository"],"pull_request":subset["pull_request"],"review":subset["review"],"actor":subset["actor"],"request":{"candidate_revision":request.get("candidate_revision")},"observation":{"observed_at":observed_at,"provider_response_digest":calculated,"adapter_digest":ADAPTER_DIGEST},"status":status,"current_approval":current_approval,"findings":sorted(findings,key=lambda x:(x["code"],canonical(x))),"claim_ceiling":ceiling()}

def api_get(url:str,token:str)->Any:
    req=urllib.request.Request(url,headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":ADAPTER_VERSION})
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
        return normalize_github_approval_evidence(bundle,request,observed_at,{"version":ADAPTER_VERSION,"digest":ADAPTER_DIGEST})
    except RuntimeError as exc:
        code=str(exc) if str(exc) in CODES else "GITHUB_READBACK_EXCEPTION";return error_envelope({"candidate_revision":candidate_revision},observed_at,code,str(exc))
    except Exception as exc:return error_envelope({"candidate_revision":candidate_revision},observed_at,"GITHUB_READBACK_EXCEPTION",type(exc).__name__)

def fixture()->tuple[Json,Json,str,Json]:
    repo={"id":1285891542,"full_name":"roccho-dev/diagrams"};pr={"number":15,"id":90000015,"node_id":"PR_node","head":{"sha":"a"*40},"base":{"ref":"proposals","sha":"b"*40}}
    review={"id":7001,"node_id":"REV_node","state":"APPROVED","commit_id":"a"*40,"submitted_at":"2026-07-20T12:00:00Z","dismissed":False,"user":{"id":40359643,"login":"roccho-dev","type":"User"}}
    bundle={"repository":repo,"pull_request":pr,"reviews":[review],"pagination_complete":True,"provider_response_digest":digest(safe_subset(repo,pr,review))}
    request={"repository":"roccho-dev/diagrams","repository_id":1285891542,"pull_request_number":15,"pull_request_id":90000015,"review_id":7001,"candidate_revision":"a"*40,"actor_account_id":40359643,"actor_login":"roccho-dev"}
    return bundle,request,"2026-07-20T12:01:00Z",{"version":ADAPTER_VERSION,"digest":ADAPTER_DIGEST}

def selftest()->Json:
    bundle,request,observed,adapter=fixture();ok=normalize_github_approval_evidence(bundle,request,observed,adapter)
    assert ok["status"]==COMPLETE and ok["current_approval"] is True,ok
    assert canonical(ok)==canonical(normalize_github_approval_evidence(bundle,request,observed,adapter))
    mutations=[
    ("D01-repo-id",lambda b,r,h:b["repository"].__setitem__("id",1),"GITHUB_REPOSITORY_ID_MISMATCH"),("D02-pr-id",lambda b,r,h:b["pull_request"].__setitem__("id",1),"GITHUB_PULL_REQUEST_ID_MISMATCH"),("D03-head",lambda b,r,h:b["pull_request"]["head"].__setitem__("sha","f"*40),"GITHUB_HEAD_SHA_MISMATCH"),("D04-review-commit",lambda b,r,h:b["reviews"][0].__setitem__("commit_id","f"*40),"GITHUB_REVIEW_COMMIT_MISMATCH"),("D05-review-absent",lambda b,r,h:b.__setitem__("reviews",[]),"GITHUB_REVIEW_NOT_FOUND"),("D06-review-duplicate",lambda b,r,h:b["reviews"].append(copy.deepcopy(b["reviews"][0])),"GITHUB_REVIEW_STATE_AMBIGUOUS"),("D07-commented",lambda b,r,h:b["reviews"][0].__setitem__("state","COMMENTED"),"GITHUB_REVIEW_STATE_NOT_APPROVED"),("D08-changes",lambda b,r,h:b["reviews"][0].__setitem__("state","CHANGES_REQUESTED"),"GITHUB_REVIEW_STATE_NOT_APPROVED"),("D09-dismissed",lambda b,r,h:b["reviews"][0].__setitem__("dismissed",True),"GITHUB_REVIEW_DISMISSED"),("D10-actor-id",lambda b,r,h:b["reviews"][0]["user"].__setitem__("id",1),"GITHUB_ACTOR_ID_MISMATCH"),("D11-actor-missing",lambda b,r,h:b["reviews"][0]["user"].__setitem__("id",None),"GITHUB_ACTOR_ID_MISSING"),("D12-pagination",lambda b,r,h:b.__setitem__("pagination_complete",False),"GITHUB_PAGINATION_INCOMPLETE"),("D13-malformed",lambda b,r,h:b.__setitem__("repository",None),"GITHUB_REPOSITORY_NOT_FOUND"),("D14-digest",lambda b,r,h:b.__setitem__("provider_response_digest","sha256:"+"0"*64),"GITHUB_PROVIDER_RESPONSE_DIGEST_MISMATCH"),("D15-auth",lambda b,r,h:h.__setitem__("direct",error_envelope(r,h["observed"],"GITHUB_AUTHENTICATION_FAILED","401")),"GITHUB_AUTHENTICATION_FAILED"),("D16-permission",lambda b,r,h:b.__setitem__("current_permission","admin"),"GITHUB_PROVIDER_RESPONSE_MALFORMED"),("D17-observed",lambda b,r,h:h.__setitem__("observed",None),"GITHUB_OBSERVED_AT_MISSING"),("D18-other-repo",lambda b,r,h:b["repository"].__setitem__("full_name","roccho-dev/ops"),"GITHUB_REPOSITORY_NOT_FOUND"),("D19-secret",lambda b,r,h:b.__setitem__("token","secret"),"GITHUB_PROVIDER_RESPONSE_MALFORMED"),("D20-ceiling",lambda b,r,h:None,None),("D21-determinism",lambda b,r,h:None,None),("D22-exception",lambda b,r,h:h.__setitem__("direct",error_envelope(r,h["observed"],"GITHUB_READBACK_EXCEPTION","boom")),"GITHUB_READBACK_EXCEPTION")]
    rows=[]
    for name,mut,expected in mutations:
        b,r,o,a=copy.deepcopy((bundle,request,observed,adapter));h={"observed":o,"adapter":a};mut(b,r,h);result=h.get("direct") or normalize_github_approval_evidence(b,r,h["observed"],h["adapter"])
        if name=="D20-ceiling":assert all(v is False for v in result["claim_ceiling"].values())
        elif name=="D21-determinism":assert canonical(result)==canonical(normalize_github_approval_evidence(b,r,h["observed"],h["adapter"]))
        else:assert not result.get("current_approval") and expected in {x["code"] for x in result["findings"]},(name,result)
        rows.append({"case":name,"status":"PASS"})
    return {"kind":"githubApprovalEvidence.selftest.v1","status":"PASS","positive":1,"destructive":rows,"adapter_digest":ADAPTER_DIGEST}

def main()->int:
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="cmd",required=True);sub.add_parser("selftest");n=sub.add_parser("normalize");n.add_argument("--bundle",required=True);n.add_argument("--request",required=True);n.add_argument("--observed-at",required=True)
    r=sub.add_parser("read")
    for x in ("repository","candidate-revision","observed-at","token-env","actor-login"):r.add_argument("--"+x,required=True)
    for x in ("pull-request-number","review-id","repository-id","pull-request-id","actor-account-id"):r.add_argument("--"+x,required=True,type=int)
    a=p.parse_args()
    if a.cmd=="selftest":print(json.dumps(selftest(),indent=2,sort_keys=True));return 0
    if a.cmd=="normalize":result=normalize_github_approval_evidence(json.loads(Path(a.bundle).read_text()),json.loads(Path(a.request).read_text()),a.observed_at,{"version":ADAPTER_VERSION,"digest":ADAPTER_DIGEST})
    else:
        token=os.environ.get(a.token_env)
        result=error_envelope({"candidate_revision":a.candidate_revision},a.observed_at,"GITHUB_AUTHENTICATION_FAILED",f"missing env {a.token_env}") if not token else read_github_approval_evidence(a.repository,a.pull_request_number,a.review_id,a.candidate_revision,a.observed_at,token,a.repository_id,a.pull_request_id,a.actor_account_id,a.actor_login)
    print(json.dumps(result,ensure_ascii=False,indent=2,sort_keys=True));return 0 if result["status"]==COMPLETE else 2 if result["status"]==INCOMPLETE else 3
if __name__=="__main__":raise SystemExit(main())
