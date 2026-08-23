from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
from typing import Any

from playwright.sync_api import sync_playwright


def chromium_path() -> str | None:
    explicit = os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
    if explicit:
        return explicit
    for candidate in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: public_host_projection.py URLS_JSON RECEIPT_JSON")
    urls_path = Path(sys.argv[1])
    receipt_path = Path(sys.argv[2])
    manifest = json.loads(urls_path.read_text(encoding="utf-8"))
    assert manifest["schema"] == "mobile-agent.business-model-public-url-test/1"
    proofs: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        launch: dict[str, Any] = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        executable = chromium_path()
        if executable:
            launch["executable_path"] = executable
        browser = playwright.chromium.launch(**launch)
        for item in manifest["results"]:
            count = int(item["count"])
            errors: list[str] = []
            page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
            page.on("pageerror", lambda error, bucket=errors: bucket.append(str(error)))
            response = page.goto(item["url"], wait_until="load", timeout=60_000)
            if response is None or not response.ok:
                raise RuntimeError(f"public response failed for {item['url']}")
            page.wait_for_function("document.documentElement.dataset.status === 'pass'", timeout=30_000)
            stage_ids = page.locator('.profiled-timeline button[data-stage-id]').evaluate_all(
                "buttons => buttons.map(button => button.dataset.stageId)"
            )
            for stage_id in stage_ids:
                page.locator(f'.profiled-timeline button[data-stage-id="{stage_id}"]').click()
                page.wait_for_function(
                    "stage => document.documentElement.dataset.stage === stage", arg=stage_id, timeout=30_000
                )
            page.locator("#seq-open").click()
            page.wait_for_function("document.querySelector('#seq-shell')?.dataset.expanded === 'true'", timeout=30_000)
            page.locator("#seq-close").click()
            metrics = page.evaluate(
                """() => ({
                  actorCount: document.querySelectorAll('.profiled-actor').length,
                  exchangeGroupCount: document.querySelectorAll('.profiled-exchange-group').length,
                  columnCount: Number(document.querySelector('.profiled-scene')?.dataset.columnCount || 0),
                  bodyScrollWidth: document.body.scrollWidth,
                  bodyClientWidth: document.body.clientWidth,
                  pattern: document.querySelector('meta[name="artifact-pattern"]')?.content || '',
                })"""
            )
            checks = {
                "documentPass": page.locator("html").get_attribute("data-status") == "pass",
                "pattern": metrics["pattern"] == "business-model/1",
                "actorCount": metrics["actorCount"] == count,
                "exchangeGroupCount": metrics["exchangeGroupCount"] == count - 1,
                "columnPattern": metrics["columnCount"] == count * 2 - 1,
                "noPageHorizontalOverflow": metrics["bodyScrollWidth"] <= metrics["bodyClientWidth"],
                "noPageErrors": not errors,
            }
            passed = all(checks.values())
            proofs.append({
                "actorCount": count,
                "url": item["url"],
                "status": "PASS" if passed else "FAIL",
                "pass": passed,
                "checks": checks,
                "metrics": metrics,
                "pageErrors": errors,
            })
            page.close()
        browser.close()

    receipt = {
        "schema": "mobile-agent.business-model-public-host-proof/1",
        "status": "PASS" if all(item["pass"] for item in proofs) else "FAIL",
        "pass": all(item["pass"] for item in proofs),
        "proofs": proofs,
    }
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not receipt["pass"]:
        raise SystemExit(json.dumps(receipt, ensure_ascii=False))
    print(json.dumps({"status": "PASS", "actors": [item["actorCount"] for item in proofs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
