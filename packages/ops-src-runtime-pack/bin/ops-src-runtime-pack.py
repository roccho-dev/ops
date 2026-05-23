#!/usr/bin/env python3
"""Create and validate source/runtime handoff packs.

The tool owns payload creation only. It does not create ChatGPT threads, upload
Project Source files, approve work, merge, or push.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_DEPENDENCY_CLASSES = [
    "target package source",
    "dependent package metadata",
    "dependent source refs",
    "Nix runtime metadata",
    "execution environment metadata",
    "policy inputs",
    "role catalog",
    "organization topology",
    "command board",
    "source manifest",
    "runtime manifest",
    "payload manifest",
]


class PackError(Exception):
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


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run(cmd: list[str], cwd: Path, log_path: Path | None = None, allow_fail: bool = False) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if log_path:
        write_text(log_path, "$ " + " ".join(cmd) + "\n\nSTDOUT\n" + proc.stdout + "\nSTDERR\n" + proc.stderr)
    if proc.returncode != 0 and not allow_fail:
        raise PackError("command-failed", f"command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr}")
    return proc


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise PackError("missing-required-input", f"{label} does not exist: {path}")
    return path


def safe_policy_name(path: Path) -> str:
    digest = sha256_file(path)[:12]
    return f"{digest}-{path.name}"


def git_head(repo_root: Path) -> str | None:
    proc = run(["git", "rev-parse", "HEAD"], repo_root, allow_fail=True)
    return proc.stdout.strip() if proc.returncode == 0 else None


def git_status(repo_root: Path) -> str:
    proc = run(["git", "status", "--short"], repo_root, allow_fail=True)
    return proc.stdout


def git_files(repo_root: Path, include_untracked: bool) -> list[Path]:
    cmd = ["git", "ls-files", "-z", "--cached"]
    if include_untracked:
        cmd.extend(["--others", "--exclude-standard"])
    proc = run(cmd, repo_root, allow_fail=True)
    if proc.returncode != 0:
        raise PackError("git-files-failed", "source archive requires a Git working tree")
    return [repo_root / item for item in proc.stdout.split("\0") if item]


def create_source_archive(repo_root: Path, out_path: Path, exclude_root: Path, include_untracked: bool) -> dict[str, Any]:
    files = []
    exclude_root = exclude_root.resolve()
    for path in git_files(repo_root, include_untracked):
        resolved = path.resolve()
        if resolved == out_path.resolve() or exclude_root in resolved.parents or resolved == exclude_root:
            continue
        if ".git" in path.parts:
            continue
        files.append(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out_path, "w:gz") as tar:
        for path in sorted(files):
            tar.add(path, arcname=str(Path("src") / path.relative_to(repo_root)))
    return {
        "path": str(out_path),
        "sha256": sha256_file(out_path),
        "bytes": out_path.stat().st_size,
        "fileCount": len(files),
        "includeUntracked": include_untracked,
    }


def copy_policy_files(paths: list[str], out_dir: Path) -> list[dict[str, Any]]:
    copied = []
    files_dir = out_dir / "POLICY" / "files"
    for text in paths:
        src = require_file(Path(text), "policy file")
        dst = files_dir / safe_policy_name(src)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        copied.append({
            "sourcePath": str(src),
            "path": str(dst.relative_to(out_dir)),
            "sha256": sha256_file(dst),
            "bytes": dst.stat().st_size,
        })
    return copied


def maybe_copy_flake_lock(repo_root: Path, out_dir: Path) -> dict[str, Any]:
    src = repo_root / "flake.lock"
    if not src.is_file():
        return {"present": False, "path": None, "sha256": None, "bytes": 0}
    dst = out_dir / "NIX" / "flake.lock"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return {"present": True, "path": str(dst.relative_to(out_dir)), "sha256": sha256_file(dst), "bytes": dst.stat().st_size}


def realize_installables(repo_root: Path, installables: list[str], out_dir: Path, metadata_only: bool) -> list[dict[str, Any]]:
    results = []
    path_info_all = []
    build_log = out_dir / "GATES" / "nix-build.log"
    path_info_log = out_dir / "GATES" / "nix-path-info.log"
    for installable in installables:
        if metadata_only:
            results.append({"installable": installable, "metadataOnly": True})
            continue
        proc = run(["nix", "build", "--no-link", "--print-out-paths", "--no-write-lock-file", installable], repo_root, build_log)
        paths = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
        if not paths:
            raise PackError("nix-build-no-output", f"nix build produced no output for {installable}")
        info_proc = run(["nix", "path-info", "--json", "--closure-size", *paths], repo_root, path_info_log)
        path_info = json.loads(info_proc.stdout)
        path_info_all.extend(path_info)
        results.append({"installable": installable, "storePaths": paths, "pathInfo": path_info})
    write_json(out_dir / "NIX" / "path-info.json", path_info_all)
    return results


def copy_binary_cache(repo_root: Path, out_dir: Path, installables: list[dict[str, Any]], metadata_only: bool) -> dict[str, Any]:
    cache_dir = out_dir / "NIX" / "binary-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if metadata_only:
        return {"path": str(cache_dir.relative_to(out_dir)), "metadataOnly": True}
    store_paths = []
    for row in installables:
        store_paths.extend(row.get("storePaths", []))
    if not store_paths:
        raise PackError("missing-store-paths", "no store paths to copy into binary cache")
    run(["nix", "copy", "--to", f"file://{cache_dir}", *store_paths], repo_root, out_dir / "GATES" / "nix-copy.log")
    info = require_file(cache_dir / "nix-cache-info", "binary cache info")
    return {
        "path": str(cache_dir.relative_to(out_dir)),
        "nixCacheInfo": str(info.relative_to(out_dir)),
        "bytes": sum(p.stat().st_size for p in cache_dir.rglob("*") if p.is_file()),
    }


def flake_archive(repo_root: Path, out_dir: Path, metadata_only: bool) -> dict[str, Any]:
    target = out_dir / "NIX" / "flake-archive.json"
    if metadata_only:
        write_json(target, {"metadataOnly": True})
        return {"path": str(target.relative_to(out_dir)), "metadataOnly": True}
    proc = run(["nix", "flake", "archive", "--json", "--no-write-lock-file", str(repo_root)], repo_root, out_dir / "GATES" / "nix-flake-archive.log")
    write_text(target, proc.stdout)
    return {"path": str(target.relative_to(out_dir)), "sha256": sha256_file(target), "bytes": target.stat().st_size}


def make_start_here(manifest: dict[str, Any]) -> str:
    first_installable = manifest["installables"][0] if manifest["installables"] else {}
    first_path = ""
    if first_installable.get("storePaths"):
        first_path = first_installable["storePaths"][0]
    policy_first = manifest["policyInputs"][0]["sha256"] if manifest["policyInputs"] else ""
    return "\n".join([
        "START_HERE: ops src runtime handoff pack",
        f"packNonce: {manifest['packNonce']}",
        f"packageName: {manifest['packageName']}",
        f"repoId: {manifest['repo']['repoId']}",
        f"gitHead: {manifest['repo'].get('head') or 'unknown'}",
        f"installables count: {len(manifest['installables'])}",
        f"first installable: {first_installable.get('installable', '')}",
        f"first store path: {first_path}",
        f"nixVersion: {manifest['nix']['version']}",
        f"flakeLockPresent: {manifest['nix']['flakeLock']['present']}",
        f"includeUntracked: {manifest['source']['archive']['includeUntracked']}",
        f"binaryCache: {manifest['nix']['binaryCache']['path']}",
        f"sourceArchiveSha256: {manifest['source']['archive']['sha256']}",
        f"policyInputs count: {len(manifest['policyInputs'])}",
        f"firstPolicySha256: {policy_first}",
        f"requiredDependencyClasses count: {len(manifest['requiredDependencyClasses'])}",
        "readbackInstruction: return packNonce, packageName, first store path, firstPolicySha256, and requiredDependencyClasses count.",
        "",
    ])


def create(args: argparse.Namespace) -> dict[str, Any]:
    repo_root = Path(args.repo_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    if out_dir.exists():
        if not args.force:
            raise PackError("output-exists", f"output exists: {out_dir}")
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    if not args.installable:
        raise PackError("missing-required-input", "at least one --installable is required")

    source = create_source_archive(repo_root, out_dir / "SRC" / "source.tar.gz", out_dir, args.include_untracked)
    write_text(out_dir / "SRC" / "working-tree.diff", run(["git", "diff", "--binary", "HEAD"], repo_root, allow_fail=True).stdout)
    write_text(out_dir / "SRC" / "staged.diff", run(["git", "diff", "--binary", "--cached"], repo_root, allow_fail=True).stdout)
    flake_lock = maybe_copy_flake_lock(repo_root, out_dir)
    policy_inputs = copy_policy_files(args.policy_file or [], out_dir)
    installables = realize_installables(repo_root, args.installable, out_dir, args.metadata_only)
    binary_cache = copy_binary_cache(repo_root, out_dir, installables, args.metadata_only)
    archive = flake_archive(repo_root, out_dir, args.metadata_only)
    nix_version = run(["nix", "--version"], repo_root).stdout.strip()

    nonce_seed = "|".join([args.package_name, now_iso(), repo_root.as_posix(), ",".join(args.installable)])
    manifest = {
        "kind": "ops.srcRuntimePack.v1",
        "createdAt": now_iso(),
        "packageName": args.package_name,
        "packNonce": "src-runtime-pack-" + sha256_text(nonce_seed),
        "metadataOnly": bool(args.metadata_only),
        "repo": {
            "repoId": args.repo_id,
            "root": str(repo_root),
            "head": git_head(repo_root),
            "dirtyStatus": git_status(repo_root),
        },
        "source": {
            "archive": {
                "path": str(Path("SRC") / "source.tar.gz"),
                "sha256": source["sha256"],
                "bytes": source["bytes"],
                "fileCount": source["fileCount"],
                "includeUntracked": source["includeUntracked"],
            },
            "workingTreeDiff": "SRC/working-tree.diff",
            "stagedDiff": "SRC/staged.diff",
        },
        "nix": {
            "version": nix_version,
            "flakeLock": flake_lock,
            "flakeArchive": archive,
            "binaryCache": binary_cache,
            "pathInfo": "NIX/path-info.json",
        },
        "installables": installables,
        "policyInputs": policy_inputs,
        "requiredDependencyClasses": REQUIRED_DEPENDENCY_CLASSES,
        "projectSourceEntrypoint": "START_HERE.txt",
        "verifyCommand": "ops-src-runtime-pack validate --pack-dir .",
        "approvalBoundary": {
            "semanticApproval": False,
            "completionApproval": False,
            "routeDecision": False,
        },
    }
    write_json(out_dir / "MANIFEST.json", manifest)
    write_text(out_dir / "START_HERE.txt", make_start_here(manifest))
    write_text(out_dir / "README.md", "\n".join([
        f"# {args.package_name} source/runtime handoff pack",
        "",
        "Start with `START_HERE.txt`, then verify with:",
        "",
        "```sh",
        "ops-src-runtime-pack validate --pack-dir .",
        "```",
        "",
        "This pack is transport evidence, not semantic approval or completion approval.",
        "",
    ]))
    write_json(out_dir / "POLICY" / "policy-manifest.json", {"kind": "ops.policyInputs.v1", "items": policy_inputs})
    return {"ok": True, "status": "src-runtime-pack-created", "outDir": str(out_dir), "manifest": str(out_dir / "MANIFEST.json")}


def validate(args: argparse.Namespace) -> dict[str, Any]:
    pack_dir = Path(args.pack_dir).resolve()
    manifest_path = require_file(pack_dir / "MANIFEST.json", "manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    required = [
        "START_HERE.txt",
        "README.md",
        "SRC/source.tar.gz",
        "NIX/path-info.json",
        "POLICY/policy-manifest.json",
    ]
    for rel in required:
        require_file(pack_dir / rel, rel)
    archive = pack_dir / manifest["source"]["archive"]["path"]
    expected = manifest["source"]["archive"]["sha256"]
    actual = sha256_file(archive)
    if actual != expected:
        raise PackError("hash-mismatch", f"source archive hash mismatch: {actual} != {expected}")
    flake_lock = manifest.get("nix", {}).get("flakeLock", {})
    if flake_lock.get("present", bool(flake_lock.get("path"))):
        lock_path = flake_lock.get("path")
        if not lock_path:
            raise PackError("missing-flake-lock-path", "flake.lock is marked present but has no path")
        require_file(pack_dir / lock_path, "flake.lock")
    if not manifest.get("metadataOnly"):
        require_file(pack_dir / manifest["nix"]["binaryCache"]["nixCacheInfo"], "binary cache info")
    start = (pack_dir / "START_HERE.txt").read_text(encoding="utf-8")
    if manifest["packNonce"] not in start:
        raise PackError("missing-nonce", "START_HERE does not contain packNonce")
    return {
        "ok": True,
        "status": "src-runtime-pack-valid",
        "packDir": str(pack_dir),
        "packNonce": manifest["packNonce"],
        "metadataOnly": bool(manifest.get("metadataOnly")),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ops-src-runtime-pack")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create")
    p.add_argument("--repo-root", default=".")
    p.add_argument("--repo-id", default="ops")
    p.add_argument("--package-name", required=True)
    p.add_argument("--installable", action="append", default=[])
    p.add_argument("--policy-file", action="append", default=[])
    p.add_argument("--out-dir", required=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--metadata-only", action="store_true", help="skip nix build/copy; for static package checks only")
    p.add_argument("--include-untracked", action="store_true", help="include untracked non-ignored Git files in SRC/source.tar.gz")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=create)
    p = sub.add_parser("validate")
    p.add_argument("--pack-dir", required=True)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=validate)
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.func(args)
        print(json.dumps(result, indent=2, sort_keys=True) if args.json else result["status"])
        return 0
    except PackError as exc:
        result = {"ok": False, "status": exc.status, "error": exc.message}
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
