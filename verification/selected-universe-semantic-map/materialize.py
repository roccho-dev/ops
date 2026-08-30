#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import tarfile
import tempfile
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


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/x-ndjson, text/plain",
            "User-Agent": "roccho-ops-selected-universe-map/1",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        require(response.status == 200, f"meaning fetch HTTP {response.status}")
        return response.read()


def safe_extract(archive: pathlib.Path, destination: pathlib.Path) -> None:
    with tarfile.open(archive, "r:xz") as handle:
        for member in handle.getmembers():
            path = pathlib.PurePosixPath(member.name)
            require(not path.is_absolute() and ".." not in path.parts, f"unsafe archive path: {member.name}")
            require(not member.issym() and not member.islnk(), f"archive link rejected: {member.name}")
        handle.extractall(destination, filter="data")


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
    boundary = source["boundary"]
    require(boundary == {
        "html_purpose": "visual-evaluation-only",
        "html_authority": False,
        "meaning_source_changed": False,
        "ui_owns_renderer": True,
        "ops_owns_delivery": True,
        "production_cutover": False,
    }, "responsibility boundary mismatch")

    artifact = source["artifact"]
    archive = root / artifact["archive_path"]
    archive_bytes = archive.read_bytes()
    require(len(archive_bytes) == artifact["archive_bytes"], "archive byte count mismatch")
    require(sha256(archive_bytes) == artifact["archive_sha256"], "archive digest mismatch")

    output = args.output.resolve()
    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as temporary:
        extracted = pathlib.Path(temporary)
        safe_extract(archive, extracted)
        children = list(extracted.iterdir())
        if len(children) == 1 and children[0].is_dir():
            extracted = children[0]
        for item in extracted.iterdir():
            destination = output / item.name
            if item.is_dir():
                shutil.copytree(item, destination)
            else:
                shutil.copy2(item, destination)

    expected_files = {
        artifact["html_path"]: (artifact["html_bytes"], artifact["html_sha256"]),
        artifact["profile_path"]: (None, artifact["profile_sha256"]),
        artifact["projection_receipt_path"]: (None, artifact["projection_receipt_sha256"]),
        artifact["ui_build_receipt_path"]: (None, artifact["ui_build_receipt_sha256"]),
        artifact["envelope_path"]: (None, artifact["envelope_sha256"]),
        artifact["state_path"]: (None, artifact["state_sha256"]),
        artifact["manifest_path"]: (None, artifact["manifest_sha256"]),
    }
    for relative, (expected_bytes, expected_digest) in expected_files.items():
        body = (output / relative).read_bytes()
        if expected_bytes is not None:
            require(len(body) == expected_bytes, f"{relative}: byte count mismatch")
        require(sha256(body) == expected_digest, f"{relative}: digest mismatch")

    meaning = source["meaning"]
    local_meaning = os.environ.get("LOCAL_MEANING_PATH")
    meaning_bytes = pathlib.Path(local_meaning).read_bytes() if local_meaning else fetch(meaning["raw_url"])
    require(len(meaning_bytes) == meaning["bytes"], "meaning byte count mismatch")
    require(sha256(meaning_bytes) == meaning["sha256"], "meaning digest mismatch")
    require(git_blob_sha1(meaning_bytes) == meaning["blob_sha1"], "meaning Git blob mismatch")
    bundled_meaning_path = output / "selected-universe.jsonl"
    require(bundled_meaning_path.read_bytes() == meaning_bytes, "bundled meaning differs from governance source")
    rows = [json.loads(line) for line in meaning_bytes.decode("utf-8").splitlines() if line]
    expected = source["expected"]
    require(len(rows) == expected["row_count"], "meaning row count mismatch")
    require(all(row.get("kind") == expected["record_kind"] for row in rows), "meaning kind mismatch")
    require([row.get("repoId") for row in rows] == expected["repo_ids"], "meaning repo IDs mismatch")

    profile = json.loads((output / artifact["profile_path"]).read_text(encoding="utf-8").strip())
    require(profile["schema"] == "semantic-map-projection-profile/1", "profile schema mismatch")
    require(profile["profileId"] == expected["profile_id"], "profile ID mismatch")
    require(profile["authority"] is False, "profile must not claim authority")
    require(profile["view"]["pattern"] == expected["pattern"], "profile pattern mismatch")

    envelope = json.loads((output / artifact["envelope_path"]).read_text(encoding="utf-8"))
    require(envelope["schema"] == "semantic-map-envelope/3", "envelope schema mismatch")
    require(envelope["proposal"] is None, "evaluation envelope must not contain a proposal")
    require(envelope["view"]["pattern"] == expected["pattern"], "envelope pattern mismatch")
    log = [json.loads(line) for line in envelope["log"].splitlines() if line]
    require(len(log) == 1, "one initial semantic decision required")
    decision = log[0]
    require(decision["schema"] == "semantic-map-decision/2", "decision schema mismatch")
    require(decision["parent"] is None, "initial decision parent must be null")
    require(decision["stateHash"] == expected["state_hash"], "state hash mismatch")
    require(len(decision["operations"]) == 1 and decision["operations"][0]["type"] == "CreateMap", "one CreateMap required")
    create = decision["operations"][0]
    require(create["mapId"] == expected["map_id"], "map ID mismatch")
    regions = [record for record in create["records"] if record.get("type") == "region"]
    relations = [record for record in create["records"] if record.get("type") == "relation"]
    require(len(regions) == expected["region_count"], "region count mismatch")
    require(len(relations) == expected["relation_count"], "relation count mismatch")
    require({region["id"] for region in regions} == {"selected-universe", *expected["repo_ids"]}, "region identities mismatch")

    projection_receipt = json.loads((output / artifact["projection_receipt_path"]).read_text(encoding="utf-8"))
    require(projection_receipt["status"] == "PASS" and projection_receipt["authority"] is False, "projection receipt invalid")
    require(projection_receipt["source"]["sha256"] == meaning["sha256"], "projection source digest mismatch")
    require(projection_receipt["profile"]["sha256"] == artifact["profile_sha256"], "projection profile digest mismatch")
    require(projection_receipt["state"]["stateHash"] == expected["state_hash"], "projection state mismatch")

    ui_receipt = json.loads((output / artifact["ui_build_receipt_path"]).read_text(encoding="utf-8"))
    require(ui_receipt["schema"] == "semantic-map-example-build/1" and ui_receipt["status"] == "PASS", "UI build receipt invalid")
    require(ui_receipt["input"]["sha256"] == artifact["envelope_sha256"], "UI input digest mismatch")
    require(ui_receipt["output"]["bytes"] == artifact["html_bytes"], "UI output bytes mismatch")
    require(ui_receipt["output"]["sha256"] == artifact["html_sha256"], "UI output digest mismatch")

    html = (output / artifact["html_path"]).read_bytes()
    for marker in (b"graph-container", b"type=\"importmap\"", b"semantic:authoring/index.js"):
        require(marker in html, f"HTML runtime marker missing: {marker!r}")

    current = {
        "schema": "ops.selectedUniverseSemanticMapCurrent/1",
        "status": "PASS",
        "claim_ceiling": source["claim_ceiling"],
        "authority": False,
        "meaning": {
            **{key: meaning[key] for key in ("repository", "commit", "tree", "path", "blob_sha1", "bytes", "sha256", "content_type")},
            "agent_route": "/ with Accept: application/x-ndjson",
        },
        "ui": source["ui_source"],
        "projection": {
            "profile_id": expected["profile_id"],
            "profile_sha256": artifact["profile_sha256"],
            "envelope_sha256": artifact["envelope_sha256"],
            "pattern": expected["pattern"],
            "map_id": expected["map_id"],
            "state_hash": expected["state_hash"],
            "region_count": expected["region_count"],
            "relation_count": expected["relation_count"],
        },
        "html": {
            "purpose": "visual-evaluation-only",
            "authority": False,
            "bytes": artifact["html_bytes"],
            "sha256": artifact["html_sha256"],
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
