#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


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
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1100})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))
        page.on(
            "response",
            lambda response: failed_responses.append({"url": response.url, "status": response.status})
            if response.status >= 400
            else None,
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-status='ready']").wait_for(state="attached", timeout=120_000)
        state_text = page.locator("#runtime-state").text_content()
        if not state_text:
            raise AssertionError("runtime state DOM receipt missing")
        state = json.loads(state_text)
        text = page.locator("body").inner_text()
        page.screenshot(path=str(args.screenshot), full_page=True)
        browser.close()

    assert state["status"] == "PASS"
    assert state["claimCeiling"] == "PR_CANDIDATE_GREEN"
    assert state["viewContract"] == "ui.govReleaseRuntimeView/1"
    assert state["assetCount"] == 3
    assert all(asset["verified"] is True for asset in state["assets"])
    assert state["semanticReduce"] is False
    assert state["byteIdenticalMirror"] is True
    assert state["productionPackageContract"] is False
    assert state["authenticatedUi"] is False
    assert state["providerE2e"] is False
    assert state["authorityChanged"] is False
    assert state["cutover"] is False
    for expected in (
        "accepted-decision.json",
        "gov-release-manifest.json",
        "gov-release-readback-receipt.json",
        state["sourceRelease"],
    ):
        assert expected in text, expected
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses

    origin = urlparse(args.url)
    approved_origin = f"{origin.scheme}://{origin.netloc}"
    external = sorted({url for url in requests if not url.startswith(approved_origin) and not url.startswith("data:")})
    assert not external, external

    receipt = {
        "schema": "ops.govJsonRuntimeBrowserReceipt/1",
        "status": "PASS",
        "claim_ceiling": "PR_CANDIDATE_GREEN",
        "authority": False,
        "url": args.url,
        "state": state,
        "page_errors": page_errors,
        "console_errors": console_errors,
        "failed_responses": failed_responses,
        "external_requests": external,
        "request_count": len(requests),
        "real_chromium": True,
        "semantic_reduce": False,
        "authenticated_ui": False,
        "provider_e2e": False,
        "authority_changed": False,
        "cutover": False,
    }
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
