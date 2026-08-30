from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright


def digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("expected")
    parser.add_argument("receipt")
    parser.add_argument("screenshot")
    args = parser.parse_args()

    expected = json.loads(Path(args.expected).read_text(encoding="utf-8"))
    base = args.base_url.rstrip("/") + "/"
    executable = os.environ.get("CHROME_BIN") or os.environ.get("CHROMIUM_EXECUTABLE") or "/usr/bin/google-chrome"
    page_errors: list[str] = []
    console_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=executable,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        response = None
        for _attempt in range(30):
            try:
                response = page.goto(base, wait_until="load", timeout=30_000)
                if response is not None and response.status == 200:
                    break
            except Exception:
                response = None
            time.sleep(2)
        assert response is not None and response.status == 200
        page.wait_for_function("globalThis.semanticMapSite?.ready === true", timeout=30_000)
        page.wait_for_function("globalThis.semanticMapReview?.ready === true", timeout=30_000)
        rendered = page.evaluate(
            """() => ({
              title: document.title,
              pattern: semanticMapRuntime.view.pattern,
              scene: semanticMapSite.editor.snapshot().scene.pattern,
              svg: Boolean(document.querySelector('#graph-container svg')),
              regionCount: semanticMapApp.adapter.lastScene.regions.length,
              relationCount: semanticMapApp.adapter.lastScene.relations.length,
              tools: semanticMapApp.adapter.cellsByRegionId.has('package:tools'),
              modules: semanticMapApp.adapter.cellsByRegionId.has('package:modules'),
              meaning: document.querySelector('meta[name="governance-meaning-sha256"]')?.content,
              uiCommit: document.querySelector('meta[name="semantic-map-ui-commit"]')?.content,
              profile: document.querySelector('meta[name="semantic-map-profile"]')?.content,
              authority: document.querySelector('meta[name="generated-artifacts-authority"]')?.content,
              cutover: document.querySelector('meta[name="production-cutover"]')?.content,
            })"""
        )
        assert rendered == {
            "title": "Semantic Map",
            "pattern": "map/1",
            "scene": "map/1",
            "svg": True,
            "regionCount": expected["projection"]["regionCount"],
            "relationCount": expected["projection"]["relationCount"],
            "tools": True,
            "modules": True,
            "meaning": expected["meaning"]["sha256"],
            "uiCommit": expected["ui"]["commit"],
            "profile": expected["ui"]["profileId"],
            "authority": "false",
            "cutover": "false",
        }
        page.screenshot(path=args.screenshot, full_page=True)

        html_response = context.request.get(base, headers={"Accept": "text/html"}, timeout=30_000)
        assert html_response.status == 200
        html_body = html_response.body()
        assert len(html_body) == expected["ui"]["htmlBytes"]
        assert digest(html_body) == expected["ui"]["htmlSha256"]
        assert html_response.headers["x-gov-map-binding"] == expected["bindingId"]
        assert html_response.headers["x-gov-ui-meaning-digest"] == expected["meaning"]["sha256"]

        data_response = context.request.get(
            base,
            headers={"Accept": "application/x-ndjson, application/json;q=0.9"},
            timeout=30_000,
        )
        assert data_response.status == 200
        data_body = data_response.body()
        assert len(data_body) == expected["meaning"]["bytes"]
        assert digest(data_body) == expected["meaning"]["sha256"]
        assert data_response.headers["x-gov-map-binding"] == expected["bindingId"]
        assert data_response.headers["x-gov-release-digest"] == expected["meaning"]["sha256"]
        assert data_response.headers["x-gov-ui-meaning-digest"] == expected["meaning"]["sha256"]
        assert data_response.headers["x-gov-production-cutover"] == "false"

        missing = context.request.get(urljoin(base, "missing"))
        posted = context.request.post(base)
        assert missing.status == 404
        assert posted.status == 405
        browser.close()

    assert page_errors == []
    assert console_errors == []
    screenshot = Path(args.screenshot)
    receipt = {
        "schema": "ops.govPackageSemanticMapBrowserProof/1",
        "status": "PASS",
        "url": base,
        "bindingId": expected["bindingId"],
        "meaning": expected["meaning"],
        "ui": expected["ui"],
        "projection": rendered,
        "htmlReadback": "PASS",
        "ndjsonReadback": "PASS",
        "otherPathStatus": 404,
        "postStatus": 405,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
        "screenshot": {
            "path": screenshot.name,
            "bytes": screenshot.stat().st_size,
            "sha256": digest(screenshot.read_bytes()),
        },
        "authority": False,
        "productionCutover": False,
    }
    Path(args.receipt).write_text(json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
