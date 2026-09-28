#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re
import sys
import tarfile


def fail(message: str) -> None:
    raise RuntimeError(f"mobile-agent-seq-ingress-v2: {message}")


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        fail("usage: reconstruct.py COMMENTS CONTRACT OUT OWNER")
    comments_path = pathlib.Path(argv[1])
    contract_path = pathlib.Path(argv[2])
    root = pathlib.Path(argv[3]).resolve()
    owner = argv[4]
    root.mkdir(parents=True, exist_ok=True)
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    comments = json.loads(comments_path.read_text(encoding="utf-8"))
    prefix = contract["transport"]["prefix"]
    total = int(contract["transport"]["chunks"])
    pattern = re.compile(rf"^{re.escape(prefix)} ([0-9]{{2}})/{total:02d}\n([A-Za-z0-9+/=]+)$")
    chunks: dict[int, str] = {}
    ids: dict[int, int] = {}
    for comment in comments:
        if comment.get("user", {}).get("login") != owner:
            continue
        body = (comment.get("body") or "").replace("\r\n", "\n").strip()
        match = pattern.fullmatch(body)
        if not match:
            continue
        index = int(match.group(1))
        if index in chunks:
            fail(f"duplicate chunk {index:02d}")
        chunks[index] = match.group(2)
        ids[index] = int(comment["id"])
    indexes = list(range(1, total + 1))
    if sorted(chunks) != indexes:
        fail(f"chunk set {sorted(chunks)} != {indexes}")
    encoded = "".join(chunks[index] for index in indexes).encode("ascii")
    expected_b64_bytes = int(contract["transport"]["base64Bytes"])
    expected_b64_sha = contract["transport"]["base64Sha256"]
    if len(encoded) != expected_b64_bytes:
        fail(f"base64 bytes {len(encoded)} != {expected_b64_bytes}")
    if sha256(encoded) != expected_b64_sha:
        fail(f"base64 sha {sha256(encoded)} != {expected_b64_sha}")
    archive = base64.b64decode(encoded, validate=True)
    expected_archive_bytes = int(contract["transport"]["archiveBytes"])
    expected_archive_sha = contract["transport"]["archiveSha256"]
    if len(archive) != expected_archive_bytes:
        fail(f"archive bytes {len(archive)} != {expected_archive_bytes}")
    if sha256(archive) != expected_archive_sha:
        fail(f"archive sha {sha256(archive)} != {expected_archive_sha}")
    archive_path = root / contract["transport"]["archiveName"]
    archive_path.write_bytes(archive)

    carrier = root / "carrier"
    carrier.mkdir()
    with tarfile.open(archive_path, mode="r:xz") as tf:
        members = tf.getmembers()
        for member in members:
            name = member.name[2:] if member.name.startswith("./") else member.name
            pure = pathlib.PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts:
                fail(f"unsafe archive path {member.name}")
            if not (member.isdir() or member.isfile()):
                fail(f"unsupported archive member {member.name}")
        tf.extractall(carrier, filter="data")

    manifest_path = carrier / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "mobile-agent-seq-carrier/2":
        fail("carrier schema")
    if manifest.get("authority") is not False or manifest.get("status") != "candidate":
        fail("carrier authority/status")
    runtime = manifest.get("runtime") or {}
    if runtime.get("preset") != contract["runtime"]["preset"]:
        fail("preset mismatch")
    if runtime.get("compiler") != contract["runtime"]["compiler"]:
        fail("compiler mismatch")
    if runtime.get("codec") != contract["runtime"]["codec"]:
        fail("codec mismatch")
    if manifest.get("boundary") != {
        "customSeqImplementation": False,
        "exampleHtmlIsProof": False,
        "publicChromeRequired": True,
        "sourceBuildRequired": False,
        "sourceCloneRequired": False,
    }:
        fail("boundary mismatch")
    listed = {row["path"]: row for row in manifest["files"]}
    actual = sorted(
        path.relative_to(carrier).as_posix()
        for path in carrier.rglob("*")
        if path.is_file() and path != manifest_path
    )
    if actual != sorted(listed):
        fail("carrier inventory mismatch")
    for relative, row in listed.items():
        data = (carrier / relative).read_bytes()
        if len(data) != int(row["bytes"]):
            fail(f"{relative}: bytes")
        if sha256(data) != row["sha256"]:
            fail(f"{relative}: sha")

    app = (carrier / contract["app"]["path"]).read_bytes()
    if len(app) != int(contract["app"]["bytes"]):
        fail("app bytes")
    if sha256(app) != contract["app"]["sha256"]:
        fail("app sha")
    text = app.decode("utf-8")
    for marker in ("seq/1", "maxgraph"):
        if marker.lower() not in text.lower():
            fail(f"missing app marker {marker}")
    fixture = (carrier / contract["runtime"]["fixture"]).read_bytes()
    if sha256(fixture) != contract["runtime"]["fixtureSha256"]:
        fail("fixture sha")

    receipt = {
        "schema": "ops.mobileAgentSeqTransportProof/2",
        "status": "PASS",
        "authority": False,
        "issue": contract["issue"],
        "commentIds": [ids[index] for index in indexes],
        "base64": {"bytes": len(encoded), "sha256": sha256(encoded)},
        "archive": {"name": archive_path.name, "bytes": len(archive), "sha256": sha256(archive)},
        "app": contract["app"],
        "files": len(listed),
        "sourceCloneUsed": False,
        "sourceBuildUsed": False,
        "customSeqImplementation": False,
    }
    (root / "transport-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "PASS", "chunks": total, "archiveBytes": len(archive), "files": len(listed)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
