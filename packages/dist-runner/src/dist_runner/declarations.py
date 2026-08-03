from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Any

from .canonical import canonical_json, parse_json
from .errors import DistRunnerError

DECLARATION_KIND = "ops.distDeclaration.v1"
EXECUTORS = {"browser-esm", "node-esm", "python-zipapp"}
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TOP_KEYS = {"artifacts", "kind"}
ARTIFACT_KEYS = {"aliases", "executor", "indexed", "name", "path"}


def _closed(value: dict[str, Any], expected: set[str], label: str) -> None:
    unknown = sorted(set(value) - expected)
    missing = sorted(expected - set(value))
    if unknown or missing:
        raise DistRunnerError(
            "invalid-declaration-schema",
            f"{label} keys do not match the closed schema",
            missing=missing,
            unknown=unknown,
        )


def _name(value: Any, label: str) -> str:
    if not isinstance(value, str) or not NAME_RE.fullmatch(value):
        raise DistRunnerError("invalid-feature-name", f"{label} must match {NAME_RE.pattern}")
    return value


def _safe_path(value: Any, label: str, owner: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise DistRunnerError("invalid-artifact-path", f"{label} must be canonical POSIX text")
    path = PurePosixPath(value)
    if (
        str(path) != value
        or path.is_absolute()
        or ".." in path.parts
        or len(path.parts) < 3
        or path.parts[0] != "dist"
        or path.parts[1] != owner
    ):
        raise DistRunnerError("unsafe-artifact-path", f"{label} must stay below dist/{owner}/")
    return value


def load_declarations(repo_root: Path) -> list[dict[str, Any]]:
    root = repo_root.resolve()
    packages = root / "packages"
    if not packages.is_dir():
        raise DistRunnerError("missing-packages-root", "packages/ is missing")
    rows: list[dict[str, Any]] = []
    for declaration_path in sorted(packages.glob("*/dist.json")):
        if declaration_path.is_symlink():
            raise DistRunnerError(
                "symlink-declaration-rejected",
                f"distribution declaration may not be a symlink: {declaration_path}",
            )
        text = declaration_path.read_text(encoding="utf-8")
        value = parse_json(text, str(declaration_path))
        if not isinstance(value, dict):
            raise DistRunnerError("invalid-declaration", f"{declaration_path} must contain an object")
        if text != canonical_json(value) + "\n":
            raise DistRunnerError("non-canonical-declaration", f"{declaration_path} is not canonical JSON")
        _closed(value, TOP_KEYS, str(declaration_path))
        if value["kind"] != DECLARATION_KIND:
            raise DistRunnerError("invalid-declaration-kind", f"unsupported kind in {declaration_path}")
        artifacts = value["artifacts"]
        if not isinstance(artifacts, list) or not artifacts:
            raise DistRunnerError("invalid-declaration", f"{declaration_path}.artifacts must be non-empty")
        owner = declaration_path.parent.name
        for offset, artifact in enumerate(artifacts):
            label = f"{declaration_path}.artifacts[{offset}]"
            if not isinstance(artifact, dict):
                raise DistRunnerError("invalid-declaration", f"{label} must be an object")
            _closed(artifact, ARTIFACT_KEYS, label)
            name = _name(artifact["name"], f"{label}.name")
            aliases = artifact["aliases"]
            if not isinstance(aliases, list):
                raise DistRunnerError("invalid-aliases", f"{label}.aliases must be an array")
            normalized_aliases = sorted({_name(item, f"{label}.aliases") for item in aliases})
            if len(normalized_aliases) != len(aliases):
                raise DistRunnerError("duplicate-alias", f"{label}.aliases contains duplicates")
            executor = artifact["executor"]
            if executor not in EXECUTORS:
                raise DistRunnerError("unsupported-executor", f"unsupported executor: {executor}")
            indexed = artifact["indexed"]
            if not isinstance(indexed, bool):
                raise DistRunnerError("invalid-indexed", f"{label}.indexed must be boolean")
            path = _safe_path(artifact["path"], f"{label}.path", owner)
            suffix = Path(path).suffix
            if executor == "python-zipapp" and suffix != ".pyz":
                raise DistRunnerError("executor-path-mismatch", f"{executor} requires .pyz: {path}")
            if executor in {"node-esm", "browser-esm"} and suffix != ".mjs":
                raise DistRunnerError("executor-path-mismatch", f"{executor} requires .mjs: {path}")
            if not indexed and (
                owner != "dist-runner"
                or name != "dist-runner"
                or path != "dist/dist-runner/dist-runner.pyz"
                or normalized_aliases
            ):
                raise DistRunnerError(
                    "invalid-bootstrap-declaration",
                    "only dist-runner may be excluded from the index",
                )
            rows.append(
                {
                    "aliases": normalized_aliases,
                    "declarationPath": declaration_path.relative_to(root).as_posix(),
                    "executor": executor,
                    "indexed": indexed,
                    "name": name,
                    "owner": owner,
                    "path": path,
                }
            )
    if not rows:
        raise DistRunnerError("missing-declarations", "no packages/*/dist.json declarations found")

    names: set[str] = set()
    paths: set[str] = set()
    tokens: dict[str, str] = {}
    bootstrap_count = 0
    for row in rows:
        if row["name"] in names:
            raise DistRunnerError("duplicate-feature-name", f"duplicate feature name: {row['name']}")
        if row["path"] in paths:
            raise DistRunnerError("duplicate-artifact-path", f"duplicate artifact path: {row['path']}")
        names.add(row["name"])
        paths.add(row["path"])
        if not row["indexed"]:
            bootstrap_count += 1
            continue
        for token in [row["name"], *row["aliases"]]:
            existing = tokens.get(token)
            if existing is not None:
                raise DistRunnerError(
                    "duplicate-search-token",
                    f"search token {token!r} belongs to {existing} and {row['name']}",
                )
            tokens[token] = row["name"]
    if bootstrap_count != 1:
        raise DistRunnerError("invalid-bootstrap-count", "exactly one non-indexed dist-runner is required")
    return sorted(rows, key=lambda row: row["name"])
