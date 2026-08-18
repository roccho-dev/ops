#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import re
import sys

HEX64 = re.compile(r"^[0-9a-f]{64}$")


def fail(code: str, message: str) -> None:
    raise SystemExit(json.dumps({
        "schema": "ops.selectedQueryFailure.v1",
        "status": "FAILED",
        "code": code,
        "message": message,
    }, sort_keys=True))


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_core(path: Path):
    spec = importlib.util.spec_from_file_location("ops_decision_selected_core", path)
    if spec is None or spec.loader is None:
        fail("CORE_LOAD", "cannot load selected query core")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def validated_manifest(projection: Path, expected_sha256: str):
    if not projection.is_dir():
        fail("PROJECTION_MISSING", str(projection))
    manifest_path = projection / "manifest.json"
    if not manifest_path.is_file():
        fail("MANIFEST_MISSING", str(manifest_path))
    if not HEX64.fullmatch(expected_sha256):
        fail("MANIFEST_SHA_FORMAT", expected_sha256)
    actual_manifest_sha = sha256_file(manifest_path)
    if actual_manifest_sha != expected_sha256:
        fail("MANIFEST_IDENTITY_MISMATCH", f"{actual_manifest_sha} != {expected_sha256}")

    manifest = read_json(manifest_path)
    if manifest.get("schema") != "ops.sqliteShardProjection.v1" or manifest.get("projectionKind") != "sqlite-shards":
        fail("PROJECTION_KIND", "selected query accepts SQLite shards only")

    asset_rows = manifest.get("assets")
    if not isinstance(asset_rows, list) or not asset_rows:
        fail("ASSET_MANIFEST_SHAPE", "assets must be a non-empty list")
    names = []
    expected = {}
    for row in asset_rows:
        if not isinstance(row, dict):
            fail("ASSET_MANIFEST_SHAPE", "asset row must be an object")
        name = row.get("name")
        size = row.get("bytes")
        asset_sha = row.get("sha256")
        if not isinstance(name, str) or Path(name).name != name or name in {".", ".."}:
            fail("ASSET_PATH_INVALID", str(name))
        if not name.endswith(".sqlite"):
            fail("ASSET_TYPE_INVALID", name)
        if not isinstance(size, int) or size < 0:
            fail("ASSET_BYTES_INVALID", name)
        if not isinstance(asset_sha, str) or not HEX64.fullmatch(asset_sha):
            fail("ASSET_SHA_INVALID", name)
        names.append(name)
        expected[name] = row
    if len(names) != len(set(names)):
        fail("ASSET_NAME_DUPLICATE", json.dumps(names, sort_keys=True))

    actual_entries = {entry.name for entry in projection.iterdir()}
    allowed_entries = set(expected) | {"manifest.json"}
    if actual_entries != allowed_entries:
        fail("ASSET_SET_MISMATCH", json.dumps({
            "expected": sorted(allowed_entries),
            "actual": sorted(actual_entries),
        }, sort_keys=True))

    for name, row in expected.items():
        path = projection / name
        if not path.is_file():
            fail("ASSET_NOT_FILE", name)
        if path.stat().st_size != row["bytes"] or sha256_file(path) != row["sha256"]:
            fail("ASSET_IDENTITY_MISMATCH", name)
    return manifest, actual_manifest_sha


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--projection", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--params-json", default="{}")
    args = parser.parse_args()

    projection = Path(args.projection).resolve()
    manifest, manifest_sha = validated_manifest(projection, args.manifest_sha256)
    try:
        params = json.loads(args.params_json)
    except json.JSONDecodeError as exc:
        fail("PARAMS_JSON", str(exc))
    if not isinstance(params, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in params.items()):
        fail("PARAMS_SHAPE", "params must be a string-to-string JSON object")

    core = load_core(Path(__file__).with_name("ops-decision-closure.py"))
    rows, metrics = core.query_sqlite(projection, args.query, params)
    result = {
        "schema": "ops.selectedSQLiteQueryResult.v1",
        "status": "PASS",
        "projectionKind": "sqlite-shards",
        "checkpointId": manifest["checkpointId"],
        "authorityRootDigest": manifest["authorityRootDigest"],
        "manifestSha256": manifest_sha,
        "queryId": args.query,
        "params": params,
        "rows": rows,
        "semanticDigest": hashlib.sha256(core.canonical(rows)).hexdigest(),
        "metrics": metrics,
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
