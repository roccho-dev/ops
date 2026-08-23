#!/usr/bin/env python3
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, shutil, subprocess, time, urllib.error, urllib.parse, urllib.request

def run(*args,env=None): subprocess.run(args,env=env,check=True)
def capture(*args,env=None): return subprocess.run(args,env=env,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT).stdout
def load(p): return json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
def dump(p,v):
    p=pathlib.Path(p); p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(v,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
def sha(b): return hashlib.sha256(b).hexdigest()

def fetch_one(base,rel,spec):
    req=urllib.request.Request(urllib.parse.urljoin(base,rel),headers={"Cache-Control":"no-cache","User-Agent":"mobile-agent-url-only-readback/2"})
    try:
        with urllib.request.urlopen(req,timeout=45) as r: data=r.read()
        observed=sha(data)
        if len(data)!=spec["bytes"] or observed!=spec["sha256"]:
            return rel,{"path":rel,"bytes":len(data),"sha256":observed}
        return rel,None
    except Exception as e: return rel,{"path":rel,"error":str(e)}

def readback(base,expected):
    pending=dict(expected["files"]); last=[]
    for _ in range(90):
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results=list(pool.map(lambda item: fetch_one(base,*item),pending.items()))
        bad={rel:pending[rel] for rel,error in results if error is not None}
        last=[error for _,error in results if error is not None]
        if not bad: return {"base":base,"fileCount":expected["fileCount"],"treeDigest":expected["distTreeDigest"],"status":"PASS"}
        pending=bad; time.sleep(2)
    raise RuntimeError(json.dumps({"base":base,"mismatches":last[:10]},sort_keys=True))

def probe(url):
    req=urllib.request.Request(url,headers={"Cache-Control":"no-cache","User-Agent":"mobile-agent-url-only-guard/2"})
    try:
        with urllib.request.urlopen(req,timeout=20) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return 0

def ensure_release(staged,tag,source_sha):
    archive=next(staged.glob("*.tar.gz")); carrier=next(staged.glob("*.b64.txt"))
    assets=[archive,carrier,staged/"expected.json",staged/"publication.json",staged/"manifest.json",staged/"local-proof.json"]
    repo=os.environ["GITHUB_REPOSITORY"]
    if subprocess.run(["gh","release","view",tag,"--repo",repo],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0:
        run("gh","release","create",tag,"--repo",repo,"--target",source_sha,
            "--title","Mobile Agent deploy-once URL runtime",
            "--notes","Independent business-model/1 projection with hosted semantic JSONL URL compiler.",
            *(str(x) for x in assets))
    check=staged.parent/"release-check"
    if check.exists(): shutil.rmtree(check)
    check.mkdir()
    for asset in assets:
        run("gh","release","download",tag,"--repo",repo,"--pattern",asset.name,"--dir",str(check))
        if asset.read_bytes()!=(check/asset.name).read_bytes(): raise RuntimeError("Release readback mismatch: "+asset.name)

def prove(base,examples,out,chrome):
    env=dict(os.environ,CHROMIUM_PATH=chrome)
    run("python3","verification/mobile-agent-url-only-runtime/tests/browser_compiler.py",base,str(examples),str(out),env=env)
    proof=load(out)
    if proof["urlGeneration"]!="PASS" or proof["urlRendering"]!="PASS": raise RuntimeError("browser proof failed")
    return proof

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--staged",required=True); p.add_argument("--source-sha",required=True); p.add_argument("--out",required=True); p.add_argument("--github-output")
    args=p.parse_args()
    staged=pathlib.Path(args.staged); out=pathlib.Path(args.out); out.mkdir(parents=True,exist_ok=True)
    manifest=load(staged/"manifest.json"); expected=load(staged/"expected.json"); publication=load(staged/"publication.json")
    tag=publication["publication"]["tag"]; ensure_release(staged,tag,args.source_sha)
    project=manifest["provider"]["project"]; stable=f"https://{project}.pages.dev/"
    if probe(stable+"app/")==200:
        raise RuntimeError("refusing partial-site deployment: existing /app/ is live")
    if not os.environ.get("CLOUDFLARE_ACCOUNT_ID") or not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise RuntimeError("Cloudflare credentials are required")
    output=capture("npx","--yes","wrangler@4.112.0","pages","deploy",str(staged/"site"),
      "--project-name",project,"--branch","proposals","--commit-hash",args.source_sha,
      "--commit-message","Mobile Agent deploy-once business-model/1 URL runtime")
    print(output)
    candidates=re.findall(r"https://[A-Za-z0-9.-]+\.pages\.dev",output)
    deployment=next((u.rstrip("/")+"/" for u in candidates if u.rstrip("/")+"/"!=stable),None)
    if not deployment: raise RuntimeError("deployment-specific Pages URL not found")
    dump(out/"readback.json",{"schema":"mobile-agent-url-only-runtime-readback/2","status":"PASS",
      "proofs":[readback(stable,expected),readback(deployment,expected)]})
    chrome=os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
    if not chrome:
        for n in ("google-chrome","google-chrome-stable","chromium","chromium-browser"):
            x=shutil.which(n)
            if x: chrome=x; break
    if not chrome: raise RuntimeError("Chrome/Chromium not found")
    examples=pathlib.Path.cwd()/"verification/mobile-agent-business-model-presentation/examples"
    stable_proof=prove(stable,examples,out/"stable.json",chrome)
    immutable_proof=prove(deployment,examples,out/"immutable.json",chrome)
    cases=[]
    for left,right in zip(stable_proof["cases"],immutable_proof["cases"]):
        assert left["actorCount"]==right["actorCount"]
        assert left["payloadSha256"]==right["payloadSha256"]
        assert left["generated"]==left["rendered"]==right["generated"]==right["rendered"]=="PASS"
        cases.append({
          "actorCount":left["actorCount"],"stableUrl":left["url"],"immutableUrl":right["url"],
          "urlGeneration":"PASS","urlRendering":"PASS","roundTripExact":True,
        })
    receipt={
      "schema":"ops.mobileAgentUrlOnlyRuntimeReceipt/2","status":"PASS","authority":False,
      "repository":os.environ["GITHUB_REPOSITORY"],"candidateSha":args.source_sha,
      "acceptedRef":manifest["publication"]["acceptedRef"],"pattern":"business-model/1",
      "provider":{"kind":"cloudflare-pages","project":project,"stableBase":stable,"deploymentBase":deployment},
      "publication":{"tag":tag,"fileCount":expected["fileCount"],"treeDigest":expected["distTreeDigest"]},
      "compiler":{"module":manifest["compiler"]["module"],"stable":"PASS","immutable":"PASS"},
      "cases":cases,
      "proof":{"stableReadback":"PASS","immutableReadback":"PASS","stableChrome":"PASS","immutableChrome":"PASS",
               "urlGeneration":"PASS","urlRendering":"PASS"},
    }
    dump(out/"accepted-public-url-receipt.json",receipt)
    if args.github_output:
        with pathlib.Path(args.github_output).open("a",encoding="utf-8") as h:
            h.write(f"stable_base={stable}\ndeployment_base={deployment}\ntag={tag}\n")
    print(json.dumps({"status":"PASS","urlGeneration":"PASS","urlRendering":"PASS","stableUrl":cases[0]["stableUrl"]}))

if __name__=="__main__": main()
