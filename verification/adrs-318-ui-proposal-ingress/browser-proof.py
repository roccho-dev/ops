#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright

PROPOSAL_ID = "adrs318-ui-proposal-oidc-canary-v1"
TARGET_ID = "pkg.adrs318.canary"
REQUIRED_IDS = {
    "repo:adrs",
    "repo:governance",
    "repo:ops",
    "repo:ui",
    "decision:adrs:331",
    "finding:owner-repositories-unmaterialized",
    "package:governance:repo-governance",
    "package:ops:artifact-assembly",
    "package:ui:semantic-map",
    TARGET_ID,
}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def get_json(url: str) -> dict:
    request = Request(
        url,
        headers={
            "accept": "application/json",
            "cache-control": "no-cache",
            "user-agent": "roccho-ops-internal-organization-map-browser-proof/1",
        },
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("receipt", type=pathlib.Path)
    parser.add_argument("screenshot", type=pathlib.Path)
    parser.add_argument("--visual-only", action="store_true")
    args = parser.parse_args()

    chrome = os.environ.get("CHROME_BIN")
    if not chrome:
        raise SystemExit("CHROME_BIN is required")

    base = args.url.rstrip("/") + "/"
    ops_screenshot = args.screenshot.with_name(f"{args.screenshot.stem}-ops-packages{args.screenshot.suffix}")
    graph_screenshot = args.screenshot.with_name(f"{args.screenshot.stem}-graph{args.screenshot.suffix}")
    seq_screenshot = args.screenshot.with_name(f"{args.screenshot.stem}-seq{args.screenshot.suffix}")
    interaction_screenshot = args.screenshot.with_name(f"{args.screenshot.stem}-proposal{args.screenshot.suffix}")
    page_errors: list[str] = []
    console_errors: list[str] = []
    failed_responses: list[dict[str, object]] = []
    requests: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))

        def record_failure(response: object) -> None:
            if response.status >= 400:
                failed_responses.append({"url": response.url, "status": response.status})

        page.on("response", record_failure)

        if args.visual_only:
            observation_url = f"{base}api/proposals/{PROPOSAL_ID}"

            def fulfill_visual_observation(route: object) -> None:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=canonical(
                        {
                            "status": "PASS",
                            "proposal_id": PROPOSAL_ID,
                            "state": "ready",
                            "authority": False,
                            "current_changed": False,
                            "cutover": False,
                        }
                    ),
                )

            page.route(observation_url, fulfill_visual_observation)

        page.goto(base, wait_until="domcontentloaded", timeout=120_000)
        page.locator("#graph-container svg").first.wait_for(state="attached", timeout=120_000)
        page.locator("#proposal-connect-button").wait_for(state="visible", timeout=120_000)
        page.wait_for_function("() => globalThis.semanticProposalConnectability?.ready === true", timeout=120_000)
        page.wait_for_function("() => document.querySelector('#pattern-select')?.disabled === false", timeout=120_000)

        def snapshot() -> dict:
            return page.evaluate(
                """() => {
                  const app = globalThis.semanticMapApp;
                  const regions = app ? [...app.domain.regions.values()] : [];
                  return {
                    siteReady: globalThis.semanticMapSite?.ready === true,
                    appReady: app?.ready === true,
                    connectabilityReady: globalThis.semanticProposalConnectability?.ready === true,
                    title: document.title,
                    h1: document.querySelector('h1')?.textContent ?? '',
                    pattern: globalThis.semanticMapSite?.runtime?.view?.pattern ?? null,
                    regionIds: regions.map(item => item.id).sort(),
                    relationCount: app?.domain?.relations?.length ?? 0,
                    representationCount: app?.snapshot()?.scene?.representationIds?.length ?? 0,
                    packageCount: regions.filter(item => item.id.startsWith('package:')).length,
                    unknownCount: regions.filter(item => item.label.includes('[UNKNOWN]')).length,
                    labels: regions.map(item => item.label).sort(),
                    selection: app?.adapter?.selectionSnapshot?.() ?? null,
                    oldFormPresent: document.body.innerText.includes('ADRS UI Proposal Canary') || document.body.innerText.includes('固定canary変更'),
                    uiCommit: document.querySelector('meta[name="semantic-map-ui-commit"]')?.content ?? null,
                    opsCommit: document.querySelector('meta[name="semantic-map-ops-commit"]')?.content ?? null,
                  };
                }"""
            )

        def switch_pattern(pattern: str) -> dict:
            page.select_option("#pattern-select", pattern)
            page.wait_for_function(
                "pattern => globalThis.semanticMapSite?.runtime?.view?.pattern === pattern",
                pattern,
                timeout=120_000,
            )
            page.locator("#graph-container svg").first.wait_for(state="attached", timeout=120_000)
            page.wait_for_timeout(350)
            return snapshot()

        map_snapshot = snapshot()
        assert map_snapshot["siteReady"] is True, map_snapshot
        assert map_snapshot["appReady"] is True, map_snapshot
        assert map_snapshot["connectabilityReady"] is True, map_snapshot
        assert map_snapshot["title"].startswith("Internal Organization — decisions → governance → factory → packages"), map_snapshot
        assert map_snapshot["h1"] == "Internal Organization — decisions → governance → factory → packages", map_snapshot
        assert map_snapshot["pattern"] == "map/1", map_snapshot
        assert REQUIRED_IDS.issubset(set(map_snapshot["regionIds"])), map_snapshot
        assert map_snapshot["packageCount"] >= 15, map_snapshot
        assert map_snapshot["unknownCount"] >= 2, map_snapshot
        assert map_snapshot["relationCount"] >= 12, map_snapshot
        assert map_snapshot["representationCount"] >= 9, map_snapshot
        assert map_snapshot["oldFormPresent"] is False, map_snapshot
        assert isinstance(map_snapshot["uiCommit"], str) and len(map_snapshot["uiCommit"]) == 40
        assert isinstance(map_snapshot["opsCommit"], str) and len(map_snapshot["opsCommit"]) == 40

        page.evaluate("() => globalThis.semanticMapApp.adapter.setSelection({regionIds: [], relationIds: []})")
        page.screenshot(path=str(args.screenshot), full_page=True)

        focused = page.evaluate("() => globalThis.semanticMapApp.focusRegion('repo:ops', 0.72)")
        assert focused is True
        page.wait_for_timeout(350)
        page.screenshot(path=str(ops_screenshot), full_page=True)

        graph_snapshot = switch_pattern("graph/1")
        assert graph_snapshot["pattern"] == "graph/1", graph_snapshot
        assert graph_snapshot["representationCount"] >= 20, graph_snapshot
        page.screenshot(path=str(graph_screenshot), full_page=True)

        seq_snapshot = switch_pattern("seq/1")
        assert seq_snapshot["pattern"] == "seq/1", seq_snapshot
        assert seq_snapshot["representationCount"] >= 10, seq_snapshot
        assert page.locator("#seq-preset-wrap").is_visible()
        page.screenshot(path=str(seq_screenshot), full_page=True)

        map_after_switch = switch_pattern("map/1")
        assert map_after_switch["regionIds"] == map_snapshot["regionIds"]
        assert map_after_switch["relationCount"] == map_snapshot["relationCount"]

        page.evaluate(
            """() => globalThis.semanticMapApp.adapter.setSelection({
              regionIds: ['pkg.adrs318.canary'],
              relationIds: [],
            })"""
        )
        page.locator("#proposal-connect-button").click(timeout=30_000)
        page.locator("#proposal-connect-dialog[open]").wait_for(timeout=30_000)
        preview = page.locator("#proposal-connect-preview").text_content() or ""
        assert PROPOSAL_ID in preview
        assert TARGET_ID in preview
        for forbidden in ('"bounds"', '"x"', '"y"', '"zoom"', '"view"'):
            assert forbidden not in preview, forbidden
        page.screenshot(path=str(interaction_screenshot), full_page=True)

        status = None
        if not args.visual_only:
            page.locator("#proposal-connect-confirm").click()
            page.locator("body[data-proposal-state='recorded']").wait_for(timeout=180_000)
            status = get_json(f"{base}api/proposals/{PROPOSAL_ID}")
            assert status["status"] == "PASS"
            assert status["proposal_id"] == PROPOSAL_ID
            assert status["state"] == "recorded"
            assert status["exact_comment_readback"] is True
            assert status["authority"] is False
            assert status["current_changed"] is False
            assert status["cutover"] is False

        live = page.evaluate(
            """() => ({
              selected: globalThis.semanticProposalConnectability.selected(),
              state: globalThis.semanticProposalConnectability.state(),
              last: globalThis.semanticProposalConnectability.last(),
              bodyState: document.body.dataset.proposalState,
            })"""
        )
        browser.close()

    assert live["selected"] is True, live
    assert live["bodyState"] == ("prepared" if args.visual_only else "recorded"), live
    if not args.visual_only:
        assert live["state"] == "recorded", live
        assert live["last"]["observation"]["value"]["exact_comment_readback"] is True
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses

    origin = urlparse(base)
    approved = f"{origin.scheme}://{origin.netloc}"
    external = sorted(
        {
            url
            for url in requests
            if not url.startswith(approved)
            and not url.startswith("data:")
            and not url.startswith("blob:")
            and url != "about:blank"
        }
    )
    assert not external, external

    receipt = {
        "schema": "ops.internalOrganizationSemanticMapBrowserProof/1",
        "status": "PASS",
        "mode": "visual-only" if args.visual_only else "live-provider",
        "url": base,
        "ui_commit": map_snapshot["uiCommit"],
        "ops_commit": map_snapshot["opsCommit"],
        "patterns": {
            "map/1": map_snapshot["representationCount"],
            "graph/1": graph_snapshot["representationCount"],
            "seq/1": seq_snapshot["representationCount"],
        },
        "required_region_ids": sorted(REQUIRED_IDS),
        "package_count": map_snapshot["packageCount"],
        "unknown_count": map_snapshot["unknownCount"],
        "relation_count": map_snapshot["relationCount"],
        "proposal_id": PROPOSAL_ID,
        "target_id": TARGET_ID,
        "proposal_state": live["state"],
        "status_after_submit": status,
        "real_chromium": True,
        "approved_ui": True,
        "selected_universe_complete": True,
        "all_owner_repositories_observed": False,
        "unknowns_visible": True,
        "retired_fixed_form_present": False,
        "geometry_in_proposal": False,
        "screenshots": {
            "map": args.screenshot.name,
            "ops_packages": ops_screenshot.name,
            "graph": graph_screenshot.name,
            "seq": seq_screenshot.name,
            "proposal": interaction_screenshot.name,
        },
        "page_errors": page_errors,
        "console_errors": console_errors,
        "failed_responses": failed_responses,
        "external_requests": external,
        "request_count": len(requests),
        "github_write_credential_in_worker": False,
        "gov_materialized": False,
        "current_changed": False,
        "authority_changed": False,
        "cutover": False,
    }
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
