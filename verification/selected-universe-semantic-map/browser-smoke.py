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
        browser = playwright.chromium.launch(
            executable_path=chrome,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))
        page.on(
            "response",
            lambda response: failed_responses.append({"url": response.url, "status": response.status})
            if response.status >= 400
            else None,
        )
        page.goto(args.url, wait_until="load", timeout=120_000)
        page.wait_for_function("globalThis.semanticMapSite?.ready === true", timeout=120_000)
        observed = page.evaluate(
            """() => {
              const domain = semanticMapApp.store.domain;
              return {
                pattern: semanticMapRuntime.view.pattern,
                scenePattern: semanticMapSite.editor.snapshot().scene.pattern,
                svg: Boolean(document.querySelector('#graph-container svg')),
                editorReady: Boolean(semanticMapSite.editor?.ready),
                title: document.querySelector('#map-title')?.textContent,
                regionIds: [...domain.regions.keys()],
                relationIds: domain.relations.map((relation) => relation.id),
                patternControl: document.querySelector('#pattern-select')?.value,
                sourceControl: Boolean(document.querySelector('#source-open')),
                helpControl: Boolean(document.querySelector('a.help-link')),
                bodyText: document.body.innerText,
              };
            }"""
        )
        page.screenshot(path=str(args.screenshot), full_page=True)
        browser.close()

    expected_ids = {
        "selected-universe",
        "roccho-dev/governance",
        "roccho-dev/adrs",
        "roccho-dev/ops",
        "roccho-dev/ui",
    }
    assert observed["pattern"] == "map/1"
    assert observed["scenePattern"] == "map/1"
    assert observed["patternControl"] == "map/1"
    assert observed["svg"] is True
    assert observed["editorReady"] is True
    assert observed["title"] == "governance selected universe"
    assert set(observed["regionIds"]) == expected_ids
    assert observed["relationIds"] == []
    assert observed["sourceControl"] is True
    assert observed["helpControl"] is True
    for text in (
        "roccho-dev/governance",
        "roccho-dev/adrs",
        "roccho-dev/ops",
        "roccho-dev/ui",
        "projection_gate",
        "authority_records",
        "effectful_executor",
        "renderer_preview",
        "shadow-observed",
        "blocking-candidate",
    ):
        assert text in observed["bodyText"], text
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses

    origin = urlparse(args.url)
    approved_origin = f"{origin.scheme}://{origin.netloc}"
    external = sorted({url for url in requests if not url.startswith(approved_origin) and not url.startswith("data:")})
    assert not external, external

    receipt = {
        "schema": "ops.selectedUniverseSemanticMapBrowserReceipt/1",
        "status": "PASS",
        "claim_ceiling": "VISUAL_EVALUATION_ONLY",
        "authority": False,
        "url": args.url,
        "pattern": observed["pattern"],
        "region_count": len(observed["regionIds"]),
        "relation_count": len(observed["relationIds"]),
        "repo_ids_visible": sorted(expected_ids - {"selected-universe"}),
        "html_visual_evaluation_only": True,
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
