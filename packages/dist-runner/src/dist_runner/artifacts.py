from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .canonical import git_blob_sha1, parse_json, sha256_bytes
from .errors import DistRunnerError

MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def _run(command: list[str], label: str, timeout: int = 30) -> str:
    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise DistRunnerError("manifest-timeout", f"{label} exceeded {timeout} seconds") from exc
    if len(completed.stdout) > MAX_OUTPUT_BYTES or len(completed.stderr) > MAX_OUTPUT_BYTES:
        raise DistRunnerError("manifest-output-too-large", f"{label} exceeded output limit")
    stdout = completed.stdout.decode("utf-8", errors="strict")
    stderr = completed.stderr.decode("utf-8", errors="replace")
    if completed.returncode != 0:
        raise DistRunnerError(
            "manifest-command-failed",
            f"{label} exited with {completed.returncode}",
            stderr=stderr[-4000:],
            stdout=stdout[-4000:],
        )
    return stdout


def artifact_path(repo_root: Path, relative_path: str) -> Path:
    root = repo_root.resolve()
    candidate = root / relative_path
    if candidate.is_symlink():
        raise DistRunnerError("symlink-artifact-rejected", f"artifact may not be a symlink: {relative_path}")
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise DistRunnerError("unsafe-artifact-path", f"artifact escapes repo: {relative_path}") from exc
    if not resolved.is_file():
        raise DistRunnerError("missing-artifact", f"artifact is missing: {relative_path}")
    return resolved


def identity(data: bytes) -> dict[str, Any]:
    return {"bytes": len(data), "gitBlobSha1": git_blob_sha1(data), "sha256": sha256_bytes(data)}


def read_manifest(path: Path, executor: str) -> dict[str, Any]:
    if executor == "python-zipapp":
        text = _run([sys.executable, str(path), "manifest"], f"manifest {path}")
    else:
        node = shutil.which("node")
        if node is None:
            raise DistRunnerError("missing-runtime-command", "node is required to inspect MJS manifests")
        harness = (
            "import {pathToFileURL} from 'node:url';\n"
            "const ns=await import(pathToFileURL(process.argv[2]).href+'?manifest=1');\n"
            "process.stdout.write(JSON.stringify(ns.manifest));\n"
        )
        with tempfile.TemporaryDirectory(prefix="dist-index-manifest-") as temp_dir:
            harness_path = Path(temp_dir) / "manifest.mjs"
            harness_path.write_text(harness, encoding="utf-8")
            text = _run([node, str(harness_path), str(path)], f"manifest {path}")
    value = parse_json(text.strip(), f"manifest {path}")
    if not isinstance(value, dict):
        raise DistRunnerError("invalid-artifact-manifest", f"manifest for {path} must be an object")
    manifest_id = value.get("id")
    if not isinstance(manifest_id, str) or not manifest_id:
        raise DistRunnerError("invalid-artifact-manifest", f"manifest for {path} requires id")
    if value.get("generatedIsAuthority") is True:
        raise DistRunnerError("authority-overclaim", f"manifest for {path} claims authority")
    entrypoints = value.get("entrypoints")
    if (
        not isinstance(entrypoints, list)
        or any(not isinstance(item, str) or not item for item in entrypoints)
        or len(entrypoints) != len(set(entrypoints))
        or "run" not in entrypoints
    ):
        raise DistRunnerError("invalid-artifact-manifest", f"manifest for {path} requires unique entrypoints including run")
    if value.get("externalDependencies") != []:
        raise DistRunnerError("external-dependencies-rejected", f"manifest for {path} must have no external dependencies")
    if value.get("sideAssets", []) != []:
        raise DistRunnerError("side-assets-rejected", f"manifest for {path} must have no side assets")
    runtime = value.get("runtime")
    if not isinstance(runtime, str) or not runtime:
        raise DistRunnerError("invalid-artifact-manifest", f"manifest for {path} requires runtime")
    lower = runtime.lower()
    compatible = (
        (executor == "python-zipapp" and lower.startswith("python"))
        or (executor == "node-esm" and "node" in lower)
        or (executor == "browser-esm" and "browser" in lower)
    )
    if not compatible:
        raise DistRunnerError("executor-runtime-mismatch", f"manifest runtime {runtime!r} is incompatible with {executor}")
    return value


def index_entry(repo_root: Path, declaration: dict[str, Any], kind: str) -> dict[str, Any]:
    path = artifact_path(repo_root, declaration["path"])
    data = path.read_bytes()
    if declaration["executor"] in {"node-esm", "browser-esm"}:
        try:
            data.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise DistRunnerError("invalid-utf8-artifact", f"MJS artifact is not UTF-8: {declaration['path']}") from exc
    manifest = read_manifest(path, declaration["executor"])
    return {
        "aliases": declaration["aliases"],
        "artifact": identity(data),
        "executor": declaration["executor"],
        "generatedIsAuthority": False,
        "kind": kind,
        "manifestId": manifest["id"],
        "name": declaration["name"],
        "path": declaration["path"],
    }
