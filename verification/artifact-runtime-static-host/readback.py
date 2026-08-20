#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path


def invariant(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(f"artifact-runtime-readback: {message}")


def validate_root(root_url: str, project: str) -> str:
    parsed = urllib.parse.urlsplit(root_url.rstrip("/"))
    invariant(not parsed.username and not parsed.password, "credentials are not allowed")
    invariant(not parsed.query and not parsed.fragment, "query and fragment are not allowed")
    invariant(parsed.hostname is not None, "hostname is required")
    if parsed.scheme == "http":
        invariant(os.environ.get("ALLOW_HTTP_LOCALHOST") == "1", "HTTP is disabled")
        invariant(parsed.hostname in {"127.0.0.1", "localhost"}, "HTTP is localhost-only")
    else:
        invariant(parsed.scheme == "https", "root URL must use HTTPS")
        expected = f"{project}.pages.dev"
        invariant(parsed.hostname == expected or parsed.hostname.endswith(f".{expected}"), "root host does not match project")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def curl_get(url: str, target: Path) -> bytes:
    command = [
        "curl",
        "--fail-with-body",
        "--location",
        "--retry", "6",
        "--retry-all-errors",
        "--retry-delay", "2",
        "--connect-timeout", "20",
        "--max-time", "120",
        "--silent",
        "--show-error",
        "--header", "Cache-Control: no-cache",
        "--header", "User-Agent: artifact-runtime-static-readback/2",
        "--output", str(target),
        url,
    ]
    subprocess.run(command, check=True)
    return target.read_bytes()


def main(argv: list[str]) -> int:
    invariant(len(argv) == 7, "expected local_root root_url tree_digest source_sha project receipt_path")
    local_root = Path(argv[1]).resolve()
    root = validate_root(argv[2], argv[5])
    tree_digest = argv[3]
    source_sha = argv[4]
    project = argv[5]
    receipt_path = Path(argv[6])
    invariant(local_root.is_dir(), "local root is missing")
    invariant(tree_digest.startswith("sha256:") and len(tree_digest) == 71, "tree digest is invalid")
    invariant(len(source_sha) == 40, "source SHA is invalid")
    tree_id = tree_digest.removeprefix("sha256:")
    invariant(root.endswith(f"/releases/{tree_id}") or os.environ.get("ALLOW_HTTP_LOCALHOST") == "1", "root path is not content-addressed")

    manifest_path = local_root / "artifact-manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    invariant(manifest["schema"] == "artifact-shell-publication-artifact/2", "manifest schema is unsupported")
    invariant(manifest["treeDigest"] == tree_digest, "manifest tree digest mismatch")
    canonical_files = json.dumps(manifest["files"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    invariant(f"sha256:{hashlib.sha256(canonical_files).hexdigest()}" == tree_digest, "recomputed tree digest mismatch")

    with tempfile.TemporaryDirectory(prefix="artifact-runtime-readback-") as temporary:
        remote_dir = Path(temporary)
        remote_manifest = curl_get(f"{root}/artifact-manifest.json", remote_dir / "artifact-manifest.json")
        invariant(remote_manifest == manifest_bytes, "public manifest bytes differ")
        checked = 0
        for item in manifest["files"]:
            encoded = urllib.parse.quote(item["path"], safe="/")
            data = curl_get(f"{root}/{encoded}", remote_dir / f"file-{checked}")
            invariant(len(data) == item["bytes"], f"byte length mismatch: {item['path']}")
            digest = f"sha256:{hashlib.sha256(data).hexdigest()}"
            invariant(digest == item["sha256"], f"SHA-256 mismatch: {item['path']}")
            checked += 1

    receipt = {
        "schema": "ops.artifactRuntimeStaticHostReceipt/1",
        "status": "PASS",
        "authority": False,
        "provider": "cloudflare-pages",
        "project": project,
        "opsCommit": source_sha,
        "deploymentUrl": root.split("/releases/", 1)[0],
        "rootUrl": root,
        "treeDigest": tree_digest,
        "listedFiles": checked,
        "allFileHashesVerified": True,
        "readbackTransport": "curl",
    }
    receipt_path.write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
