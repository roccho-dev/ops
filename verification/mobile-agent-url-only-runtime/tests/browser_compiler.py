#!/usr/bin/env python3
from __future__ import annotations
import json, os, pathlib, shutil, sys
from playwright.sync_api import sync_playwright

def chrome_path():
    explicit=os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
    if explicit: return explicit
    for name in ("google-chrome","google-chrome-stable","chromium","chromium-browser"):
        found=shutil.which(name)
        if found: return found
    return None

def main(argv):
    if len(argv)!=4:
        raise SystemExit("usage: browser_compiler.py BASE EXAMPLES_DIR OUT")
    base=argv[1].rstrip("/")+"/"
    examples=pathlib.Path(argv[2])
    out=pathlib.Path(argv[3])
    cases=[]
    with sync_playwright() as p:
        launch={"headless":True,"args":["--no-sandbox","--disable-dev-shm-usage"]}
        executable=chrome_path()
        if executable: launch["executable_path"]=executable
        browser=p.chromium.launch(**launch)
        compiler_page=browser.new_page()
        compiler_errors=[]; compiler_failed=[]
        compiler_page.on("pageerror", lambda e: compiler_errors.append(str(e)))
        compiler_page.on("response", lambda r: compiler_failed.append({"url":r.url,"status":r.status}) if r.status>=400 else None)
        response=compiler_page.goto(base+"business-model/", wait_until="load", timeout=60000)
        assert response and response.ok
        for count in (2,3,4):
            text=(examples/f"{count}-actors.jsonl").read_text(encoding="utf-8")
            receipt=compiler_page.evaluate(
                """async ({moduleUrl,text,base}) => {
                  const compiler=await import(moduleUrl);
                  return await compiler.compilePublicBusinessModelUrl(text,{base});
                }""",
                {"moduleUrl":base+"business-model/compiler/index.mjs","text":text,"base":base+"business-model/"},
            )
            assert receipt["status"]=="PASS"
            assert receipt["pattern"]=="business-model/1"
            assert receipt["actorCount"]==count
            assert receipt["roundTripExact"] is True
            assert receipt["sourceCloneUsed"] is False
            assert receipt["sourceBuildUsed"] is False
            assert receipt["providerWriteUsed"] is False
            assert receipt["urlChars"]<=receipt["limitChars"]==8192
            errors=[]; failed=[]
            page=browser.new_page(viewport={"width":1600,"height":900}, device_scale_factor=1)
            page.on("pageerror", lambda e,b=errors: b.append(str(e)))
            page.on("response", lambda r,b=failed: b.append({"url":r.url,"status":r.status}) if r.status>=400 else None)
            rendered=page.goto(receipt["url"], wait_until="load", timeout=60000)
            assert rendered and rendered.ok
            page.wait_for_function("document.documentElement.dataset.status === 'pass'", timeout=30000)
            metrics=page.evaluate("""() => ({
              pattern: document.querySelector('meta[name="artifact-pattern"]')?.content || '',
              actorCount: document.querySelectorAll('.profiled-actor').length,
              exchangeGroupCount: document.querySelectorAll('.profiled-exchange-group').length,
              columnCount: Number(document.querySelector('.profiled-scene')?.dataset.columnCount || 0),
              bodyScrollWidth: document.body.scrollWidth,
              bodyClientWidth: document.body.clientWidth
            })""")
            page.locator("#seq-open").click()
            page.wait_for_function("document.querySelector('#seq-shell')?.dataset.expanded === 'true'", timeout=30000)
            page.locator("#seq-close").click()
            checks={
              "documentPass": page.locator("html").get_attribute("data-status")=="pass",
              "pattern": metrics["pattern"]=="business-model/1",
              "actorCount": metrics["actorCount"]==count,
              "exchangeGroupCount": metrics["exchangeGroupCount"]==count-1,
              "columnPattern": metrics["columnCount"]==count*2-1,
              "noHorizontalOverflow": metrics["bodyScrollWidth"]<=metrics["bodyClientWidth"],
              "noPageErrors": errors==[],
              "noFailedResponses": failed==[],
            }
            assert all(checks.values()), {"checks":checks,"errors":errors,"failed":failed}
            cases.append({
              "actorCount":count,"generated":"PASS","rendered":"PASS","url":receipt["url"],
              "urlChars":receipt["urlChars"],"payloadSha256":receipt["payloadSha256"],
              "roundTripExact":True,"checks":checks,
            })
            page.close()
        browser.close()
    assert compiler_errors==[], compiler_errors
    assert compiler_failed==[], compiler_failed
    value={
      "schema":"mobile-agent.business-model-url-generation-and-render/1",
      "status":"PASS","pass":True,"base":base,"cases":cases,
      "urlGeneration":"PASS","urlRendering":"PASS",
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":"PASS","urlGeneration":"PASS","urlRendering":"PASS","actors":[2,3,4]}))

if __name__=="__main__":
    main(sys.argv)
