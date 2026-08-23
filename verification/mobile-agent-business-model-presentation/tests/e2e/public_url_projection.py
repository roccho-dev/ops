from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
from typing import Any
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_HTML = ROOT / "dist" / "public" / "index.html"
URLS = json.loads((ROOT / "dist" / "public" / "urls.json").read_text(encoding="utf-8"))


def chromium_path() -> str | None:
    explicit = os.environ.get("CHROMIUM_PATH")
    if explicit:
        return explicit
    for candidate in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def rounded(rect: dict[str, Any] | None) -> dict[str, float] | None:
    if rect is None:
        return None
    return {key: round(float(rect[key]), 3) for key in ("x", "y", "width", "height")}


assert URLS["schema"] == "mobile-agent.business-model-public-url-test/1"
assert URLS["status"] == "PASS"
proofs: list[dict[str, Any]] = []
outer_reference: dict[str, dict[str, float] | None] | None = None

with sync_playwright() as playwright:
    launch: dict[str, Any] = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
    executable = chromium_path()
    if executable:
        launch["executable_path"] = executable
    browser = playwright.chromium.launch(**launch)
    for item in URLS["results"]:
        count = int(item["count"])
        fragment = urlsplit(item["url"]).fragment
        page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
        errors: list[str] = []
        page.on("pageerror", lambda error, bucket=errors: bucket.append(str(error)))
        page.evaluate("fragment => { location.hash = fragment; }", fragment)
        page.set_content(PUBLIC_HTML.read_text(encoding="utf-8"), wait_until="load", timeout=30_000)
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
        page.wait_for_function("document.querySelector('#seq-shell')?.dataset.expanded === 'false'", timeout=30_000)

        metrics = page.evaluate(
            """() => {
              const rect = selector => {
                const value = document.querySelector(selector)?.getBoundingClientRect();
                return value ? {x:value.x,y:value.y,width:value.width,height:value.height} : null;
              };
              return {
                actorCount: document.querySelectorAll('.profiled-actor').length,
                exchangeGroupCount: document.querySelectorAll('.profiled-exchange-group').length,
                columnCount: Number(document.querySelector('.profiled-scene')?.dataset.columnCount || 0),
                bodyScrollWidth: document.body.scrollWidth,
                bodyClientWidth: document.body.clientWidth,
                outerRects: {head: rect('.profiled-head'), timeline: rect('.profiled-timeline')},
                pattern: document.querySelector('meta[name="artifact-pattern"]')?.content || '',
              };
            }"""
        )
        metrics["outerRects"] = {key: rounded(value) for key, value in metrics["outerRects"].items()}
        if outer_reference is None:
            outer_reference = metrics["outerRects"]
        checks = {
            "documentPass": page.locator("html").get_attribute("data-status") == "pass",
            "pattern": metrics["pattern"] == "business-model/1",
            "actorCount": metrics["actorCount"] == count,
            "exchangeGroupCount": metrics["exchangeGroupCount"] == count - 1,
            "columnPattern": metrics["columnCount"] == count * 2 - 1,
            "outerLayoutPreserved": metrics["outerRects"] == outer_reference,
            "noPageHorizontalOverflow": metrics["bodyScrollWidth"] <= metrics["bodyClientWidth"],
            "urlWithinLimit": int(item["urlChars"]) <= 8192,
            "noPageErrors": not errors,
        }
        passed = all(checks.values())
        proof = {
            "schema": "mobile-agent.business-model-public-browser-proof/1",
            "status": "PASS" if passed else "FAIL",
            "pass": passed,
            "actorCount": count,
            "actorOrder": item["actorOrder"],
            "urlChars": item["urlChars"],
            "checks": checks,
            "metrics": metrics,
            "pageErrors": errors,
        }
        proofs.append(proof)
        page.close()
    browser.close()

summary = {
    "schema": "mobile-agent.business-model-public-browser-proof-set/1",
    "status": "PASS" if all(item["pass"] for item in proofs) else "FAIL",
    "pass": all(item["pass"] for item in proofs),
    "proofs": proofs,
}
(ROOT / "dist" / "public" / "browser-proof.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
if not summary["pass"]:
    raise SystemExit(json.dumps(summary, ensure_ascii=False))
print(json.dumps({"status": "PASS", "actors": [item["actorCount"] for item in proofs]}, ensure_ascii=False))
