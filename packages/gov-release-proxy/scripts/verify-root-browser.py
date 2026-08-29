from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("receipt")
    parser.add_argument("screenshot")
    args = parser.parse_args()

    base = args.base_url.rstrip("/") + "/"
    page_errors: list[str] = []
    console_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        response = page.goto(base, wait_until="load", timeout=30_000)
        assert response is not None and response.status == 200
        page.wait_for_function(
            "globalThis.rootJsonlMapProof?.status === 'PASS'", timeout=30_000
        )
        proof = page.evaluate("globalThis.rootJsonlMapProof")
        assert proof == {"status": "PASS", "records": 1, "nodes": 1}
        assert page.title() == "Decision JSONL Map"
        assert page.locator("#map article").count() == 1
        assert page.locator("#status").inner_text() == "1 records"
        page.screenshot(path=args.screenshot, full_page=True)

        data = page.request.get(
            base,
            headers={"Accept": "application/x-ndjson, application/json;q=0.9"},
            timeout=30_000,
        )
        assert data.status == 200
        body = data.body()
        assert len(body) == 942
        assert data.headers["content-type"].startswith("application/json")
        assert (
            "sha256:" + hashlib.sha256(body).hexdigest()
            == "sha256:6c6409f27657eec4b497d5a0da7a6940416a45508fbf5c7032b57e4ab178f1f6"
        )
        assert data.headers["x-gov-release-upstream-auth"] == "anonymous"

        missing = page.request.get(base + "data/manifest")
        assert missing.status == 404
        posted = page.request.post(base)
        assert posted.status == 405
        browser.close()

    assert page_errors == []
    assert console_errors == []
    screenshot = Path(args.screenshot)
    receipt = {
        "schema": "ops.rootJsonlMapBrowserProof/1",
        "status": "PASS",
        "endpoint": "/",
        "html": "PASS",
        "json": {
            "bytes": 942,
            "sha256": "sha256:6c6409f27657eec4b497d5a0da7a6940416a45508fbf5c7032b57e4ab178f1f6",
        },
        "projection": proof,
        "otherPathStatus": 404,
        "postStatus": 405,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
        "screenshot": {
            "path": screenshot.name,
            "bytes": screenshot.stat().st_size,
            "sha256": "sha256:" + hashlib.sha256(screenshot.read_bytes()).hexdigest(),
        },
        "authority": False,
        "cutover": False,
    }
    Path(args.receipt).write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
