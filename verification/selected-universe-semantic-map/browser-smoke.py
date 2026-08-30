#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
from urllib.parse import urlparse

from playwright.sync_api import Route, Request, sync_playwright


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("receipt", type=pathlib.Path)
    parser.add_argument("screenshot", type=pathlib.Path)
    args = parser.parse_args()
    chrome = os.environ.get("CHROME_BIN")
    if not chrome:
        raise SystemExit("CHROME_BIN is required")

    page_errors: list[str] = []
    console_errors: list[str] = []
    failed_responses: list[dict[str, object]] = []
    requests: list[str] = []
    auxiliary_requests: list[str] = []

    def fulfill_browser_favicon(route: Route, request: Request) -> None:
        auxiliary_requests.append(request.url)
        route.fulfill(status=204, content_type="image/x-icon", body="")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=chrome,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        page.route("**/favicon.ico", fulfill_browser_favicon)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))
        page.on(
            "response",
            lambda response: failed_responses.append({"url": response.url, "status": response.status})
            if response.status >= 400
            else None,
        )
        response = page.goto(args.url, wait_until="load", timeout=120_000)
        assert response is not None and response.status == 200
        page.wait_for_function("globalThis.semanticMapEvaluation?.ready === true", timeout=30_000)
        before = page.locator("#semantic-map-svg").get_attribute("viewBox")
        page.locator("#zoom-in").click()
        page.wait_for_timeout(100)
        zoomed = page.locator("#semantic-map-svg").get_attribute("viewBox")
        page.locator("#fit").click()
        page.wait_for_timeout(100)
        fitted = page.locator("#semantic-map-svg").get_attribute("viewBox")
        observed = page.evaluate(
            """() => ({
              evaluation: globalThis.semanticMapEvaluation,
              documentAuthority: document.documentElement.dataset.authority,
              htmlPurpose: document.documentElement.dataset.htmlPurpose,
              stateHash: document.documentElement.dataset.stateHash,
              meaningSha256: document.documentElement.dataset.meaningSha256,
              profileSha256: document.documentElement.dataset.profileSha256,
              svgSha256: document.documentElement.dataset.svgSha256,
              svg: Boolean(document.querySelector('#semantic-map-svg')),
              title: document.querySelector('#map-title')?.textContent,
              cardRepoIds: [...document.querySelectorAll('[data-repo]')].map((node) => node.dataset.repo),
              bodyText: document.body.innerText,
            })"""
        )
        page.screenshot(path=str(args.screenshot), full_page=True)
        browser.close()

    expected_repo_ids = [
        "roccho-dev/governance",
        "roccho-dev/adrs",
        "roccho-dev/ops",
        "roccho-dev/ui",
    ]
    expected_region_ids = ["selected-universe", *expected_repo_ids]
    evaluation = observed["evaluation"]
    assert evaluation["pattern"] == "map/1"
    assert evaluation["mapId"] == "urn:roccho:governance:selected-universe"
    assert evaluation["stateHash"] == "sha256:70c0dec23c66140af759a05446049d01efef4c2cfd6d9ea7e2cb711117679c3e"
    assert evaluation["meaningSha256"] == "sha256:d29c4cbee8e3c38fc9a29e9dbe2d39e0a6989a62ba2771302b85711025c9ebc3"
    assert evaluation["profileSha256"] == "sha256:135ba5e65d0c939967d953ad39068bd371c46d30393a94a794c2a1f6403ae611"
    assert evaluation["svgSha256"] == "sha256:a170306bebeaf7ca9f12de433bc6c169db4c3be3c24a993cea1ffa5b7993e6da"
    assert evaluation["regionIds"] == expected_region_ids
    assert evaluation["relationIds"] == []
    assert evaluation["authority"] is False
    assert evaluation["htmlPurpose"] == "visual-evaluation-only"
    assert observed["documentAuthority"] == "false"
    assert observed["htmlPurpose"] == "visual-evaluation-only"
    assert observed["stateHash"] == evaluation["stateHash"]
    assert observed["meaningSha256"] == evaluation["meaningSha256"]
    assert observed["profileSha256"] == evaluation["profileSha256"]
    assert observed["svgSha256"] == evaluation["svgSha256"]
    assert observed["svg"] is True
    assert observed["title"] == "governance selected universe"
    assert observed["cardRepoIds"] == expected_repo_ids
    assert before == "0 0 1600 1000"
    assert zoomed != before
    assert fitted == before
    for text in (
        *expected_repo_ids,
        "projection_gate",
        "authority_records",
        "effectful_executor",
        "renderer_preview",
        "shadow-observed",
        "blocking-candidate",
        "VISUAL EVALUATION",
    ):
        assert text in observed["bodyText"], text
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses

    origin = urlparse(args.url)
    approved_origin = f"{origin.scheme}://{origin.netloc}"
    external = sorted({url for url in requests if not url.startswith(approved_origin) and not url.startswith("data:")})
    assert not external, external
    assert all(url.endswith("/favicon.ico") for url in auxiliary_requests), auxiliary_requests

    receipt = {
        "schema": "ops.selectedUniverseSemanticMapBrowserReceipt/3",
        "status": "PASS",
        "claim_ceiling": "VISUAL_EVALUATION_ONLY",
        "authority": False,
        "url": args.url,
        "pattern": evaluation["pattern"],
        "map_id": evaluation["mapId"],
        "state_hash": evaluation["stateHash"],
        "meaning_sha256": evaluation["meaningSha256"],
        "profile_sha256": evaluation["profileSha256"],
        "svg_sha256": evaluation["svgSha256"],
        "region_count": len(evaluation["regionIds"]),
        "relation_count": len(evaluation["relationIds"]),
        "repo_ids_visible": expected_repo_ids,
        "zoom_changed_viewbox": True,
        "fit_restored_viewbox": True,
        "html_visual_evaluation_only": True,
        "page_errors": page_errors,
        "console_errors": console_errors,
        "failed_product_responses": failed_responses,
        "external_requests": external,
        "browser_auxiliary_requests_intercepted": auxiliary_requests,
        "request_count": len(requests),
        "real_chromium": True,
        "production_cutover": False,
    }
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
