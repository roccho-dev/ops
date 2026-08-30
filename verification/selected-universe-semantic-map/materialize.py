#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import urllib.request


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def remote_bytes(url: str, accept: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": accept,
            "Cache-Control": "no-cache",
            "User-Agent": "roccho-ops-selected-universe-map/2",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        require(response.status == 200, f"fetch HTTP {response.status}: {url}")
        return response.read()


def load_exact(record: dict[str, object], local_path: pathlib.Path | None, accept: str) -> bytes:
    body = local_path.read_bytes() if local_path is not None else remote_bytes(str(record["raw_url"]), accept)
    require(len(body) == int(record["bytes"]), f"byte count mismatch: {record.get('path')}")
    require(sha256(body) == record["sha256"], f"sha256 mismatch: {record.get('path')}")
    require(git_blob_sha1(body) == record["git_blob_sha1"], f"Git blob mismatch: {record.get('path')}")
    return body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()

    source_path = args.source.resolve()
    root = source_path.parent
    source = json.loads(source_path.read_text(encoding="utf-8"))
    require(source["schema"] == "ops.selectedUniverseSemanticMapSource/1", "unsupported source contract")
    require(source["status"] == "PASS", "source contract not closed")
    require(source["claim_ceiling"] == "VISUAL_EVALUATION_ONLY", "claim ceiling mismatch")
    require(source["authority"] is False, "source contract must not claim authority")
    require(source["boundary"] == {
        "html_purpose": "visual-evaluation-only",
        "html_authority": False,
        "meaning_source_changed": False,
        "ui_owns_renderer": True,
        "ops_owns_delivery": True,
        "production_cutover": False,
    }, "responsibility boundary mismatch")

    output = args.output.resolve()
    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True)

    meaning_record = dict(source["meaning"])
    meaning_local = pathlib.Path(os.environ["LOCAL_MEANING_PATH"]) if os.environ.get("LOCAL_MEANING_PATH") else None
    meaning_bytes = meaning_local.read_bytes() if meaning_local is not None else remote_bytes(str(meaning_record["raw_url"]), "application/x-ndjson")
    require(len(meaning_bytes) == int(meaning_record["bytes"]), "meaning byte count mismatch")
    require(sha256(meaning_bytes) == meaning_record["sha256"], "meaning sha256 mismatch")
    require(git_blob_sha1(meaning_bytes) == meaning_record["blob_sha1"], "meaning Git blob mismatch")
    pinned_meaning = root / "selected-universe.jsonl"
    require(pinned_meaning.read_bytes() == meaning_bytes, "Ops pinned meaning differs from governance source")
    (output / "selected-universe.jsonl").write_bytes(meaning_bytes)

    rows = [json.loads(line) for line in meaning_bytes.decode("utf-8").splitlines() if line]
    expected = source["expected"]
    require(len(rows) == expected["row_count"], "meaning row count mismatch")
    require(all(row.get("kind") == expected["record_kind"] for row in rows), "meaning kind mismatch")
    require([row.get("repoId") for row in rows] == expected["repo_ids"], "meaning repo IDs mismatch")

    ui_local_root = pathlib.Path(os.environ["LOCAL_UI_ROOT"]) if os.environ.get("LOCAL_UI_ROOT") else None
    loaded: dict[str, bytes] = {}
    accepts = {
        "html": "text/html",
        "profile": "application/x-ndjson, application/json",
        "svg": "image/svg+xml, text/plain",
        "projection_receipt": "application/json",
        "browser_receipt": "application/json",
        "meaning_source_receipt": "application/json",
    }
    for name, record in source["artifacts"].items():
        local = ui_local_root / pathlib.PurePosixPath(record["path"]).name if ui_local_root is not None else None
        body = load_exact(record, local, accepts[name])
        loaded[name] = body
        (output / pathlib.PurePosixPath(record["path"]).name).write_bytes(body)

    html = loaded["html"]
    profile = json.loads(loaded["profile"].decode("utf-8").strip())
    svg = loaded["svg"]
    projection_receipt = json.loads(loaded["projection_receipt"])
    browser_receipt = json.loads(loaded["browser_receipt"])
    meaning_source_receipt = json.loads(loaded["meaning_source_receipt"])

    require(profile["schema"] == "semantic-map-projection-profile/1", "profile schema mismatch")
    require(profile["profileId"] == expected["profile_id"], "profile ID mismatch")
    require(profile["authority"] is False, "profile authority mismatch")
    require(profile["accepts"] == {"kind": expected["record_kind"]}, "profile accepted kind mismatch")
    require(profile["view"]["pattern"] == expected["pattern"], "profile pattern mismatch")
    require(profile["view"]["relations"] == [], "profile must not invent relations")
    require(profile["interaction"]["authoring"] is False, "evaluation profile must not author")
    require(profile["html"] == {"purpose": "visual-evaluation-only", "authority": False}, "HTML boundary mismatch")

    require(projection_receipt["schema"] == "ui.semanticMapProjectionReceipt/1", "projection receipt schema mismatch")
    require(projection_receipt["status"] == "PASS" and projection_receipt["authority"] is False, "projection receipt invalid")
    require(projection_receipt["meaning"]["sha256"] == meaning_record["sha256"], "projection meaning digest mismatch")
    require(projection_receipt["profile"]["sha256"] == source["artifacts"]["profile"]["sha256"], "projection profile digest mismatch")
    require(projection_receipt["projection"] == {
        "pattern": expected["pattern"],
        "mapId": expected["map_id"],
        "stateHash": expected["state_hash"],
        "regionCount": expected["region_count"],
        "relationCount": expected["relation_count"],
    }, "projection receipt mismatch")

    require(browser_receipt["schema"] == "ui.semanticMapSvgEvaluationReceipt/1", "browser receipt schema mismatch")
    require(browser_receipt["status"] == "PASS" and browser_receipt["authority"] is False, "browser receipt invalid")
    require(browser_receipt["htmlPurpose"] == "visual-evaluation-only", "browser receipt claim mismatch")
    require(browser_receipt["meaning"]["sha256"] == meaning_record["sha256"], "browser meaning digest mismatch")
    require(browser_receipt["profile"]["sha256"] == source["artifacts"]["profile"]["sha256"], "browser profile digest mismatch")
    require(browser_receipt["svg"]["sha256"] == source["artifacts"]["svg"]["sha256"], "browser SVG digest mismatch")
    require(browser_receipt["projection"]["stateHash"] == expected["state_hash"], "browser state hash mismatch")
    require(browser_receipt["projection"]["regionIds"] == ["selected-universe", *expected["repo_ids"]], "browser region IDs mismatch")
    require(browser_receipt["projection"]["relationIds"] == [], "browser relations mismatch")
    require(browser_receipt["browser"]["pageErrors"] == [], "local UI page errors present")
    require(browser_receipt["browser"]["consoleErrors"] == [], "local UI console errors present")
    require(browser_receipt["browser"]["externalRequests"] == [], "local UI external requests present")
    require(browser_receipt["browser"]["zoomChangedViewBox"] is True, "local zoom proof missing")
    require(browser_receipt["browser"]["fitRestoredViewBox"] is True, "local fit proof missing")

    require(meaning_source_receipt == {
        "authority": False,
        "bytes": meaning_record["bytes"],
        "commit": meaning_record["commit"],
        "path": meaning_record["path"],
        "repository": meaning_record["repository"],
        "schema": "ui.semanticMapMeaningSource/1",
        "sha256": meaning_record["sha256"],
    }, "UI meaning-source receipt mismatch")

    html_text = html.decode("utf-8")
    svg_text = svg.decode("utf-8")
    for value in (
        'data-authority="false"',
        'data-html-purpose="visual-evaluation-only"',
        expected["state_hash"],
        meaning_record["sha256"],
        source["artifacts"]["profile"]["sha256"],
        source["artifacts"]["svg"]["sha256"],
        "semanticMapEvaluation",
        "map/1",
        *expected["repo_ids"],
        "projection_gate",
        "authority_records",
        "effectful_executor",
        "renderer_preview",
        "blocking-candidate",
    ):
        require(value in html_text, f"HTML marker missing: {value}")
    require("<script" in html_text and "<svg" in html_text, "evaluation HTML is incomplete")
    require("selected universe" in svg_text and all(repo_id in svg_text for repo_id in expected["repo_ids"]), "SVG meaning labels missing")

    (output / "index.html").write_bytes(html)
    current = {
        "schema": "ops.selectedUniverseSemanticMapCurrent/1",
        "status": "PASS",
        "claim_ceiling": source["claim_ceiling"],
        "authority": False,
        "meaning": {
            **{key: meaning_record[key] for key in ("repository", "commit", "tree", "path", "blob_sha1", "bytes", "sha256", "content_type")},
            "agent_route": "/ with Accept: application/x-ndjson",
        },
        "ui": source["ui"],
        "projection": {
            "profile_id": expected["profile_id"],
            "profile_sha256": source["artifacts"]["profile"]["sha256"],
            "svg_sha256": source["artifacts"]["svg"]["sha256"],
            "pattern": expected["pattern"],
            "map_id": expected["map_id"],
            "state_hash": expected["state_hash"],
            "region_count": expected["region_count"],
            "relation_count": expected["relation_count"],
        },
        "html": {
            "purpose": "visual-evaluation-only",
            "authority": False,
            "bytes": source["artifacts"]["html"]["bytes"],
            "sha256": source["artifacts"]["html"]["sha256"],
            "human_route": "/ with Accept: text/html",
        },
        "ops": source["ops"],
        "production_cutover": False,
    }
    receipt = {
        "schema": "ops.selectedUniverseSemanticMapMaterializeReceipt/1",
        "status": "PASS",
        "claim_ceiling": source["claim_ceiling"],
        "authority": False,
        "meaning": current["meaning"],
        "ui": current["ui"],
        "projection": current["projection"],
        "html": current["html"],
        "boundary": {
            "meaning_source_unchanged": True,
            "semantic_map_renderer_owned_by_ui": True,
            "delivery_owned_by_ops": True,
            "html_visual_evaluation_only": True,
            "html_authority": False,
            "production_cutover": False,
        },
    }
    (output / "current.json").write_text(canonical(current), encoding="utf-8")
    (output / "materialize-receipt.json").write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
