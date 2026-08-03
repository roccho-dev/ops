from __future__ import annotations

import os
import tempfile
from fnmatch import fnmatchcase
from pathlib import Path, PurePosixPath
from typing import Any

from .artifacts import index_entry
from .canonical import canonical_json, parse_json, sha256_text
from .declarations import EXECUTORS, NAME_RE, load_declarations
from .errors import DistRunnerError

INDEX_KIND = "ops.distIndex.entry.v1"
INDEX_KEYS = {"aliases", "artifact", "executor", "generatedIsAuthority", "kind", "manifestId", "name", "path"}
ARTIFACT_KEYS = {"bytes", "gitBlobSha1", "sha256"}


def _closed(value: dict[str, Any], expected: set[str], label: str) -> None:
    unknown = sorted(set(value) - expected)
    missing = sorted(expected - set(value))
    if unknown or missing:
        raise DistRunnerError("invalid-index-schema", f"{label} keys do not match schema", missing=missing, unknown=unknown)


def generate_index(repo_root: Path) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    root = repo_root.resolve()
    declarations = load_declarations(root)
    entries: list[dict[str, Any]] = []
    manifest_owners: dict[str, str] = {}
    for declaration in declarations:
        entry = index_entry(root, declaration, INDEX_KIND)
        existing = manifest_owners.get(entry["manifestId"])
        if existing is not None:
            raise DistRunnerError(
                "duplicate-manifest-id",
                f"manifest ID {entry['manifestId']!r} belongs to {existing} and {entry['name']}",
            )
        manifest_owners[entry["manifestId"]] = entry["name"]
        if declaration["indexed"]:
            entries.append(entry)
    entries.sort(key=lambda row: row["name"])
    text = "".join(canonical_json(entry) + "\n" for entry in entries)
    return text, entries, declarations


