#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import tarfile
from typing import Any

SHA256 = re.compile(r"^sha256:([0-9a-f]{64})$")
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
OCI_CONFIG = "application/vnd.oci.image.config.v1+json"
OCI_LAYERS = {
    "application/vnd.oci.image.layer.v1.tar",
    "application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.oci.image.layer.v1.tar+zstd",
    "application/vnd.oci.image.layer.nondistributable.v1.tar",
    "application/vnd.oci.image.layer.nondistributable.v1.tar+gzip",
    "application/vnd.oci.image.layer.nondistributable.v1.tar+zstd",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"verify-oci: {message}")


def load_archive(path: pathlib.Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    with tarfile.open(path, "r:*") as archive:
        for member in archive.getmembers():
            name = member.name.removeprefix("./")
            parts = pathlib.PurePosixPath(name).parts
            if not name or name.startswith("/") or any(part in {"", ".", ".."} for part in parts):
                fail(f"unsafe archive entry: {member.name!r}")
            if member.isdir():
                continue
            if not member.isfile():
                fail(f"non-regular archive entry: {member.name!r}")
            if name in files:
                fail(f"duplicate archive entry: {name}")
            stream = archive.extractfile(member)
            if stream is None:
                fail(f"unreadable archive entry: {name}")
            files[name] = stream.read()
    return files


def parse_json(files: dict[str, bytes], name: str) -> Any:
    if name not in files:
        fail(f"missing {name}")
    try:
        return json.loads(files[name])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON in {name}: {exc}")


def descriptor_blob(files: dict[str, bytes], descriptor: Any, role: str) -> tuple[str, bytes]:
    if not isinstance(descriptor, dict):
        fail(f"{role} descriptor is not an object")
    digest = descriptor.get("digest")
    size = descriptor.get("size")
    if not isinstance(digest, str) or not (match := SHA256.fullmatch(digest)):
        fail(f"invalid {role} digest: {digest!r}")
    if not isinstance(size, int) or size < 0:
        fail(f"invalid {role} size: {size!r}")
    hex_digest = match.group(1)
    blob_name = f"blobs/sha256/{hex_digest}"
    if blob_name not in files:
        fail(f"missing {role} blob: {blob_name}")
    blob = files[blob_name]
    if len(blob) != size:
        fail(f"{role} size mismatch: expected {size}, got {len(blob)}")
    if sha256(blob) != hex_digest:
        fail(f"{role} digest mismatch")
    return digest, blob


def verify(path: pathlib.Path, expected_revision: str | None) -> dict[str, Any]:
    archive_bytes = path.read_bytes()
    files = load_archive(path)

    layout = parse_json(files, "oci-layout")
    if layout != {"imageLayoutVersion": "1.0.0"}:
        fail(f"unsupported oci-layout: {layout!r}")

    index = parse_json(files, "index.json")
    if not isinstance(index, dict) or index.get("schemaVersion") != 2:
        fail("index schemaVersion must be 2")
    manifests = index.get("manifests")
    if not isinstance(manifests, list) or len(manifests) != 1:
        fail("index must contain exactly one manifest")

    manifest_descriptor = manifests[0]
    if manifest_descriptor.get("mediaType") != OCI_MANIFEST:
        fail(f"index descriptor is not an OCI image manifest: {manifest_descriptor.get('mediaType')!r}")
    manifest_digest, manifest_bytes = descriptor_blob(files, manifest_descriptor, "manifest")
    manifest = json.loads(manifest_bytes)
    if manifest.get("schemaVersion") != 2 or manifest.get("mediaType") != OCI_MANIFEST:
        fail("manifest schema/mediaType mismatch")

    config_descriptor = manifest.get("config")
    if not isinstance(config_descriptor, dict) or config_descriptor.get("mediaType") != OCI_CONFIG:
        fail("manifest config is not an OCI image config")
    config_digest, config_bytes = descriptor_blob(files, config_descriptor, "config")
    config = json.loads(config_bytes)

    if config.get("architecture") != "amd64" or config.get("os") != "linux":
        fail(f"unexpected image platform: {config.get('os')}/{config.get('architecture')}")

    runtime_config = config.get("config")
    if not isinstance(runtime_config, dict):
        fail("missing runtime config")
    command = runtime_config.get("Cmd")
    if not isinstance(command, list) or command[:2] != ["/bin/sh", "-c"] or len(command) != 3:
        fail(f"unexpected command: {command!r}")
    labels = runtime_config.get("Labels")
    if not isinstance(labels, dict):
        fail("missing OCI labels")
    revision = labels.get("org.opencontainers.image.revision")
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        fail(f"invalid revision label: {revision!r}")
    if expected_revision is not None and revision != expected_revision:
        fail(f"revision mismatch: expected {expected_revision}, got {revision}")

    layer_rows: list[dict[str, Any]] = []
    layers = manifest.get("layers")
    if not isinstance(layers, list) or not layers:
        fail("manifest contains no layers")
    for index_number, layer in enumerate(layers):
        if not isinstance(layer, dict) or layer.get("mediaType") not in OCI_LAYERS:
            fail(f"unsupported layer mediaType at {index_number}: {getattr(layer, 'get', lambda _k: None)('mediaType')!r}")
        digest, blob = descriptor_blob(files, layer, f"layer[{index_number}]")
        layer_rows.append(
            {
                "index": index_number,
                "digest": digest,
                "bytes": len(blob),
                "mediaType": layer["mediaType"],
            }
        )

    referenced = {
        "oci-layout",
        "index.json",
        f"blobs/sha256/{manifest_digest.removeprefix('sha256:')}",
        f"blobs/sha256/{config_digest.removeprefix('sha256:')}",
        *[f"blobs/sha256/{row['digest'].removeprefix('sha256:')}" for row in layer_rows],
    }
    unexpected_files = sorted(set(files) - referenced)
    if unexpected_files:
        fail(f"unexpected OCI files: {unexpected_files}")

    return {
        "schema": "ops-nixpkgs-oci-verification/1",
        "status": "PASS",
        "archive": {
            "name": path.name,
            "bytes": len(archive_bytes),
            "sha256": sha256(archive_bytes),
            "entries": len(files),
        },
        "layoutVersion": layout["imageLayoutVersion"],
        "indexSha256": sha256(files["index.json"]),
        "manifest": {
            "digest": manifest_digest,
            "bytes": len(manifest_bytes),
            "mediaType": OCI_MANIFEST,
        },
        "config": {
            "digest": config_digest,
            "bytes": len(config_bytes),
            "mediaType": OCI_CONFIG,
            "os": config["os"],
            "architecture": config["architecture"],
            "command": command,
            "labels": labels,
        },
        "layers": layer_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("--expect-revision")
    parser.add_argument("--receipt", type=pathlib.Path)
    args = parser.parse_args()

    result = verify(args.archive, args.expect_revision)
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.receipt is not None:
        args.receipt.write_text(encoded, encoding="utf-8")
    print(encoded, end="")


if __name__ == "__main__":
    main()
