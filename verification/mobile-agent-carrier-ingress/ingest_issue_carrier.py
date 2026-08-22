#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re
import sys
import tarfile

EXPECTED_TOTAL = 32
EXPECTED_FULL_B64_BYTES = 571_088
EXPECTED_FULL_B64_SHA256 = "63e73cdbbe14a14ac01a013fe92feb5686e392333e696e0b3a850028604fea24"
EXPECTED_CARRIER_BYTES = 428_316
EXPECTED_CARRIER_SHA256 = "f0781226a3c302269a0507d3947867f8a5d2ef3a72ad1054454fed18598416ec"
EXPECTED_APP_BYTES = 2_412_388
EXPECTED_APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
EXPECTED_OWNER = "roccho-dev"
HEADER = re.compile(r"^MOBILE_AGENT_CARRIER_CHUNK/1 (\d{2})/(\d{2}) sha256=([0-9a-f]{64})$")
BASE64 = re.compile(r"^[A-Za-z0-9+/]*={0,2}$")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str) -> None:
    raise RuntimeError(f"mobile-agent-carrier-ingress: {message}")


def safe_extract(archive: pathlib.Path, target: pathlib.Path) -> None:
    with tarfile.open(archive, "r:xz") as tf:
        for member in tf.getmembers():
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts:
                fail(f"unsafe member path: {member.name}")
            if member.issym() or member.islnk() or member.isdev():
                fail(f"unsupported member type: {member.name}")
        tf.extractall(target, filter="data")


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        fail("usage: ingest_issue_carrier.py COMMENTS_JSON RESULT_DIR RECEIPT_JSON")
    comments_path = pathlib.Path(argv[1]).resolve()
    result = pathlib.Path(argv[2]).resolve()
    receipt_path = pathlib.Path(argv[3]).resolve()
    if result.exists():
        fail(f"result already exists: {result}")
    result.mkdir(parents=True)

    comments = json.loads(comments_path.read_text(encoding="utf-8"))
    if not isinstance(comments, list):
        fail("comments must be a JSON array")

    chunks: dict[int, dict[str, object]] = {}
    for comment in comments:
        if not isinstance(comment, dict):
            continue
        body = comment.get("body")
        if not isinstance(body, str):
            continue
        lines = body.splitlines()
        if not lines:
            continue
        match = HEADER.fullmatch(lines[0].strip())
        if not match:
            continue
        index, total, expected_chunk_sha = int(match.group(1)), int(match.group(2)), match.group(3)
        if total != EXPECTED_TOTAL:
            fail(f"chunk {index}: total {total}")
        user = comment.get("user") or {}
        if user.get("login") != EXPECTED_OWNER:
            fail(f"chunk {index}: unexpected author {user.get('login')}")
        association = comment.get("author_association")
        if association not in (None, "OWNER"):
            fail(f"chunk {index}: author association {association}")
        payload = "".join(line.strip() for line in lines[1:] if line.strip())
        if not payload or not BASE64.fullmatch(payload):
            fail(f"chunk {index}: invalid base64 alphabet")
        expected_length = 18_000 if index < EXPECTED_TOTAL else 13_088
        if len(payload) != expected_length:
            fail(f"chunk {index}: chars {len(payload)} != {expected_length}")
        observed_chunk_sha = sha256(payload.encode("ascii"))
        if observed_chunk_sha != expected_chunk_sha:
            fail(f"chunk {index}: sha {observed_chunk_sha} != {expected_chunk_sha}")
        if index in chunks:
            fail(f"duplicate chunk {index}")
        chunks[index] = {
            "commentId": comment.get("id"),
            "chars": len(payload),
            "sha256": "sha256:" + observed_chunk_sha,
            "payload": payload,
        }

    if sorted(chunks) != list(range(1, EXPECTED_TOTAL + 1)):
        fail(f"chunk set {sorted(chunks)}")
    full_text = "".join(str(chunks[index]["payload"]) for index in range(1, EXPECTED_TOTAL + 1))
    full_bytes = full_text.encode("ascii")
    if len(full_bytes) != EXPECTED_FULL_B64_BYTES:
        fail(f"combined base64 bytes {len(full_bytes)}")
    if sha256(full_bytes) != EXPECTED_FULL_B64_SHA256:
        fail(f"combined base64 sha {sha256(full_bytes)}")
    try:
        carrier = base64.b64decode(full_bytes, validate=True)
    except Exception as error:
        fail(f"base64 decode: {error}")
    if len(carrier) != EXPECTED_CARRIER_BYTES:
        fail(f"carrier bytes {len(carrier)}")
    if sha256(carrier) != EXPECTED_CARRIER_SHA256:
        fail(f"carrier sha {sha256(carrier)}")

    archive = result / f"mobile-agent-min-app-carrier.{EXPECTED_CARRIER_SHA256}.tar.xz"
    archive.write_bytes(carrier)
    carrier_root = result / "carrier"
    carrier_root.mkdir()
    safe_extract(archive, carrier_root)

    manifest_path = carrier_root / "carrier-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "mobile-agent-min-app-carrier/1":
        fail(f"manifest schema {manifest.get('schema')}")
    if manifest.get("runtime", {}).get("presets") != ["graph/1", "map/1", "seq/1"]:
        fail("preset registry closure")
    if manifest.get("runtime", {}).get("stableBase") != "https://stg-mobile-agent.pages.dev/":
        fail("stable base")
    boundary = manifest.get("boundary") or {}
    if boundary != {
        "customGraphMapSeqImplementation": False,
        "sourceBuildRequired": False,
        "sourceCloneRequired": False,
    }:
        fail(f"boundary {boundary}")

    listed = {row["path"]: row for row in manifest.get("files", [])}
    actual = sorted(path.relative_to(carrier_root).as_posix() for path in carrier_root.rglob("*") if path.is_file())
    if actual != sorted([*listed, "carrier-manifest.json"]):
        fail("carrier inventory mismatch")
    for rel, row in listed.items():
        path = carrier_root / rel
        data = path.read_bytes()
        if len(data) != row["bytes"]:
            fail(f"{rel}: bytes")
        if "sha256:" + sha256(data) != row["sha256"]:
            fail(f"{rel}: sha")
    app = carrier_root / manifest["app"]["path"]
    if app.stat().st_size != EXPECTED_APP_BYTES or sha256(app.read_bytes()) != EXPECTED_APP_SHA256:
        fail("App identity")

    receipt = {
        "schema": "ops.mobileAgentCarrierIssueIngress/1",
        "status": "PASS",
        "authority": False,
        "source": {"repository": "roccho-dev/ops", "issue": 279, "chunks": EXPECTED_TOTAL},
        "base64": {"bytes": len(full_bytes), "sha256": "sha256:" + sha256(full_bytes)},
        "carrier": {"path": archive.name, "bytes": len(carrier), "sha256": "sha256:" + sha256(carrier)},
        "app": manifest["app"],
        "presets": manifest["runtime"]["presets"],
        "files": len(actual),
        "chunks": [
            {key: value for key, value in chunks[index].items() if key != "payload"}
            | {"index": index, "total": EXPECTED_TOTAL}
            for index in range(1, EXPECTED_TOTAL + 1)
        ],
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "carrier": receipt["carrier"], "app": receipt["app"], "files": receipt["files"]}))


if __name__ == "__main__":
    main(sys.argv)
