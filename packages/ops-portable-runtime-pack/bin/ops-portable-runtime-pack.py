#!/usr/bin/env python3
"""Create and validate portable runtime handoff packs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class PortablePackError(Exception):
    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PortablePackError("invalid-json", f"{label} is not valid JSON: {path}: {exc}") from exc


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise PortablePackError("missing-required-input", f"{label} does not exist: {path}")
    return path


def require_dir(path: Path, label: str) -> Path:
    if not path.is_dir():
        raise PortablePackError("missing-required-input", f"{label} does not exist: {path}")
    return path


def run(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise PortablePackError("command-failed", f"command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr}")
    return proc


def relative_manifest(path: Path, root: Path) -> str:
    return str(path.relative_to(root))


def copy_one(src: Path, dst: Path, root: Path, executable: bool = False) -> dict[str, Any]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    if executable:
        dst.chmod(dst.stat().st_mode | 0o111)
    return {
        "path": relative_manifest(dst, root),
        "sourcePath": str(src),
        "sha256": sha256_file(dst),
        "bytes": dst.stat().st_size,
        "executable": os.access(dst, os.X_OK),
    }


def copy_tree(src: Path, dst: Path, root: Path) -> list[dict[str, Any]]:
    require_dir(src, "runtime directory")
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=True)
    files = []
    for path in sorted(dst.rglob("*")):
        if path.is_file():
            files.append({
                "path": relative_manifest(path, root),
                "sourcePath": str(src / path.relative_to(dst)),
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
                "executable": os.access(path, os.X_OK),
            })
    return files


def normalize_tool_spec(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and isinstance(value.get("tools"), list):
        tools = value["tools"]
    elif isinstance(value, list):
        tools = value
    else:
        raise PortablePackError("invalid-tool-spec", "tool spec must be an array or object with tools[]")
    normalized = []
    for row in tools:
        if not isinstance(row, dict):
            raise PortablePackError("invalid-tool-spec", "each tool spec must be an object")
        name = str(row.get("name", "")).strip()
        source = str(row.get("source", "")).strip()
        if not name or "/" in name:
            raise PortablePackError("invalid-tool-spec", f"invalid tool name: {name}")
        if not source:
            raise PortablePackError("invalid-tool-spec", f"{name} needs source")
        normalized.append(row)
    return normalized


def make_wrapper(tool: dict[str, Any], out_dir: Path) -> str:
    name = tool["name"]
    real_name = f"{name}.real"
    env_rows = tool.get("env", {})
    if not isinstance(env_rows, dict):
        raise PortablePackError("invalid-tool-spec", f"{name} env must be an object")
    lines = [
        "#!/bin/sh",
        "set -eu",
        'ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
    ]
    for key, value in sorted(env_rows.items()):
        if not key.replace("_", "").isalnum():
            raise PortablePackError("invalid-tool-spec", f"{name} has invalid env key: {key}")
        lines.append(f'export {key}="{value}"')
    lines.append(f'exec "$ROOT/bin/{real_name}" "$@"')
    wrapper = out_dir / "bin" / name
    write_text(wrapper, "\n".join(lines) + "\n")
    wrapper.chmod(0o755)
    return relative_manifest(wrapper, out_dir)


def create_pack(args: argparse.Namespace) -> dict[str, Any]:
    if args.target_system != "x86_64-linux":
        raise PortablePackError("unsupported-target-system", f"unsupported target system: {args.target_system}")
    spec_path = require_file(Path(args.tool_spec), "tool spec")
    tools = normalize_tool_spec(load_json(spec_path, "tool spec"))
    out_dir = Path(args.out_dir)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    copied_files: list[dict[str, Any]] = []
    manifest_tools = []
    for tool in tools:
        name = tool["name"]
        source = require_file(Path(tool["source"]), f"{name} source executable")
        real_path = out_dir / "bin" / f"{name}.real"
        copied_files.append(copy_one(source, real_path, out_dir, executable=True))
        wrapper_path = make_wrapper(tool, out_dir)
        copied_files.append({
            "path": wrapper_path,
            "sourcePath": None,
            "sha256": sha256_file(out_dir / wrapper_path),
            "bytes": (out_dir / wrapper_path).stat().st_size,
            "executable": True,
        })
        for extra in tool.get("files", []):
            src = require_file(Path(extra["source"]), f"{name} runtime file")
            dst = out_dir / str(extra["path"])
            copied_files.append(copy_one(src, dst, out_dir))
        for extra in tool.get("directories", []):
            src = require_dir(Path(extra["source"]), f"{name} runtime directory")
            dst = out_dir / str(extra["path"])
            copied_files.extend(copy_tree(src, dst, out_dir))
        manifest_tools.append({
            "name": name,
            "source": str(source),
            "wrapper": wrapper_path,
            "realExecutable": f"bin/{name}.real",
            "env": tool.get("env", {}),
            "smoke": tool.get("smoke", []),
        })

    checks = []
    env = os.environ.copy()
    env["PATH"] = f"{out_dir / 'bin'}:{env.get('PATH', '')}"
    for tool in manifest_tools:
        smoke = tool.get("smoke") or []
        if not smoke:
            continue
        proc = run([str(out_dir / "bin" / tool["name"]), *[str(x) for x in smoke]], out_dir, env=env)
        checks.append({
            "tool": tool["name"],
            "command": [tool["name"], *[str(x) for x in smoke]],
            "returncode": proc.returncode,
            "stdoutSha256": hashlib.sha256(proc.stdout.encode("utf-8")).hexdigest(),
            "stderrSha256": hashlib.sha256(proc.stderr.encode("utf-8")).hexdigest(),
        })

    manifest = {
        "kind": "ops.portable-runtime-pack.v1",
        "createdAt": now_iso(),
        "targetSystem": args.target_system,
        "toolSpec": {"path": str(spec_path), "sha256": sha256_file(spec_path)},
        "tools": manifest_tools,
        "files": copied_files,
        "checks": checks,
        "authorityFlags": {
            "semanticApproval": False,
            "completionApproval": False,
            "mergeApproval": False,
            "transport": False,
        },
        "status": "portable-runtime-pack-created",
    }
    write_json(out_dir / "MANIFEST.json", manifest)
    write_text(out_dir / "START_HERE.txt", "\n".join([
        "START_HERE: ops portable runtime pack",
        f"targetSystem: {args.target_system}",
        "Use ./bin/<tool> from this directory.",
        "Run: ops-portable-runtime-pack validate --pack-dir <this-dir>",
        "This payload is not approval, merge, push, or completion.",
        "",
    ]))
    return {"status": "portable-runtime-pack-created", "packDir": str(out_dir), "manifest": str(out_dir / "MANIFEST.json")}


def validate_pack(args: argparse.Namespace) -> dict[str, Any]:
    pack_dir = Path(args.pack_dir)
    manifest_path = require_file(pack_dir / "MANIFEST.json", "MANIFEST.json")
    manifest = load_json(manifest_path, "MANIFEST.json")
    if manifest.get("kind") != "ops.portable-runtime-pack.v1":
        raise PortablePackError("invalid-manifest", "unsupported manifest kind")
    for row in manifest.get("files", []):
        rel = row.get("path")
        if not rel:
            raise PortablePackError("invalid-manifest", "file entry missing path")
        path = pack_dir / rel
        require_file(path, f"payload file {rel}")
        expected = row.get("sha256")
        actual = sha256_file(path)
        if expected != actual:
            raise PortablePackError("manifest-hash-mismatch", f"{rel} hash mismatch")
    require_file(pack_dir / "START_HERE.txt", "START_HERE.txt")
    return {"status": "portable-runtime-pack-valid", "packDir": str(pack_dir), "fileCount": len(manifest.get("files", []))}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ops-portable-runtime-pack")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--target-system", required=True)
    create.add_argument("--tool-spec", required=True)
    create.add_argument("--out-dir", required=True)
    create.set_defaults(func=create_pack)
    validate = sub.add_parser("validate")
    validate.add_argument("--pack-dir", required=True)
    validate.set_defaults(func=validate_pack)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.func(args)
    except PortablePackError as exc:
        print(json.dumps({"ok": False, "status": exc.status, "error": exc.message}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **result}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
