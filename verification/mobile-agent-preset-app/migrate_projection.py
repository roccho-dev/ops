#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def fail(message: str) -> None:
    raise RuntimeError(f"mobile-agent-projection-migration: {message}")


def get(url: str) -> tuple[bytes, str] | None:
    last: Exception | None = None
    for attempt in range(1, 6):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "Accept-Encoding": "identity",
                    "Cache-Control": "no-cache",
                    "User-Agent": "ops-mobile-agent-projection-migration/1",
                },
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                if response.status != 200:
                    fail(f"{url}: HTTP {response.status}")
                return response.read(), response.geturl()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            last = error
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
        if attempt < 5:
            time.sleep(attempt)
    fail(f"{url}: {last}")


def required_path(relative: str) -> bool:
    return (
        relative == "app/index.html"
        or relative == "protocol/v3/codec.mjs"
        or relative.startswith("protocol/v3/modules/")
    )


def main(argv: list[str]) -> int:
    if len(argv) != 6:
        fail("usage: migrate_projection.py EXPECTED_PATHS SOURCE_BASE OUT MANIFEST RECEIPT")

    expected_path = pathlib.Path(argv[1])
    source_base = argv[2].rstrip("/") + "/"
    out = pathlib.Path(argv[3]).resolve()
    manifest_path = pathlib.Path(argv[4]).resolve()
    receipt_path = pathlib.Path(argv[5]).resolve()

    if out.exists():
        fail(f"output already exists: {out}")
    out.mkdir(parents=True)

    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    if expected.get("schema") != "semantic-map-build-artifact/1":
        fail("unexpected expected-path schema")
    paths = sorted(expected.get("files", {}))
    if len(paths) != 54:
        fail(f"expected exactly 54 candidate paths, got {len(paths)}")

    rows: list[dict[str, object]] = []
    omitted: list[str] = []
    for relative in paths:
        pure = pathlib.PurePosixPath(relative)
        if pure.is_absolute() or ".." in pure.parts:
            fail(f"unsafe path: {relative}")
        url = urllib.parse.urljoin(source_base, relative)
        first = get(url)
        if first is None:
            if required_path(relative):
                fail(f"required projection path is unavailable: {relative}")
            omitted.append(relative)
            continue
        second = get(url)
        if second is None:
            fail(f"projection path disappeared between reads: {relative}")
        first_bytes, first_url = first
        second_bytes, second_url = second
        if first_bytes != second_bytes:
            fail(f"non-deterministic public bytes: {relative}")
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(first_bytes)
        rows.append(
            {
                "path": relative,
                "bytes": len(first_bytes),
                "sha256": hashlib.sha256(first_bytes).hexdigest(),
                "sourceUrl": first_url,
                "secondSourceUrl": second_url,
            }
        )

    materialized_paths = sorted(str(row["path"]) for row in rows)
    actual = sorted(path.relative_to(out).as_posix() for path in out.rglob("*") if path.is_file())
    if actual != materialized_paths:
        fail("materialized inventory mismatch")
    for relative in paths:
        if required_path(relative) and relative not in materialized_paths:
            fail(f"required path missing after materialization: {relative}")

    app = (out / "app/index.html").read_bytes()
    lower = app.lower()
    for marker in (b"graph/1", b"map/1", b"seq/1", b"maxgraph"):
        if marker not in lower:
            fail(f"App marker missing: {marker.decode()}")

    canonical_rows = [
        {"path": row["path"], "bytes": row["bytes"], "sha256": row["sha256"]}
        for row in rows
    ]
    canonical = json.dumps(
        canonical_rows,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    tree_digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
    total_bytes = sum(int(row["bytes"]) for row in rows)

    manifest = {
        "schema": "ops.mobileAgentMigratedProjection/1",
        "authority": False,
        "sourceBase": source_base,
        "files": canonical_rows,
        "fileCount": len(rows),
        "candidateFileCount": len(paths),
        "omittedUnavailableNonRuntimePaths": omitted,
        "totalBytes": total_bytes,
        "distTreeDigest": tree_digest,
        "app": {
            "path": "app/index.html",
            "bytes": len(app),
            "sha256": "sha256:" + hashlib.sha256(app).hexdigest(),
        },
        "presets": ["graph/1", "map/1", "seq/1"],
        "renderer": "maxgraph",
        "implementationRewritten": False,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    receipt = {
        "schema": "ops.mobileAgentProjectionMigrationReceipt/1",
        "status": "PASS",
        "authority": False,
        "sourceBase": source_base,
        "fileCount": len(rows),
        "candidateFileCount": len(paths),
        "omittedUnavailableNonRuntimePaths": omitted,
        "totalBytes": total_bytes,
        "distTreeDigest": tree_digest,
        "app": manifest["app"],
        "observations": rows,
        "sourceCloneUsed": False,
        "sourceBuildUsed": False,
        "implementationRewritten": False,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(
        json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "status": "PASS",
        "fileCount": len(rows),
        "candidateFileCount": len(paths),
        "omittedUnavailableNonRuntimePaths": omitted,
        "totalBytes": total_bytes,
        "distTreeDigest": tree_digest,
        "app": manifest["app"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
