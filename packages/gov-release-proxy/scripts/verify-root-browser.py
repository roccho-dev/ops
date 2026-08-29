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
            "Boolean(globalThis.rootJsonlMapProof?.status)", timeout=30_000
        )
        proof = page.evaluate("globalThis.rootJsonlMapProof")
        page.screenshot(path=args.screenshot, full_page=True)
        assert proof["status"] == "PASS", f"browser projection failed: {proof}"
        assert proof["records"] >= 1
        assert proof["nodes"] == proof["records"]
        assert page.title() == "Decision JSONL Map"
        assert page.locator("#map article").count() == proof["nodes"]

        data = page.request.get(
            base,
            headers={"Accept": "application/x-ndjson, application/json;q=0.9"},
            timeout=30_000,
        )
        assert data.status == 200
        body = data.body()
        assert len(body) > 0
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        assert digest == data.headers["x-gov-release-digest"]
        assert data.headers["x-gov-release-selector"] == "latest"
        assert data.headers["x-gov-release-repository"] == "roccho-dev/governance"
        assert data.headers["x-gov-release-asset"] == "accepted-decision.json"
        assert data.headers["x-gov-release-upstream-auth"] in {"anonymous", "credential"}
        assert data.headers["content-type"].startswith(("application/json", "application/x-ndjson"))

        missing = page.request.get(base + "data/manifest")
        assert missing.status == 404
        posted = page.request.post(base)
        assert posted.status == 405
        browser.close()

    assert page_errors == []
    assert console_errors == []
    screenshot = Path(args.screenshot)
    receipt = {
        "schema": "ops.rootJsonlMapBrowserProof/2",
        "status": "PASS",
        "endpoint": "/",
        "html": "PASS",
        "release": {
            "repository": data.headers["x-gov-release-repository"],
            "releaseId": data.headers["x-gov-release-id"],
            "releaseNumericId": int(data.headers["x-gov-release-numeric-id"]),
            "tag": data.headers["x-gov-release-tag"],
            "commit": data.headers["x-gov-release-commit"],
            "asset": data.headers["x-gov-release-asset"],
            "assetId": int(data.headers["x-gov-release-asset-id"]),
            "bytes": len(body),
            "sha256": digest,
            "upstreamAuth": data.headers["x-gov-release-upstream-auth"],
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
        "runtimeFixture": False,
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
