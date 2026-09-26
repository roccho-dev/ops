#!/usr/bin/env python3
from __future__ import annotations

import argparse, json, os
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

PROPOSAL = "adrs318-ui-proposal-oidc-canary-v1"
TARGET = "pkg.adrs318.canary"
REQUIRED = {
    "repo:adrs", "repo:governance", "repo:ops", "repo:ui",
    "decision:adrs:331",
    "finding:owner-repositories-unmaterialized",
    "package:governance:repo-governance",
    "package:ops:artifact-assembly",
    "package:ui:semantic-map",
    TARGET,
}

def canon(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"

def get_json(url: str) -> dict:
    req = Request(url, headers={"accept":"application/json", "cache-control":"no-cache", "user-agent":"organization-map-browser-proof/1"})
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read())

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("receipt", type=Path)
    ap.add_argument("screenshot", type=Path)
    ap.add_argument("--visual-only", action="store_true")
    a = ap.parse_args()
    chrome = os.environ.get("CHROME_BIN")
    if not chrome: raise SystemExit("CHROME_BIN is required")
    base = a.url.rstrip("/") + "/"
    paths = {
        "map": a.screenshot,
        "ops": a.screenshot.with_name(a.screenshot.stem + "-ops-packages" + a.screenshot.suffix),
        "graph": a.screenshot.with_name(a.screenshot.stem + "-graph" + a.screenshot.suffix),
        "seq": a.screenshot.with_name(a.screenshot.stem + "-seq" + a.screenshot.suffix),
        "proposal": a.screenshot.with_name(a.screenshot.stem + "-proposal" + a.screenshot.suffix),
    }
    errors, console, failed, requests = [], [], [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chrome, headless=True)
        page = browser.new_page(viewport={"width":1440,"height":960})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        page.on("request", lambda r: requests.append(r.url))
        page.on("response", lambda r: failed.append({"url":r.url,"status":r.status}) if r.status >= 400 else None)
        if a.visual_only:
            observe = base + "api/proposals/" + PROPOSAL
            page.route(observe, lambda route: route.fulfill(status=200, content_type="application/json", body=canon({
                "status":"PASS","proposal_id":PROPOSAL,"state":"ready","authority":False,"current_changed":False,"cutover":False,
            })))
        page.goto(base, wait_until="domcontentloaded", timeout=120_000)
        page.locator("#graph-container svg").first.wait_for(state="attached", timeout=120_000)
        page.locator("#proposal-connect-button").wait_for(state="visible", timeout=120_000)
        page.wait_for_function("() => globalThis.semanticProposalConnectability?.ready === true", timeout=120_000)
        page.wait_for_function("() => document.querySelector('#pattern-select')?.disabled === false", timeout=120_000)

        def snap() -> dict:
            return page.evaluate("""() => {
              const app = globalThis.semanticMapApp;
              const regions = app ? [...app.domain.regions.values()] : [];
              return {
                ready: globalThis.semanticMapSite?.ready === true && app?.ready === true,
                title: document.title, h1: document.querySelector('h1')?.textContent || '',
                pattern: globalThis.semanticMapSite?.runtime?.view?.pattern || null,
                ids: regions.map(x => x.id).sort(),
                relations: app?.domain?.relations?.length || 0,
                shown: app?.snapshot()?.scene?.representationIds?.length || 0,
                packages: regions.filter(x => x.id.startsWith('package:')).length,
                unknowns: regions.filter(x => x.label.includes('[UNKNOWN]')).length,
                oldForm: document.body.innerText.includes('ADRS UI Proposal Canary') || document.body.innerText.includes('固定canary変更'),
                uiCommit: document.querySelector('meta[name="semantic-map-ui-commit"]')?.content || null,
                opsCommit: document.querySelector('meta[name="semantic-map-ops-commit"]')?.content || null,
              };
            }""")

        def view(pattern: str) -> dict:
            page.select_option("#pattern-select", pattern)
            page.wait_for_function("p => globalThis.semanticMapSite?.runtime?.view?.pattern === p", arg=pattern, timeout=120_000)
            page.wait_for_timeout(350)
            return snap()

        overview = snap()
        assert overview["ready"] and overview["pattern"] == "map/1", overview
        assert overview["title"].startswith("Internal Organization — decisions → governance → factory → packages"), overview
        assert overview["h1"] == "Internal Organization — decisions → governance → factory → packages", overview
        assert REQUIRED <= set(overview["ids"]), overview
        assert overview["packages"] >= 15 and overview["unknowns"] >= 2 and overview["relations"] >= 12, overview
        assert overview["shown"] >= 9 and not overview["oldForm"], overview
        assert len(overview["uiCommit"] or "") == 40 and len(overview["opsCommit"] or "") == 40, overview
        page.evaluate("() => globalThis.semanticMapApp.adapter.setSelection({regionIds:[],relationIds:[]})")
        page.screenshot(path=str(paths["map"]), full_page=True)
        assert page.evaluate("() => globalThis.semanticMapApp.focusRegion('repo:ops', .72)") is True
        page.wait_for_timeout(350); page.screenshot(path=str(paths["ops"]), full_page=True)
        graph = view("graph/1"); assert graph["shown"] >= 20, graph
        page.screenshot(path=str(paths["graph"]), full_page=True)
        seq = view("seq/1"); assert seq["shown"] >= 7, seq
        assert page.locator("#seq-preset-wrap").is_visible(); page.screenshot(path=str(paths["seq"]), full_page=True)
        back = view("map/1"); assert back["ids"] == overview["ids"] and back["relations"] == overview["relations"]

        page.evaluate("""() => globalThis.semanticMapApp.adapter.setSelection({regionIds:['pkg.adrs318.canary'],relationIds:[]})""")
        page.locator("#proposal-connect-button").click(timeout=30_000)
        page.locator("#proposal-connect-dialog[open]").wait_for(timeout=30_000)
        preview = page.locator("#proposal-connect-preview").text_content() or ""
        assert PROPOSAL in preview and TARGET in preview
        assert all(token not in preview for token in ('"bounds"','"x"','"y"','"zoom"','"view"'))
        page.screenshot(path=str(paths["proposal"]), full_page=True)
        status = None
        if not a.visual_only:
            page.locator("#proposal-connect-confirm").click()
            page.locator("body[data-proposal-state='recorded']").wait_for(timeout=180_000)
            status = get_json(base + "api/proposals/" + PROPOSAL)
            assert status["status"] == "PASS" and status["state"] == "recorded" and status["exact_comment_readback"] is True
            assert status["authority"] is False and status["current_changed"] is False and status["cutover"] is False
        live = page.evaluate("""() => ({
          selected: globalThis.semanticProposalConnectability.selected(),
          state: globalThis.semanticProposalConnectability.state(),
          last: globalThis.semanticProposalConnectability.last(),
          body: document.body.dataset.proposalState,
        })""")
        browser.close()
    assert live["selected"] is True
    assert live["body"] == ("prepared" if a.visual_only else "recorded")
    if not a.visual_only:
        assert live["state"] == "recorded" and live["last"]["observation"]["value"]["exact_comment_readback"] is True
    assert not errors and not console and not failed, (errors, console, failed)
    origin = urlparse(base)
    approved = f"{origin.scheme}://{origin.netloc}"
    external = sorted({u for u in requests if not u.startswith(approved) and not u.startswith(("data:","blob:")) and u != "about:blank"})
    assert not external, external
    receipt = {
        "schema":"ops.internalOrganizationSemanticMapBrowserProof/1","status":"PASS",
        "mode":"visual-only" if a.visual_only else "live-provider", "url":base,
        "ui_commit":overview["uiCommit"], "ops_commit":overview["opsCommit"],
        "patterns":{"map/1":overview["shown"],"graph/1":graph["shown"],"seq/1":seq["shown"]},
        "required_region_ids":sorted(REQUIRED), "package_count":overview["packages"], "unknown_count":overview["unknowns"],
        "relation_count":overview["relations"], "proposal_id":PROPOSAL, "proposal_state":live["state"], "status_after_submit":status,
        "selected_universe_complete":True, "all_owner_repositories_observed":False, "unknowns_visible":True,
        "retired_fixed_form_present":False, "geometry_in_proposal":False,
        "screenshots":{k:v.name for k,v in paths.items()}, "page_errors":errors,"console_errors":console,"failed_responses":failed,
        "external_requests":external,"real_chromium":True,"authority":False,"current_changed":False,"cutover":False,
    }
    a.receipt.parent.mkdir(parents=True, exist_ok=True); a.receipt.write_text(canon(receipt), encoding="utf-8")
    print(canon(receipt), end=""); return 0

if __name__ == "__main__": raise SystemExit(main())
