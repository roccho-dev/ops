#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


class NormalizeError(ValueError):
    pass


def need(condition: bool, code: str) -> None:
    if not condition:
        raise NormalizeError(code)


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def by_id(rows: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row.get("id")
        need(isinstance(key, str) and key != "", f"{label}-id")
        need(key not in result, f"{label}-duplicate")
        result[key] = row
    return result


def interaction(preset: str, value: dict[str, Any]) -> str:
    if preset == "graph/1":
        before, moved = value.get("before"), value.get("moved")
        undone, redone = value.get("undone"), value.get("redone")
        need(isinstance(before, dict) and isinstance(moved, dict), "graph-shape")
        need(moved != before and undone == before and redone == moved, "graph-interaction")
        return "drag→undo→redo"
    if preset == "map/1":
        before, after = value.get("before"), value.get("after")
        need(isinstance(before, dict) and isinstance(after, dict), "map-shape")
        need(float(after.get("scale", 0)) > float(before.get("scale", 0)), "map-interaction")
        return "zoom"
    if preset == "seq/1":
        need(value.get("changed") != value.get("before"), "seq-change")
        need(value.get("restored") == value.get("before"), "seq-undo")
        return "edit→undo"
    raise NormalizeError("preset")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stable-urls", type=Path, required=True)
    parser.add_argument("--immutable-urls", type=Path, required=True)
    parser.add_argument("--stable-browser", type=Path, required=True)
    parser.add_argument("--immutable-browser", type=Path, required=True)
    parser.add_argument("--stable-readback", type=Path, required=True)
    parser.add_argument("--immutable-readback", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--artifact-digest", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    stable_urls = load(args.stable_urls)
    immutable_urls = load(args.immutable_urls)
    stable_browser = load(args.stable_browser)
    immutable_browser = load(args.immutable_browser)
    stable_readback = load(args.stable_readback)
    immutable_readback = load(args.immutable_readback)
    manifest = load(args.manifest)

    need(stable_urls.get("schema") == "ops.mobileAgentPresetUrls/1", "stable-url-schema")
    need(immutable_urls.get("schema") == "ops.mobileAgentPresetUrls/1", "immutable-url-schema")
    need(stable_browser.get("schema") == "ops.mobileAgentPresetBrowserProof/1", "stable-browser-schema")
    need(immutable_browser.get("schema") == "ops.mobileAgentPresetBrowserProof/1", "immutable-browser-schema")
    need(stable_browser.get("status") == immutable_browser.get("status") == "PASS", "browser-status")
    need(stable_readback.get("schema") == immutable_readback.get("schema") == "ops.mobileAgentPresetPublicReadback/1", "readback-schema")
    need(stable_readback.get("status") == immutable_readback.get("status") == "PASS", "readback-status")
    need(stable_readback.get("project") == immutable_readback.get("project") == "stg-mobile-agent", "readback-project")
    need(manifest.get("schema") == "ops.mobileAgentPresetApp/1", "manifest-schema")

    stable_base = str(stable_urls.get("base", ""))
    immutable_base = str(immutable_urls.get("base", ""))
    need(stable_base == "https://stg-mobile-agent.pages.dev/", "stable-base")
    immutable_parts = urlsplit(immutable_base)
    need(immutable_parts.scheme == "https", "immutable-scheme")
    need(immutable_parts.netloc.endswith(".stg-mobile-agent.pages.dev"), "immutable-host")
    need(immutable_parts.netloc != "stg-mobile-agent.pages.dev", "immutable-distinct")
    need(immutable_parts.path in ("", "/"), "immutable-path")

    stable_cases = by_id(stable_urls.get("cases", []), "stable-url")
    immutable_cases = by_id(immutable_urls.get("cases", []), "immutable-url")
    stable_proofs = by_id(stable_browser.get("cases", []), "stable-browser")
    immutable_proofs = by_id(immutable_browser.get("cases", []), "immutable-browser")
    ids = set(stable_cases)
    need(ids and ids == set(immutable_cases) == set(stable_proofs) == set(immutable_proofs), "case-set")

    stable_files = {row.get("path"): row for row in stable_readback.get("files", [])}
    immutable_files = {row.get("path"): row for row in immutable_readback.get("files", [])}
    app_stable = stable_files.get("app/index.html")
    app_immutable = immutable_files.get("app/index.html")
    need(isinstance(app_stable, dict) and isinstance(app_immutable, dict), "app-readback")
    need(app_stable.get("bytes") == app_immutable.get("bytes"), "app-bytes")
    need(app_stable.get("sha256") == app_immutable.get("sha256"), "app-sha")
    app_sha = str(app_stable["sha256"])
    if not app_sha.startswith("sha256:"):
        app_sha = "sha256:" + app_sha

    cases = []
    for key in sorted(ids):
        stable_case = stable_cases[key]
        immutable_case = immutable_cases[key]
        stable_proof = stable_proofs[key]
        immutable_proof = immutable_proofs[key]
        pattern = stable_case.get("view", {}).get("pattern")
        need(pattern == immutable_case.get("view", {}).get("pattern"), "pattern-identity")
        need(stable_case.get("envelope") == immutable_case.get("envelope"), "envelope-identity")
        need(stable_proof.get("pattern") == immutable_proof.get("pattern") == pattern, "browser-pattern")
        need(stable_proof.get("status") == immutable_proof.get("status") == "PASS", "case-status")
        need(stable_proof.get("url") == stable_case.get("url"), "stable-browser-url")
        need(immutable_proof.get("url") == immutable_case.get("url"), "immutable-browser-url")
        need(stable_proof.get("maxGraph") is immutable_proof.get("maxGraph") is True, "maxgraph")
        stable_controls = stable_proof.get("controls", [])
        immutable_controls = immutable_proof.get("controls", [])
        need(stable_controls and all(row.get("present") is True for row in stable_controls), "stable-controls")
        need(immutable_controls and all(row.get("present") is True for row in immutable_controls), "immutable-controls")
        need(int(stable_proof.get("sourceExportBytes", 0)) > 0, "stable-source-export")
        need(int(immutable_proof.get("sourceExportBytes", 0)) > 0, "immutable-source-export")
        need(stable_proof.get("browserErrors") == immutable_proof.get("browserErrors") == 0, "browser-errors")
        need(stable_proof.get("failedResponses") == immutable_proof.get("failedResponses") == 0, "failed-responses")
        stable_interaction = interaction(pattern, stable_proof.get("interaction", {}))
        immutable_interaction = interaction(pattern, immutable_proof.get("interaction", {}))
        need(stable_interaction == immutable_interaction, "interaction-identity")
        stable_url = str(stable_case.get("url", ""))
        immutable_url = str(immutable_case.get("url", ""))
        need(urlsplit(stable_url).fragment == urlsplit(immutable_url).fragment, "fragment-identity")
        cases.append({
            "preset": pattern,
            "stableUrl": stable_url,
            "immutableUrl": immutable_url,
            "runtimePattern": pattern,
            "maxGraph": True,
            "interaction": stable_interaction,
            "browserErrors": 0,
            "failedResponses": 0,
            "roundTripExact": True,
        })

    publication = manifest.get("publication", {})
    carrier = publication.get("carrier") or publication.get("archive") or {}
    tag = publication.get("tag")
    sha256 = carrier.get("sha256")
    need(isinstance(tag, str) and tag != "", "carrier-tag")
    need(isinstance(sha256, str) and sha256.startswith("sha256:"), "carrier-sha")

    receipt = {
        "schema": "ops.mobileAgentPublicUrlReceipt/1",
        "status": "PASS",
        "authority": False,
        "repository": "roccho-dev/ops",
        "candidateSha": args.candidate_sha,
        "carrier": {"tag": tag, "sha256": sha256},
        "provider": {
            "kind": "cloudflare-pages",
            "project": "stg-mobile-agent",
            "stableBase": stable_base,
            "deploymentBase": immutable_base,
        },
        "app": {
            "bytes": int(app_stable["bytes"]),
            "sha256": app_sha,
            "stableReadback": "PASS",
            "immutableReadback": "PASS",
        },
        "cases": cases,
        "proof": {
            "stableChrome": "PASS",
            "immutableChrome": "PASS",
            "runId": args.run_id,
            "artifactDigest": args.artifact_digest,
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "cases": [case["preset"] for case in cases]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
