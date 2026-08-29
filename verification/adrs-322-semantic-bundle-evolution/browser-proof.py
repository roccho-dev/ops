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
    parser.add_argument("base_url")
    parser.add_argument("proof_id")
    parser.add_argument("bundle_v1_digest")
    parser.add_argument("bundle_v2_digest")
    parser.add_argument("expected_app_version")
    parser.add_argument("run_suffix")
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
    url = args.base_url.rstrip("/") + "/"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome, headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1100})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: requests.append(request.url))
        page.on("response", lambda response: failed_responses.append({"url": response.url, "status": response.status}) if response.status >= 400 else None)
        page.goto(url, wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-status='ready'][data-bundle-id='semantic-evolution/1']").wait_for(timeout=120_000)
        before = json.loads(page.locator("#runtime-state").text_content() or "{}")
        assert before["meta"]["app_version"] == args.expected_app_version
        assert before["surface"]["semantic_bundle_digest"] == args.bundle_v1_digest
        assert before["surface"]["event_object_digest"] == before["evidence"]["event_object_digest"]
        v1_surface_digest = before["surface"]["surface_digest"]
        event_digest = before["surface"]["event_object_digest"]

        v2_request_id = f"browser-v2-{args.run_suffix}"
        v2_result = page.evaluate(
            """async ({proofId, requestId, expectedDigest, nextDigest}) => {
              const response = await fetch('/api/evolution/select', {
                method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({schema:'adrs322.semanticBundleSelectionRequest/1',request_id:requestId,proof_id:proofId,expected_bundle_digest:expectedDigest,next_bundle_digest:nextDigest})
              });
              return {status: response.status, body: await response.json()};
            }""",
            {"proofId": args.proof_id, "requestId": v2_request_id, "expectedDigest": args.bundle_v1_digest, "nextDigest": args.bundle_v2_digest},
        )
        assert v2_result["status"] in (200, 201)
        page.reload(wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-status='ready'][data-bundle-id='semantic-evolution/2']").wait_for(timeout=120_000)
        after = json.loads(page.locator("#runtime-state").text_content() or "{}")
        assert after["meta"]["app_version"] == args.expected_app_version
        assert after["surface"]["semantic_bundle_digest"] == args.bundle_v2_digest
        assert after["surface"]["event_object_digest"] == event_digest
        assert after["surface"]["state_digest"] == before["surface"]["state_digest"]
        assert after["surface"]["surface_digest"] != v1_surface_digest
        assert len(after["surface"]["permitted_actions"]) == 2
        assert page.locator("[data-action-id='inspect-provenance']").is_visible()

        exact_v1 = page.evaluate(
            """async (digest) => {
              const response = await fetch('/api/evolution/surface?' + new URLSearchParams({bundle_digest:digest}));
              return {status: response.status, body: await response.json()};
            }""",
            args.bundle_v1_digest,
        )
        assert exact_v1["status"] == 200
        assert exact_v1["body"]["surface_digest"] == v1_surface_digest

        duplicate = page.evaluate(
            """async ({proofId, requestId, expectedDigest, nextDigest}) => {
              const response = await fetch('/api/evolution/select', {
                method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({schema:'adrs322.semanticBundleSelectionRequest/1',request_id:requestId,proof_id:proofId,expected_bundle_digest:expectedDigest,next_bundle_digest:nextDigest})
              });
              return {status: response.status, body: await response.json()};
            }""",
            {"proofId": args.proof_id, "requestId": v2_request_id, "expectedDigest": args.bundle_v1_digest, "nextDigest": args.bundle_v2_digest},
        )
        assert duplicate["status"] == 200 and duplicate["body"]["duplicate"] is True

        rollback = page.evaluate(
            """async ({proofId, requestId, expectedDigest, nextDigest}) => {
              const response = await fetch('/api/evolution/select', {
                method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({schema:'adrs322.semanticBundleSelectionRequest/1',request_id:requestId,proof_id:proofId,expected_bundle_digest:expectedDigest,next_bundle_digest:nextDigest})
              });
              return {status: response.status, body: await response.json()};
            }""",
            {"proofId": args.proof_id, "requestId": f"browser-rollback-{args.run_suffix}", "expectedDigest": args.bundle_v2_digest, "nextDigest": args.bundle_v1_digest},
        )
        assert rollback["status"] in (200, 201)
        page.reload(wait_until="domcontentloaded", timeout=120_000)
        page.locator("body[data-status='ready'][data-bundle-id='semantic-evolution/1']").wait_for(timeout=120_000)
        rolled = json.loads(page.locator("#runtime-state").text_content() or "{}")
        assert rolled["surface"]["surface_digest"] == v1_surface_digest
        assert rolled["surface"]["event_object_digest"] == event_digest
        assert rolled["meta"]["app_version"] == args.expected_app_version
        page.screenshot(path=str(args.screenshot), full_page=True)
        browser.close()

    origin = urlparse(args.base_url)
    approved = f"{origin.scheme}://{origin.netloc}"
    external = sorted({request for request in requests if not request.startswith(approved) and not request.startswith("data:")})
    assert not page_errors, page_errors
    assert not console_errors, console_errors
    assert not failed_responses, failed_responses
    assert not external, external

    receipt = {
        "schema": "ops.semanticBundleEvolutionBrowserProof/1",
        "status": "PASS",
        "claim_ceiling": "BOUNDED_PROVIDER_PROOF",
        "authority": False,
        "url": url,
        "proof_id": args.proof_id,
        "app_version": args.expected_app_version,
        "event_digest": event_digest,
        "bundle_v1_digest": args.bundle_v1_digest,
        "bundle_v2_digest": args.bundle_v2_digest,
        "surface_v1_digest": v1_surface_digest,
        "surface_v2_digest": after["surface"]["surface_digest"],
        "exact_v1_replay_digest": exact_v1["body"]["surface_digest"],
        "rollback_surface_digest": rolled["surface"]["surface_digest"],
        "same_worker_version": True,
        "duplicate_selection_idempotent": True,
        "page_errors": page_errors,
        "console_errors": console_errors,
        "failed_responses": failed_responses,
        "external_requests": external,
        "request_count": len(requests),
        "real_chromium": True,
        "accepted_meaning_authority": False,
        "production_cutover": False,
    }
    args.receipt.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
