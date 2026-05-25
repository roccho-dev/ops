#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path


DECISION_FLAGS = {
    "semanticApproval": False,
    "completionApproval": False,
    "routeDecision": False,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def result(command: str, **extra):
    return {
        "kind": "ops.cdpProfileLifecycleResult.v1",
        "command": command,
        "createdAt": now_iso(),
        **DECISION_FLAGS,
        **extra,
    }


def write(value: dict) -> int:
    print(json.dumps(value, indent=2, sort_keys=True))
    return 0 if value.get("ok") else 1


def safe_path(raw: str) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p


def chmod_private(path: Path) -> None:
    try:
        os.chmod(path, stat.S_IRWXU)
    except OSError:
        pass


def copy_profile_tree(src: Path, dst: Path, replace: bool) -> None:
    if src.resolve() == dst.resolve():
        raise ValueError("source and destination must differ")
    if dst.exists():
        if not replace:
            raise FileExistsError(f"destination exists: {dst}")
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=False)
    chmod_private(dst)


def has_login_material(profile_dir: Path) -> bool:
    return (profile_dir / "Local State").exists() or (profile_dir / "Default").exists()


def cmd_seed(args: argparse.Namespace) -> int:
    profile_dir = safe_path(args.profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    chmod_private(profile_dir)
    marker = profile_dir / "OPS_CDP_PROFILE_LIFECYCLE.json"
    marker.write_text(json.dumps({
        "kind": "ops.cdpProfileLifecycleMarker.v1",
        "profileKind": "seed",
        "createdAt": now_iso(),
        "credentialCapture": False,
        "otpAutomation": False,
    }, indent=2, sort_keys=True) + "\n")
    return write(result(
        "chromium-cdp-profile-seed",
        ok=True,
        status="profile-seed-ready",
        profileDir=str(profile_dir),
        secretMaterialPrinted=False,
        nextCommand=[
            "HQ_CHROME_PROFILE_DIR=" + str(profile_dir),
            "chromium-cdp",
            "<target Project URL>",
        ],
    ))


def cmd_login_complete(args: argparse.Namespace) -> int:
    profile_dir = safe_path(args.profile_dir)
    ok = profile_dir.is_dir() and has_login_material(profile_dir)
    return write(result(
        "chromium-cdp-profile-login-complete",
        ok=ok,
        status="profile-login-complete-observed" if ok else "profile-login-not-detected",
        profileDir=str(profile_dir),
        observedFiles=[name for name in ["Local State", "Default"] if (profile_dir / name).exists()],
        credentialCapture=False,
        credentialReplay=False,
        otpAutomation=False,
        secretMaterialPrinted=False,
    ))


def cmd_publish(args: argparse.Namespace) -> int:
    profile_dir = safe_path(args.profile_dir)
    snapshot_dir = safe_path(args.snapshot_dir)
    if not args.allow_copy:
        return write(result(
            "chromium-cdp-profile-publish",
            ok=False,
            status="publish-not-authorized",
            reason="--allow-copy is required",
            profileDir=str(profile_dir),
            snapshotDir=str(snapshot_dir),
        ))
    if not profile_dir.is_dir():
        return write(result(
            "chromium-cdp-profile-publish",
            ok=False,
            status="profile-dir-missing",
            profileDir=str(profile_dir),
            snapshotDir=str(snapshot_dir),
        ))
    try:
        copy_profile_tree(profile_dir, snapshot_dir, replace=args.replace)
    except Exception as exc:
        return write(result(
            "chromium-cdp-profile-publish",
            ok=False,
            status="publish-copy-failed",
            reason=str(exc),
            profileDir=str(profile_dir),
            snapshotDir=str(snapshot_dir),
        ))
    return write(result(
        "chromium-cdp-profile-publish",
        ok=True,
        status="profile-snapshot-published",
        profileDir=str(profile_dir),
        snapshotDir=str(snapshot_dir),
        secretMaterialPrinted=False,
        runtimeCopyRequired=True,
    ))


def cmd_runtime_copy(args: argparse.Namespace) -> int:
    snapshot_dir = safe_path(args.snapshot_dir)
    runtime_dir = safe_path(args.runtime_dir)
    if not snapshot_dir.is_dir():
        return write(result(
            "chromium-cdp-profile-runtime-copy",
            ok=False,
            status="snapshot-dir-missing",
            snapshotDir=str(snapshot_dir),
            runtimeDir=str(runtime_dir),
        ))
    try:
        copy_profile_tree(snapshot_dir, runtime_dir, replace=args.replace)
    except Exception as exc:
        return write(result(
            "chromium-cdp-profile-runtime-copy",
            ok=False,
            status="runtime-copy-failed",
            reason=str(exc),
            snapshotDir=str(snapshot_dir),
            runtimeDir=str(runtime_dir),
        ))
    return write(result(
        "chromium-cdp-profile-runtime-copy",
        ok=True,
        status="runtime-profile-ready",
        snapshotDir=str(snapshot_dir),
        runtimeDir=str(runtime_dir),
        sourceMutated=False,
        secretMaterialPrinted=False,
        nextGate="project-transport-doctor --project-url <target Project URL>",
    ))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="profile-lifecycle")
    sub = p.add_subparsers(dest="command", required=True)

    seed = sub.add_parser("seed")
    seed.add_argument("--profile-dir", required=True)
    seed.set_defaults(func=cmd_seed)

    login = sub.add_parser("login-complete")
    login.add_argument("--profile-dir", required=True)
    login.set_defaults(func=cmd_login_complete)

    publish = sub.add_parser("publish")
    publish.add_argument("--profile-dir", required=True)
    publish.add_argument("--snapshot-dir", required=True)
    publish.add_argument("--allow-copy", action="store_true")
    publish.add_argument("--replace", action="store_true")
    publish.set_defaults(func=cmd_publish)

    runtime = sub.add_parser("runtime-copy")
    runtime.add_argument("--snapshot-dir", required=True)
    runtime.add_argument("--runtime-dir", required=True)
    runtime.add_argument("--replace", action="store_true")
    runtime.set_defaults(func=cmd_runtime_copy)

    return p


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