def write_index(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    text, entries, _ = generate_index(root)
    path = root / "dist/index.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        stream.write(text)
        temporary = Path(stream.name)
    os.replace(temporary, path)
    return {
        "bytes": len(text.encode("utf-8")),
        "entryCount": len(entries),
        "generatedIsAuthority": False,
        "kind": "ops.distIndex.write.v1",
        "ok": True,
        "path": "dist/index.jsonl",
        "sha256": sha256_text(text),
    }


def parse_index(text: str) -> list[dict[str, Any]]:
    if not isinstance(text, str):
        raise DistRunnerError("invalid-index-text", "index must be text")
    if "\r" in text or not text.endswith("\n") or text.endswith("\n\n"):
        raise DistRunnerError("non-canonical-index", "index must use LF and end with exactly one newline")
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(text[:-1].split("\n"), start=1):
        if not line:
            raise DistRunnerError("non-canonical-index", f"blank index line at {line_number}")
        value = parse_json(line, f"index line {line_number}")
        if not isinstance(value, dict):
            raise DistRunnerError("invalid-index-row", f"index line {line_number} must be an object")
        _closed(value, INDEX_KEYS, f"index line {line_number}")
        if value["kind"] != INDEX_KIND or value["generatedIsAuthority"] is not False:
            raise DistRunnerError("invalid-index-row", f"invalid kind or authority flag at line {line_number}")
        if not isinstance(value["name"], str) or not NAME_RE.fullmatch(value["name"]):
            raise DistRunnerError("invalid-index-row", f"invalid name at line {line_number}")
        if value["executor"] not in EXECUTORS:
            raise DistRunnerError("unsupported-executor", f"unsupported executor at line {line_number}")
        aliases = value["aliases"]
        if not isinstance(aliases, list) or any(not isinstance(alias, str) or not NAME_RE.fullmatch(alias) for alias in aliases):
            raise DistRunnerError("invalid-index-row", f"invalid aliases at line {line_number}")
        if aliases != sorted(set(aliases)):
            raise DistRunnerError("invalid-index-row", f"aliases are not canonical at line {line_number}")
        path_value = value["path"]
        if not isinstance(path_value, str) or "\\" in path_value:
            raise DistRunnerError("invalid-index-row", f"invalid path at line {line_number}")
        parsed_path = PurePosixPath(path_value)
        if (
            str(parsed_path) != path_value
            or parsed_path.is_absolute()
            or ".." in parsed_path.parts
            or len(parsed_path.parts) < 3
            or parsed_path.parts[0] != "dist"
        ):
            raise DistRunnerError("invalid-index-row", f"unsafe path at line {line_number}")
        suffix = Path(path_value).suffix
        if value["executor"] == "python-zipapp" and suffix != ".pyz":
            raise DistRunnerError("executor-path-mismatch", f"python-zipapp requires .pyz at line {line_number}")
        if value["executor"] in {"node-esm", "browser-esm"} and suffix != ".mjs":
            raise DistRunnerError("executor-path-mismatch", f"{value['executor']} requires .mjs at line {line_number}")
        if not isinstance(value["manifestId"], str) or not value["manifestId"]:
            raise DistRunnerError("invalid-index-row", f"invalid manifestId at line {line_number}")
        artifact = value["artifact"]
        if not isinstance(artifact, dict):
            raise DistRunnerError("invalid-index-row", f"artifact must be an object at line {line_number}")
        _closed(artifact, ARTIFACT_KEYS, f"index line {line_number}.artifact")
        if not isinstance(artifact["bytes"], int) or isinstance(artifact["bytes"], bool) or artifact["bytes"] < 0:
            raise DistRunnerError("invalid-index-row", f"invalid byte count at line {line_number}")
        for key, length in [("gitBlobSha1", 40), ("sha256", 64)]:
            digest = artifact[key]
            if not isinstance(digest, str) or len(digest) != length or any(char not in "0123456789abcdef" for char in digest):
                raise DistRunnerError("invalid-index-row", f"invalid {key} at line {line_number}")
        if canonical_json(value) != line:
            raise DistRunnerError("non-canonical-index", f"index line {line_number} is not canonical")
        rows.append(value)
    if not rows:
        raise DistRunnerError("empty-index", "index contains no entries")
    if [row["name"] for row in rows] != sorted(row["name"] for row in rows):
        raise DistRunnerError("non-canonical-index", "index rows are not sorted by name")
    tokens: dict[str, str] = {}
    paths: set[str] = set()
    manifests: set[str] = set()
    for row in rows:
        if row["path"] in paths:
            raise DistRunnerError("duplicate-artifact-path", f"duplicate path in index: {row['path']}")
        if row["manifestId"] in manifests:
            raise DistRunnerError("duplicate-manifest-id", f"duplicate manifestId in index: {row['manifestId']}")
        paths.add(row["path"])
        manifests.add(row["manifestId"])
        for token in [row["name"], *row["aliases"]]:
            existing = tokens.get(token)
            if existing is not None:
                raise DistRunnerError("duplicate-search-token", f"index token {token!r} belongs to {existing} and {row['name']}")
            tokens[token] = row["name"]
    return rows


def resolve_entry(entries: list[dict[str, Any]], query: Any) -> dict[str, Any]:
    if not isinstance(query, str) or not query:
        raise DistRunnerError("invalid-query", "query must be a non-empty string")
    wildcard = any(character in query for character in "*?[")
    matches = [
        entry
        for entry in entries
        if any(fnmatchcase(token, query) if wildcard else token == query for token in [entry["name"], *entry["aliases"]])
    ]
    if not matches:
        raise DistRunnerError("feature-not-found", f"no indexed feature matches {query!r}")
    if len(matches) != 1:
        raise DistRunnerError("ambiguous-query", f"query {query!r} matched multiple features", matches=[row["name"] for row in matches])
    return matches[0]


def audit(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    expected_text, entries, declarations = generate_index(root)
    index_path = root / "dist/index.jsonl"
    if index_path.is_symlink():
        raise DistRunnerError("symlink-index-rejected", "dist/index.jsonl may not be a symlink")
    if not index_path.is_file():
        raise DistRunnerError("missing-index", "dist/index.jsonl is missing")
    actual_text = index_path.read_text(encoding="utf-8")
    parse_index(actual_text)
    symlinks = sorted(path.relative_to(root).as_posix() for path in (root / "dist").rglob("*") if path.is_symlink())
    if symlinks:
        raise DistRunnerError("symlink-dist-rejected", "dist tree may not contain symlinks", paths=symlinks)
    if actual_text != expected_text:
        raise DistRunnerError(
            "stale-index",
            "dist/index.jsonl differs from the generated projection",
            actualSha256=sha256_text(actual_text),
            expectedSha256=sha256_text(expected_text),
        )
    declared_paths = {row["path"] for row in declarations}
    executable_paths = {
        path.relative_to(root).as_posix()
        for path in (root / "dist").rglob("*")
        if path.is_file() and path.suffix in {".mjs", ".pyz"}
    }
    extra = sorted(executable_paths - declared_paths)
    missing = sorted(declared_paths - executable_paths)
    if extra or missing:
        raise DistRunnerError("dist-inventory-mismatch", "declared and present executable dist files differ", extra=extra, missing=missing)
    return {
        "declaredArtifactCount": len(declarations),
        "entryCount": len(entries),
        "generatedIsAuthority": False,
        "indexSha256": sha256_text(actual_text),
        "kind": "ops.distAudit.result.v1",
        "ok": True,
    }
