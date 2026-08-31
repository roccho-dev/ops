#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import sys
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright


def invariant(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(f"mobile-agent-browser-compiler: {message}")


def canonical_state(records: list[dict]) -> dict:
    meta = next((row for row in records if row.get("type") == "meta"), None)
    invariant(isinstance(meta, dict), "meta row missing")
    root = meta.get("root")
    invariant(isinstance(root, str) and root, "meta.root missing")
    regions = [row for row in records if row.get("type") == "region"]
    relations = [row for row in records if row.get("type") == "relation"]
    invariant(regions, "regions missing")
    return {
        "rootId": root,
        "map": {"schema": meta.get("schema", "semantic-map-state/1"), "title": meta.get("title", "")},
        "regions": regions,
        "relations": relations,
    }


def main(argv: list[str]) -> int:
    invariant(len(argv) == 6, "usage: compile_urls_browser.py APP_BASE MANIFEST OUTPUT_BASE OUTPUT CHROME")
    app_base = argv[1].rstrip("/") + "/"
    manifest_path = pathlib.Path(argv[2]).resolve()
    output_base = argv[3].rstrip("/") + "/"
    output_path = pathlib.Path(argv[4]).resolve()
    chrome = argv[5]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    fixtures = manifest.get("fixtures")
    invariant(isinstance(fixtures, list) and fixtures, "manifest fixtures missing")
    cases = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            for item in fixtures:
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                errors: list[str] = []
                failed: list[dict] = []
                page.route("**/favicon.ico", lambda route: route.fulfill(status=204, content_type="image/x-icon", body=""))
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                page.on("response", lambda response: failed.append({"status": response.status, "url": response.url}) if response.status >= 400 and not response.url.endswith("/favicon.ico") else None)
                page.goto(urljoin(app_base, "app/"), wait_until="networkidle", timeout=75000)
                page.wait_for_function("globalThis.semanticMapApp?.ready === true", timeout=75000)
                fixture_path = (manifest_path.parent / item["path"]).resolve()
                source = fixture_path.read_text(encoding="utf-8")
                rows = [json.loads(line) for line in source.splitlines() if line.strip()]
                state = canonical_state(rows)
                result = page.evaluate(
                    """async ({state, view, base}) => {
                      semanticMapRuntime.setState(state);
                      semanticMapRuntime.setView(view);
                      await semanticMapRuntime.commit();
                      const url = await semanticMapRuntime.createUrl(new URL('app/', base).href);
                      const decoded = await semanticMapRuntime.readHash(new URL(url).hash);
                      return {url, envelope: semanticMapRuntime.envelope(), decoded};
                    }""",
                    {"state": state, "view": item["view"], "base": output_base},
                )
                invariant(result["decoded"]["envelope"] == result["envelope"], f"{item['id']}: URL round-trip")
                invariant(errors == [], f"{item['id']}: browser errors {errors}")
                invariant(failed == [], f"{item['id']}: failed responses {failed}")
                cases.append({
                    **item,
                    "url": result["url"],
                    "urlLength": len(result["url"]),
                    "envelope": result["envelope"],
                    "input": {
                        "bytes": len(source.encode("utf-8")),
                        "sha256": "sha256:" + hashlib.sha256(source.encode("utf-8")).hexdigest(),
                        "lines": len(rows),
                    },
                    "roundTripExact": True,
                    "browserErrors": 0,
                    "failedResponses": 0,
                })
                page.close()
        finally:
            browser.close()
    output = {
        "schema": "ops.mobileAgentPresetUrls/2",
        "authority": False,
        "status": "PASS",
        "appBase": app_base,
        "base": output_base,
        "sourceCloneUsed": False,
        "sourceBuildUsed": False,
        "cases": cases,
    }
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "cases": [{"id": row["id"], "preset": row["view"]["pattern"], "urlLength": row["urlLength"]} for row in cases]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
