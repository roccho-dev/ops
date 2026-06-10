"""CLI adapter for the functional-core governance gate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .adapter import load_declared_core_texts, load_manifest
from .core import evaluate_manifest


def _check(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    root = Path(args.root) if args.root else None
    try:
        manifest = load_manifest(manifest_path)
        file_texts = load_declared_core_texts(manifest, manifest_path, root)
        result = evaluate_manifest(manifest, file_texts)
        result["manifestPath"] = str(manifest_path)
    except Exception as exc:  # adapter/reporting boundary
        result = {
            "ok": False,
            "classification": "functional-core-governance-fail",
            "semanticsProfile": "functional-core-governance-v1",
            "generatedIsAuthority": False,
            "diagnosticCount": 1,
            "diagnostics": [
                {
                    "kind": "adapter-error",
                    "path": str(manifest_path),
                    "rule": "explicit-inputs",
                    "message": str(exc),
                }
            ],
            "manifestPath": str(manifest_path),
        }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    else:
        print("PASS" if result["ok"] else "FAIL")
        for diagnostic in result.get("diagnostics", []):
            print(f"{diagnostic.get('kind')}: {diagnostic.get('path')}: {diagnostic.get('message')}")
    return 0 if result["ok"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="functional-core-governance-gate")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="validate one explicit functional-core manifest")
    check.add_argument("--manifest", required=True, help="path to functional-core-governance.manifest.v1 JSON")
    check.add_argument("--root", help="optional root used to resolve manifest core paths")
    check.add_argument("--json", action="store_true", help="emit JSON report")
    check.set_defaults(func=_check)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
