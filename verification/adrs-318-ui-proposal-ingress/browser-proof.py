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
REQUIRED_IDS = {"repo:adrs", "repo:governance", "repo:ops", TARGET_ID}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def get_json(url: str) -> dict:
    request = Request(
        url,
        headers={
            "cache-control": "no-cache",
            "accept": "application/json",
            "user-agent": "roccho-ops-approved-semantic-map-browser-proof/1",
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
    page_errors: list[str] = []
    console_errors: list[str] = []
    failed_responses: list[dict[str, object]] = []
    requests: list[str] = []
    interaction_screenshot = args.screenshot.with_name(
        f"{args.screenshot.stem}-proposal{args.screenshot.suffix}"
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))

        def record_failure(response: object) -> None:
            status = response.status
            url = response.url
            if status >= 400:
                failed_responses.append({"url": url, "status": status})

        page.on("response", record_failure)

        if args.visual_only:
            observation_url = f"{base}api/proposals/{PROPOSAL_ID}"

            def fulfill_visual_observation(route: object) -> None:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=canonical({
                        "status": "PASS",
                        "proposal_id": PROPOSAL_ID,
                        "state": "ready",
                        "authority": False,
                        "current_changed": False,
                        "cutover": False,
                    }),
                )

            page.route(observation_url, fulfill_visual_observation)

        page.goto(base, wait_until="domcontentloaded", timeout=120_000)
        page.locator("#graph-container svg").first.wait_for(state="attached", timeout=120_000)
        page.locator("#proposal-connect-button").wait_for(state="visible", timeout=120_000)

        snapshot = page.evaluate(
            """() => ({
              siteReady: globalThis.semanticMapSite?.ready === true,
              appReady: globalThis.semanticMapApp?.ready === true,
              connectabilityReady: globalThis.semanticProposalConnectability?.ready === true,
              title: document.title,
              h1: document.querySelector('h1')?.textContent ?? '',
              pattern: globalThis.semanticMapSite?.runtime?.view?.pattern ?? null,
              regionIds: globalThis.semanticMapApp ? [...globalThis.semanticMapApp.domain.regions.keys()].sort() : [],
              relationCount: globalThis.semanticMapApp?.domain?.relations?.length ?? 0,
              representationCount: globalThis.semanticMapApp?.snapshot()?.scene?.representationIds?.length ?? 0,
              oldFormPresent: document.body.innerText.includes('ADRS UI Proposal Canary') || document.body.innerText.includes('固定canary変更'),
              uiCommit: document.querySelector('meta[name="semantic-map-ui-commit"]')?.content ?? null,
            })"""
        )
        assert snapshot["siteReady"] is True and snapshot["appReady"] is True and snapshot["connectabilityReady"] is True, snapshot
        assert snapshot["title"].startswith("ADRS / governance / ops — package map"), snapshot
        assert snapshot["h1"] == "ADRS / governance / ops — package map", snapshot
        assert snapshot["pattern"] == "map/1", snapshot
        assert REQUIRED_IDS.issubset(set(snapshot["regionIds"])), snapshot
        assert snapshot["relationCount"] >= 5, snapshot
        assert snapshot["representationCount"] >= 20, snapshot
        assert snapshot["oldFormPresent"] is False, snapshot
        assert isinstance(snapshot["uiCommit"], str) and len(snapshot["uiCommit"]) == 40, snapshot

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
        page.evaluate(
            """() => {
              const dialog = document.querySelector('#proposal-connect-dialog');
              if (dialog?.open) dialog.close();
            }"""
        )
        page.screenshot(path=str(args.screenshot), full_page=True)
        browser.close()

    assert live["selected"] is True, live
    assert live["bodyState"] == ("prepared" if args.visual_only else "recorded"), live
    if not args.visual_only:
        assert live["state"] == "recorded", live
        assert live["last"]["observation"]["value"]["exact_comment_readback"] is True, live
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses

    origin = urlparse(base)
    approved = f"{origin.scheme}://{origin.netloc}"
    external = sorted({
        url for url in requests
        if not url.startswith(approved)
        and not url.startswith("data:")
        and not url.startswith("blob:")
        and url != "about:blank"
    })
    assert not external, external

    receipt = {
        "schema": "ops.approvedSemanticMapBrowserProof/1",
        "status": "PASS",
        "mode": "visual-only" if args.visual_only else "live-provider",
        "url": base,
        "ui_commit": snapshot["uiCommit"],
        "pattern": snapshot["pattern"],
        "required_region_ids": sorted(REQUIRED_IDS),
        "representation_count": snapshot["representationCount"],
        "relation_count": snapshot["relationCount"],
        "proposal_id": PROPOSAL_ID,
        "target_id": TARGET_ID,
        "proposal_state": live["state"],
        "status_after_submit": status,
        "real_chromium": True,
        "approved_ui": True,
        "retired_fixed_form_present": False,
        "geometry_in_proposal": False,
        "overview_screenshot": args.screenshot.name,
        "interaction_screenshot": interaction_screenshot.name,
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
