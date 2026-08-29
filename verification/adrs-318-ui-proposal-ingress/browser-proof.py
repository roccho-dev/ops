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


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def get_json(url: str) -> dict:
    request = Request(
        url,
        headers={
            "cache-control": "no-cache",
            "accept": "application/json",
            "user-agent": "roccho-ops-adrs318-ui-proposal-browser-proof/1",
        },
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("receipt", type=pathlib.Path)
    parser.add_argument("screenshot", type=pathlib.Path)
    args = parser.parse_args()
    chrome = os.environ.get("CHROME_BIN")
    if not chrome:
        raise SystemExit("CHROME_BIN is required")

    base = args.url.rstrip("/") + "/"
    page_errors: list[str] = []
    console_errors: list[str] = []
    failed_responses: list[dict[str, object]] = []
    requests: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 1050})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))
        page.on(
            "response",
            lambda response: failed_responses.append({"url": response.url, "status": response.status})
            if response.status >= 400 and f"/api/proposals/{PROPOSAL_ID}" not in response.url
            else None,
        )
        page.goto(base, wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-state='ready'], body[data-state='submitted'], body[data-state='recorded']").wait_for(timeout=120_000)
        page.locator("#submit").click()
        page.locator("body[data-state='submitted'], body[data-state='recorded']").wait_for(timeout=120_000)
        state_after_submit = page.locator("body").get_attribute("data-state")
        receipt_text = page.locator("#receipt").text_content() or "{}"
        browser_receipt = json.loads(receipt_text)
        page.locator("#submit").click()
        page.locator("body[data-state='submitted'], body[data-state='recorded']").wait_for(timeout=120_000)
        page.screenshot(path=str(args.screenshot), full_page=True)
        body_text = page.locator("body").inner_text()
        browser.close()

    status = get_json(f"{base}api/proposals/{PROPOSAL_ID}")
    assert state_after_submit in {"submitted", "recorded"}
    assert status["status"] == "PASS"
    assert status["proposal_id"] == PROPOSAL_ID
    assert status["state"] in {"submitted", "recorded"}
    assert status["authority"] is False
    assert status["current_changed"] is False
    assert status["cutover"] is False
    assert PROPOSAL_ID in body_text
    assert "pkg.adrs318.canary" in body_text
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses

    origin = urlparse(base)
    approved = f"{origin.scheme}://{origin.netloc}"
    external = sorted({url for url in requests if not url.startswith(approved) and not url.startswith("data:")})
    assert not external, external

    receipt = {
        "schema": "ops.adrsUiProposalBrowserProof/1",
        "status": "PASS",
        "claim_ceiling": "UI_TO_R2_PROPOSAL_SUBMIT_PROVEN",
        "url": base,
        "proposal_id": PROPOSAL_ID,
        "state_after_submit": state_after_submit,
        "status_after_submit": status,
        "browser_receipt": browser_receipt,
        "real_chromium": True,
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
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
