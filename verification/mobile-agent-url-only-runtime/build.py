#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, hashlib, json, os, pathlib, shutil, subprocess, sys, time, urllib.request

def run(*args, cwd=None, env=None):
    subprocess.run(args,cwd=cwd,env=env,check=True)

def load(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))

def dump(path,value):
    path=pathlib.Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source-sha",required=True); p.add_argument("--out",required=True); p.add_argument("--github-output")
    args=p.parse_args()
    repo=pathlib.Path.cwd()
    root=repo/"verification/mobile-agent-url-only-runtime"
    presentation=repo/"verification/mobile-agent-business-model-presentation"
    manifest=load(root/"manifest.json")
    out=pathlib.Path(args.out)
    if out.exists(): shutil.rmtree(out)
    site=out/"site"; site.mkdir(parents=True)
    chrome=os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
    if not chrome:
        for n in ("google-chrome","google-chrome-stable","chromium","chromium-browser"):
            x=shutil.which(n)
            if x: chrome=x; break
    if not chrome: raise RuntimeError("Chrome/Chromium not found")
    env=dict(os.environ,CHROMIUM_PATH=chrome)
    run("npm","test",cwd=presentation,env=env)
    target=site/"business-model"; target.mkdir()
    shutil.copy2(presentation/"dist/public/index.html",target/"index.html")
    compiler=target/"compiler"; compiler.mkdir()
    shutil.copy2(root/"compiler/index.mjs",compiler/"index.mjs")
    for package in ("business-model-compiler","url-module"):
        shutil.copytree(presentation/"packages"/package/"src",compiler/"packages"/package/"src")
    server=subprocess.Popen(
      [sys.executable,"-m","http.server","4173","--bind","127.0.0.1","--directory",str(site)],
      stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL
    )
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen("http://127.0.0.1:4173/business-model/",timeout=1) as r:
                    if r.status==200: break
            except Exception: time.sleep(.2)
        else: raise RuntimeError("local server did not become ready")
        run("python3",str(root/"tests/browser_compiler.py"),"http://127.0.0.1:4173/",
            str(presentation/"examples"),str(out/"local-proof.json"),env=env)
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill()
    files={}
    for path in sorted(x for x in site.rglob("*") if x.is_file()):
        data=path.read_bytes(); rel=path.relative_to(site).as_posix()
        files[rel]={"bytes":len(data),"sha256":sha(data)}
    rows=[{"path":k,**files[k]} for k in sorted(files)]
    digest=sha(json.dumps(rows,sort_keys=True,separators=(",",":")).encode())
    expected={"schema":"mobile-agent-url-only-runtime-site/1","fileCount":len(files),"distTreeDigest":"sha256:"+digest,"files":files}
    dump(out/"expected.json",expected)
    tag="mobile-agent-url-only-"+digest
    publication={
      "schema":"ops.mobileAgentUrlOnlyRuntimePublication/2","status":"PASS","sourceCommit":args.source_sha,
      "publication":{"tag":tag,"fileCount":len(files),"distTreeDigest":"sha256:"+digest}
    }
    dump(out/"publication.json",publication)
    shutil.copy2(root/"manifest.json",out/"manifest.json")
    archive=f"mobile-agent-url-only.{digest}.tar.gz"
    with (out/archive).open("wb") as handle:
        subprocess.run(
          "tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf - . | gzip -n",
          cwd=site,shell=True,stdout=handle,check=True
        )
    carrier=archive+".b64.txt"
    (out/carrier).write_text(base64.b64encode((out/archive).read_bytes()).decode("ascii"),encoding="ascii")
    proof=load(out/"local-proof.json")
    assert proof["urlGeneration"]==proof["urlRendering"]=="PASS"
    if args.github_output:
        with pathlib.Path(args.github_output).open("a",encoding="utf-8") as h:
            for k,v in {
              "source_sha":args.source_sha,"project":manifest["provider"]["project"],
              "stable_base":manifest["provider"]["stableBase"],"tag":tag,
              "archive":archive,"carrier":carrier,"tree_digest":"sha256:"+digest,"file_count":len(files)
            }.items(): h.write(f"{k}={v}\n")
    print(json.dumps({"status":"PASS","urlGeneration":"PASS","urlRendering":"PASS","files":len(files),"tag":tag}))

if __name__=="__main__": main()
