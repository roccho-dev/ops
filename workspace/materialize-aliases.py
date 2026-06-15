#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, pathlib, os, sys

def fail(message: str) -> None:
    raise SystemExit(f"workspace-aliases:error:{message}")

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Materialize canonical-core workspace aliases as relative symlinks.")
    ap.add_argument("--root", default=".", help="workspace root")
    ap.add_argument("--manifest", default="ops/workspace/aliases.v1.json")
    ap.add_argument("--check", action="store_true", help="only verify aliases; do not create")
    args = ap.parse_args(argv)
    root = pathlib.Path(args.root).resolve()
    manifest_path = root / args.manifest
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    for row in data.get("aliases", []):
        alias = root / row["alias"]
        target_rel = row["target"]
        target = root / target_rel
        if not target.exists():
            errors.append(f"missing target {target_rel} for alias {row['alias']}")
            continue
        if alias.exists() or alias.is_symlink():
            if not alias.is_symlink():
                errors.append(f"alias exists but is not symlink: {row['alias']}")
                continue
            actual = os.readlink(alias)
            if actual != target_rel:
                errors.append(f"alias target mismatch: {row['alias']} -> {actual}, expected {target_rel}")
            continue
        if args.check:
            errors.append(f"missing alias: {row['alias']} -> {target_rel}")
        else:
            alias.symlink_to(target_rel)
    for row in data.get("forbiddenAliases", []):
        alias = root / row["alias"]
        if alias.exists() or alias.is_symlink():
            errors.append(f"forbidden alias present: {row['alias']}: {row.get('reason','')}")
    if errors:
        for err in errors:
            print(err, file=sys.stderr)
        fail(f"{len(errors)} alias violation(s)")
    print(json.dumps({"kind":"canonicalCore.workspaceAliases.check.v1","status":"pass","aliases":len(data.get('aliases', [])),"forbidden":len(data.get('forbiddenAliases', []))}, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
