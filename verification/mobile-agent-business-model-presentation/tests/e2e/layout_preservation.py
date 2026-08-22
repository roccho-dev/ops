from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
from typing import Any

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "dist" / "layout-samples"
MANIFEST = json.loads((ROOT / "tests" / "e2e" / "fixtures.json").read_text(encoding="utf-8"))


def chromium_path() -> str | None:
    explicit = os.environ.get("CHROMIUM_PATH")
    if explicit:
        return explicit
    for candidate in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def rounded_rect(rect: dict[str, Any] | None) -> dict[str, float] | None:
    if rect is None:
        return None
    return {key: round(float(rect[key]), 3) for key in ("x", "y", "width", "height")}


assert MANIFEST["schema"] == "business-model-layout-e2e-fixtures/1"
fixtures = MANIFEST["fixtures"]
proofs: list[dict[str, Any]] = []
outer_reference: dict[str, dict[str, float] | None] | None = None

with sync_playwright() as playwright:
    executable = chromium_path()
    launch_args: dict[str, Any] = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-dev-shm-usage"],
    }
    if executable:
        launch_args["executable_path"] = executable
    browser = playwright.chromium.launch(**launch_args)

    for fixture in fixtures:
        fixture_id = fixture["id"]
        html_path = OUT / f"{fixture_id}.html"
        html = html_path.read_text(encoding="utf-8")
        html_sha = sha256(html.encode()).hexdigest()
        expected_sha = fixture["expectedHtmlSha256"]
        errors: list[str] = []
        console: list[dict[str, str]] = []

        page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
        page.on("pageerror", lambda error, bucket=errors: bucket.append(str(error)))
        page.on("console", lambda message, bucket=console: bucket.append({"type": message.type, "text": message.text}))
        page.set_content(html, wait_until="load", timeout=30_000)
        page.wait_for_function("document.documentElement.dataset.status === 'pass'", timeout=30_000)

        stage_ids = page.locator('.profiled-timeline button[data-stage-id]').evaluate_all(
            "buttons => buttons.map(button => button.dataset.stageId)"
        )
        visited: list[str] = []
        for stage_id in stage_ids:
            page.locator(f'.profiled-timeline button[data-stage-id="{stage_id}"]').click()
            page.wait_for_function("stage => document.documentElement.dataset.stage === stage", arg=stage_id, timeout=30_000)
            visited.append(stage_id)

        page.locator("#seq-open").click()
        page.wait_for_function("document.querySelector('#seq-shell')?.dataset.expanded === 'true'", timeout=30_000)
        page.locator("#seq-close").click()
        page.wait_for_function("document.querySelector('#seq-shell')?.dataset.expanded === 'false'", timeout=30_000)

        metrics = page.evaluate(
            """() => {
              const one = selector => document.querySelector(selector);
              const rect = selector => {
                const value = one(selector)?.getBoundingClientRect();
                return value ? {x: value.x, y: value.y, width: value.width, height: value.height} : null;
              };
              const scene = one('.profiled-scene');
              return {
                bodyScrollWidth: document.body.scrollWidth,
                bodyClientWidth: document.body.clientWidth,
                columnCount: Number(scene?.dataset.columnCount || 0),
                actorCount: document.querySelectorAll('.profiled-actor').length,
                exchangeGroupCount: document.querySelectorAll('.profiled-exchange-group').length,
                landmarkCounts: {
                  head: document.querySelectorAll('.profiled-head').length,
                  timeline: document.querySelectorAll('.profiled-timeline').length,
                  status: document.querySelectorAll('.profiled-status').length,
                  legend: document.querySelectorAll('.profiled-legend').length,
                  seqShell: document.querySelectorAll('.seq-shell').length
                },
                outerRects: {
                  head: rect('.profiled-head'),
                  timeline: rect('.profiled-timeline')
                },
                scene: {
                  clientWidth: scene?.clientWidth || 0,
                  scrollWidth: scene?.scrollWidth || 0,
                  gridTemplateColumns: scene ? getComputedStyle(scene).gridTemplateColumns : ''
                },
                pageText: one('#surface')?.innerText || ''
              };
            }"""
        )
        metrics["outerRects"] = {key: rounded_rect(value) for key, value in metrics["outerRects"].items()}
        if outer_reference is None:
            outer_reference = metrics["outerRects"]

        expected_actor_count = int(fixture["actorCount"])
        checks = {
            "exactHtml": html_sha == expected_sha,
            "documentPass": page.locator("html").get_attribute("data-status") == "pass",
            "allStagesVisited": visited == stage_ids and len(visited) >= 2,
            "actorCount": metrics["actorCount"] == expected_actor_count,
            "exchangeGroupCount": metrics["exchangeGroupCount"] == expected_actor_count - 1,
            "columnPattern": metrics["columnCount"] == expected_actor_count * 2 - 1,
            "singleOuterLandmarks": all(value == 1 for value in metrics["landmarkCounts"].values()),
            "outerLayoutPreserved": metrics["outerRects"] == outer_reference,
            "noPageHorizontalOverflow": metrics["bodyScrollWidth"] <= metrics["bodyClientWidth"],
            "noPageErrors": not errors,
        }
        passed = all(checks.values())
        screenshot = OUT / f"{fixture_id}.png"
        page.screenshot(path=str(screenshot), full_page=True)
        proof = {
            "schema": "business-model-layout-e2e-proof/1",
            "fixture": fixture_id,
            "status": "PASS" if passed else "FAIL",
            "pass": passed,
            "input": fixture["input"],
            "expectedHtmlSha256": expected_sha,
            "actualHtmlSha256": html_sha,
            "visitedStages": visited,
            "checks": checks,
            "metrics": metrics,
            "surfaceTextSha256": sha256(metrics["pageText"].encode()).hexdigest(),
            "pageErrors": errors,
            "console": console,
            "screenshot": str(screenshot.relative_to(ROOT)).replace("\\", "/"),
        }
        (OUT / f"{fixture_id}.e2e-proof.json").write_text(
            json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        proofs.append(proof)
        page.close()

    browser.close()

all_pass = all(proof["pass"] for proof in proofs)
summary = {
    "schema": "business-model-layout-e2e-proof-set/1",
    "status": "PASS" if all_pass else "FAIL",
    "pass": all_pass,
    "fixtureCount": len(proofs),
    "examplesAreFixtures": True,
    "proofs": proofs,
}
(OUT / "e2e-proof-set.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
if not all_pass:
    raise SystemExit(json.dumps(summary, ensure_ascii=False))
print(json.dumps({"status": "PASS", "fixtures": [proof["fixture"] for proof in proofs]}, ensure_ascii=False))
