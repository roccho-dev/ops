#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
from urllib.parse import urlencode, urlparse

from playwright.sync_api import sync_playwright


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("subject_id")
    parser.add_argument("request_id")
    parser.add_argument("receipt", type=pathlib.Path)
    parser.add_argument("screenshot", type=pathlib.Path)
    args = parser.parse_args()
    chrome = os.environ.get("CHROME_BIN")
    if not chrome:
        raise SystemExit("CHROME_BIN is required")

    url = f"{args.base_url.rstrip('/')}/?{urlencode({'subject_id': args.subject_id, 'request_id': args.request_id})}"
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
        page.on("response", lambda response: failed_responses.append({"url": response.url, "status": response.status}) if response.status >= 400 else None)
        page.goto(url, wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-status='ready'][data-external-state='available']").wait_for(timeout=120_000)
        before = json.loads(page.locator("#runtime-state").text_content() or "{}")
        before_version = before["meta"]["app_version"]
        before_digest = before["external"]["surface_digest"]
        internal_digest = before["internal"]["surface_digest"]
        kernel_digest = before["internal"]["kernel_digest"]
        assert before["external"]["kernel_digest"] == kernel_digest

        page.locator("#next-action").click()
        page.locator("body[data-status='ready'][data-external-state='continued']").wait_for(timeout=120_000)
        after = json.loads(page.locator("#runtime-state").text_content() or "{}")
        assert after["meta"]["app_version"] == before_version
        assert after["external"]["surface_digest"] != before_digest
        assert after["internal"]["surface_digest"] == internal_digest
        assert after["external"]["kernel_digest"] == kernel_digest
        assert after["evidence"]["object_count"] == 1
        assert after["evidence"]["projection_object_count"] == 0
        assert page.locator("#open-next").is_visible()

        duplicate = page.evaluate(
            """async ({subjectId, requestId}) => {
              const response = await fetch('/api/observations', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({schema:'adrs322.actionObservationRequest/1',request_id:requestId,subject_id:subjectId,profile_id:'external',action_id:'continue'})
              });
              return {status: response.status, body: await response.json()};
            }""",
            {"subjectId": args.subject_id, "requestId": args.request_id},
        )
        assert duplicate["status"] == 200
        assert duplicate["body"]["duplicate"] is True

        page.reload(wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-status='ready'][data-external-state='continued']").wait_for(timeout=120_000)
        replay = json.loads(page.locator("#runtime-state").text_content() or "{}")
        assert replay["external"]["surface_digest"] == after["external"]["surface_digest"]
        assert replay["external"]["state_digest"] == after["external"]["state_digest"]
        assert replay["meta"]["app_version"] == before_version
        page.screenshot(path=str(args.screenshot), full_page=True)
        browser.close()

    origin = urlparse(args.base_url)
    approved_origin = f"{origin.scheme}://{origin.netloc}"
    external = sorted({request for request in requests if not request.startswith(approved_origin) and not request.startswith("data:")})
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses
    assert not external, external

    receipt = {
        "schema": "ops.logProjectedApplicationBrowserProof/1",
        "status": "PASS",
        "claim_ceiling": "BOUNDED_PROVIDER_PROOF",
        "authority": False,
        "url": url,
        "subject_id": args.subject_id,
        "request_id": args.request_id,
        "app_version": before_version,
        "kernel_digest": kernel_digest,
        "internal_surface_digest": internal_digest,
        "external_before_surface_digest": before_digest,
        "external_after_surface_digest": after["external"]["surface_digest"],
        "reload_surface_digest": replay["external"]["surface_digest"],
        "duplicate_result": "PASS",
        "observation_object_count": replay["evidence"]["object_count"],
        "projection_object_count": replay["evidence"]["projection_object_count"],
        "page_errors": page_errors,
        "console_errors": console_errors,
        "failed_responses": failed_responses,
        "external_requests": external,
        "request_count": len(requests),
        "real_chromium": True,
        "production_cutover": False,
    }
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
