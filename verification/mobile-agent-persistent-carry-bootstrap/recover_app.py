#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import zipfile

APP_BYTES = 2_412_388
APP_SHA256 = "3a8db8703aeb78ed2aded4292c554930daf16e6825dd1ccde83fd9bf680408d6"
MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
MAX_CANDIDATES = 60
MAX_DOWNLOAD_BYTES = 768 * 1024 * 1024


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def gh_json(endpoint: str):
    return json.loads(
        subprocess.check_output(
            ["gh", "api", "--paginate", "--slurp", endpoint],
            text=True,
        )
    )


def artifacts(repository: str) -> list[dict]:
    pages = gh_json(f"repos/{repository}/actions/artifacts?per_page=100")
    if pages and isinstance(pages[0], dict) and "artifacts" in pages[0]:
        rows = [artifact for page in pages for artifact in page.get("artifacts", [])]
    elif pages and isinstance(pages[0], dict) and "id" in pages[0]:
        rows = pages
    else:
        rows = []
    candidates = [
        row
        for row in rows
        if not row.get("expired", False)
        and "mobile-agent" in str(row.get("name", "")).lower()
        and 0 < int(row.get("size_in_bytes", 0)) <= MAX_ARTIFACT_BYTES
    ]
    candidates.sort(key=lambda row: (str(row.get("created_at", "")), int(row.get("id", 0))), reverse=True)
    return candidates[:MAX_CANDIDATES]


def download(repository: str, artifact_id: int, target: pathlib.Path) -> None:
    with target.open("wb") as handle:
        subprocess.run(
            ["gh", "api", f"repos/{repository}/actions/artifacts/{artifact_id}/zip"],
            check=True,
            stdout=handle,
        )


def safe_name(name: str) -> pathlib.PurePosixPath:
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeError(f"unsafe artifact path: {name}")
    return path


def exact_matches(archive: pathlib.Path) -> list[tuple[str, bytes]]:
    matches: list[tuple[str, bytes]] = []
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            if info.is_dir():
                continue
            safe_name(info.filename)
            if info.file_size != APP_BYTES:
                continue
            data = source.read(info)
            if len(data) == APP_BYTES and sha256(data) == APP_SHA256:
                matches.append((info.filename, data))
    return matches


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: recover_app.py OUT_HTML RECEIPT_JSON")
    repository = os.environ.get("GITHUB_REPOSITORY", "roccho-dev/ops")
    out = pathlib.Path(sys.argv[1])
    receipt_path = pathlib.Path(sys.argv[2])
    attempted: list[dict] = []
    downloaded = 0

    with tempfile.TemporaryDirectory(prefix="mobile-agent-artifacts-") as temp:
        root = pathlib.Path(temp)
        for row in artifacts(repository):
            size = int(row.get("size_in_bytes", 0))
            if downloaded + size > MAX_DOWNLOAD_BYTES:
                break
            artifact_id = int(row["id"])
            archive = root / f"{artifact_id}.zip"
            record = {
                "id": artifact_id,
                "name": row.get("name"),
                "size": size,
                "createdAt": row.get("created_at"),
                "updatedAt": row.get("updated_at"),
                "digest": row.get("digest"),
                "workflowRun": (row.get("workflow_run") or {}).get("id"),
            }
            try:
                download(repository, artifact_id, archive)
                downloaded += archive.stat().st_size
                matches = exact_matches(archive)
                record["downloadBytes"] = archive.stat().st_size
                record["exactMatches"] = [name for name, _ in matches]
                attempted.append(record)
                if len(matches) != 1:
                    continue
                source_path, app = matches[0]
                text = app.decode("utf-8", errors="strict")
                for token in ("graph/1", "map/1", "seq/1"):
                    if token not in text:
                        raise RuntimeError(f"App contract token missing: {token}")
                if "maxgraph" not in text.lower():
                    raise RuntimeError("maxGraph token missing")
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(app)
                receipt = {
                    "schema": "ops.mobileAgentArtifactRecovery/1",
                    "status": "PASS",
                    "repository": repository,
                    "artifact": record,
                    "sourcePath": source_path,
                    "app": {"bytes": len(app), "sha256": sha256(app)},
                    "attemptedArtifacts": attempted,
                    "downloadedBytes": downloaded,
                }
                receipt_path.parent.mkdir(parents=True, exist_ok=True)
                receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
                print(json.dumps(receipt, sort_keys=True))
                return
            except (subprocess.CalledProcessError, zipfile.BadZipFile, OSError, RuntimeError) as error:
                record["error"] = str(error)
                attempted.append(record)

    raise RuntimeError(
        "exact Mobile Agent App not found in retained artifacts: "
        + json.dumps(
            {
                "attempted": attempted,
                "candidateCount": len(artifacts(repository)),
                "downloadedBytes": downloaded,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
