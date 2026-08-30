#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import pathlib
import re
import shutil
import tarfile
from collections.abc import Iterator
from typing import Any

HEADER = re.compile(r"(?m)^[ \t]*SEQ-CARRIER-CHUNK/2[ \t]+(\d+)/(\d+)[ \t]*$")
BASE64_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
IGNORABLE_PAYLOAD_CHARS = frozenset(" \t\r\n`")
MIN_PAYLOAD_CHARS = 100


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_chunk(body: str) -> tuple[int, int, str] | None:
    normalized = body.replace("\r\n", "\n").replace("\r", "\n")
    for match in HEADER.finditer(normalized):
        payload_chars: list[str] = []
        started = False
        for character in normalized[match.end() :]:
            if character in BASE64_CHARS:
                payload_chars.append(character)
                started = True
                continue
            if character in IGNORABLE_PAYLOAD_CHARS:
                continue
            if started:
                break
        payload = "".join(payload_chars)
        if len(payload) < MIN_PAYLOAD_CHARS:
            continue
        if any(character not in BASE64_CHARS for character in payload):
            continue
        return int(match.group(1)), int(match.group(2)), payload
    return None


def iter_strings(value: Any, path: str = "$") -> Iterator[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
        return
    if isinstance(value, dict):
        for key, child in value.items():
            yield from iter_strings(child, f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_strings(child, f"{path}[{index}]")


def safe_extract(archive_path: pathlib.Path, destination: pathlib.Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    root = destination.resolve()
    with tarfile.open(archive_path, mode="r:xz") as archive:
        names: set[str] = set()
        members = archive.getmembers()
        for member in members:
            assert member.name not in names, f"duplicate archive path: {member.name}"
            names.add(member.name)
            assert member.isfile() or member.isdir(), f"entry type rejected: {member.name}"
            assert not member.issym() and not member.islnk(), f"link rejected: {member.name}"
            path = pathlib.PurePosixPath(member.name)
            assert not path.is_absolute(), f"absolute archive path: {member.name}"
            assert ".." not in path.parts, f"archive traversal: {member.name}"
            target = (root / member.name).resolve()
            assert target == root or root in target.parents, f"archive traversal: {member.name}"
        archive.extractall(root, members=members, filter="data")


def find_source_root(extracted: pathlib.Path) -> pathlib.Path:
    candidates: list[pathlib.Path] = []
    for path in [extracted, *sorted(candidate for candidate in extracted.iterdir() if candidate.is_dir())]:
        if (
            (path / "build.sh").is_file()
            and (path / "packages/pattern/view-types/registry.js").is_file()
            and (path / "packages/renderer-maxgraph/adapter.js").is_file()
            and (path / "packages/transport/smap-codec.js").is_file()
        ):
            candidates.append(path)
    assert len(candidates) == 1, candidates
    return candidates[0]


def absorb(
    *,
    body: str,
    evidence_row: dict[str, Any],
    parts: dict[int, str],
    evidence: dict[int, list[dict[str, Any]]],
) -> bool:
    parsed = parse_chunk(body)
    if parsed is None:
        return False
    index, total, payload = parsed
    assert total == 10, (index, total)
    assert 1 <= index <= total, (index, total)
    previous = parts.get(index)
    if previous is not None:
        assert previous == payload, f"carrier conflict at part {index}"
    parts[index] = payload
    row = {
        **evidence_row,
        "part": index,
        "payloadBytes": len(payload.encode("ascii")),
        "payloadSha256": sha256(payload.encode("ascii")),
    }
    if row not in evidence.setdefault(index, []):
        evidence[index].append(row)
    return True


def verify_source(
    root: pathlib.Path,
    *,
    original_commit: str,
    original_tree: str,
    bundle_sha256: str,
) -> dict[str, Any]:
    authority = json.loads((root / ".source-authority.json").read_text(encoding="utf-8"))
    manifest = json.loads((root / "source-manifest.json").read_text(encoding="utf-8"))
    assert authority["schema"] == "imported-source-authority/1"
    assert authority["provenance"]["sourceCommit"] == original_commit
    assert authority["provenance"]["sourceTree"] == original_tree
    assert authority["provenance"]["fullBundleSha256"] == "sha256:" + bundle_sha256
    assert authority["boundary"]["implementationRewritten"] is False
    assert authority["boundary"]["generatedDistIncluded"] is False
    assert manifest["schema"] == "mobile-agent-preset-source/1"
    assert manifest["provenance"]["commit"] == original_commit
    assert manifest["provenance"]["tree"] == original_tree

    listed = {row["path"]: row for row in manifest["files"]}
    excluded = {".source-authority.json", "source-manifest.json"}
    actual: list[str] = []
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        rel = path.relative_to(root).as_posix()
        if rel in excluded:
            continue
        assert rel in listed, rel
        data = path.read_bytes()
        row = listed[rel]
        assert len(data) == row["bytes"], rel
        assert sha256(data) == str(row["sha256"]).removeprefix("sha256:"), rel
        actual.append(rel)
    assert actual == sorted(listed)
    assert len(actual) == 657, len(actual)
    return {
        "listedFiles": len(actual),
        "sourceManifestSha256": sha256((root / "source-manifest.json").read_bytes()),
        "externalSourceCommit": original_commit,
        "externalSourceTree": original_tree,
        "externalFullBundleSha256": bundle_sha256,
    }


def scan_json_value(
    value: Any,
    *,
    source: str,
    metadata: dict[str, Any],
    parts: dict[int, str],
    evidence: dict[int, list[dict[str, Any]]],
) -> set[int]:
    matched: set[int] = set()
    for path, text in iter_strings(value):
        parsed = parse_chunk(text)
        if parsed is None:
            continue
        index, _, _ = parsed
        absorb(
            body=text,
            evidence_row={**metadata, "source": source, "field": path},
            parts=parts,
            evidence=evidence,
        )
        matched.add(index)
    return matched


def recover(args: argparse.Namespace) -> None:
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    parts: dict[int, str] = {}
    evidence: dict[int, list[dict[str, Any]]] = {}
    source_summary: dict[str, dict[str, Any]] = {}

    current = json.loads(args.comments.read_text(encoding="utf-8"))
    assert isinstance(current, list)
    current_parts: set[int] = set()
    for comment in current:
        if absorb(
            body=comment.get("body") or "",
            evidence_row={
                "source": "github-current",
                "commentId": comment.get("id"),
                "createdAt": comment.get("created_at"),
                "updatedAt": comment.get("updated_at"),
            },
            parts=parts,
            evidence=evidence,
        ):
            parsed = parse_chunk(comment.get("body") or "")
            assert parsed is not None
            current_parts.add(parsed[0])
    source_summary[args.comments.name] = {
        "kind": "github-current-comments",
        "records": len(current),
        "matchedParts": sorted(current_parts),
    }

    for json_path in sorted(args.json_sources or []):
        value = json.loads(json_path.read_text(encoding="utf-8"))
        matched = scan_json_value(
            value,
            source="github-json-history",
            metadata={"file": json_path.name},
            parts=parts,
            evidence=evidence,
        )
        source_summary[json_path.name] = {
            "kind": "github-json-history",
            "matchedParts": sorted(matched),
        }

    for archive_path in sorted(args.archives):
        matched_parts: set[int] = set()
        records = 0
        records_with_marker = 0
        with gzip.open(archive_path, "rt", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                records += 1
                if "SEQ-CARRIER-CHUNK/2" not in line:
                    continue
                records_with_marker += 1
                event = json.loads(line)
                matched_parts.update(
                    scan_json_value(
                        event,
                        source="gharchive",
                        metadata={
                            "archive": archive_path.name,
                            "line": line_number,
                            "eventId": event.get("id") if isinstance(event, dict) else None,
                            "eventType": event.get("type") if isinstance(event, dict) else None,
                            "eventCreatedAt": event.get("created_at") if isinstance(event, dict) else None,
                        },
                        parts=parts,
                        evidence=evidence,
                    )
                )
        source_summary[archive_path.name] = {
            "kind": "gharchive",
            "records": records,
            "recordsWithMarker": records_with_marker,
            "matchedParts": sorted(matched_parts),
        }

    diagnostic = {
        "schema": "ops.mobileAgentSourceCarrierRecoveryDiagnostic/2",
        "discoveredParts": sorted(parts),
        "missingParts": sorted(set(range(1, 11)) - set(parts)),
        "sources": source_summary,
        "evidence": {str(index): evidence[index] for index in sorted(evidence)},
    }
    (out / "recovery-diagnostic.json").write_text(
        json.dumps(diagnostic, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(diagnostic, ensure_ascii=False, sort_keys=True))

    assert sorted(parts) == list(range(1, 11)), sorted(parts)
    for historical_part in (4, 5):
        assert any(row["source"] != "github-current" for row in evidence[historical_part])

    carrier = "".join(parts[index] for index in range(1, 11))
    compressed = base64.b64decode(carrier, validate=True)
    carrier_path = out / "source.tar.xz.b64"
    archive_path = out / "source.tar.xz"
    carrier_path.write_text(carrier, encoding="ascii")
    archive_path.write_bytes(compressed)

    extracted = out / "extracted"
    safe_extract(archive_path, extracted)
    root = find_source_root(extracted)
    source = verify_source(
        root,
        original_commit=args.original_commit,
        original_tree=args.original_tree,
        bundle_sha256=args.bundle_sha256,
    )
    (out / "source-root").write_text(str(root) + "\n", encoding="utf-8")

    receipt = {
        "schema": "ops.mobileAgentExactSourceRecovery/1",
        "status": "PASS",
        "parts": {str(index): evidence[index] for index in range(1, 11)},
        "carrierBytes": len(carrier.encode("ascii")),
        "carrierSha256": sha256(carrier.encode("ascii")),
        "compressedBytes": len(compressed),
        "compressedSha256": sha256(compressed),
        **source,
    }
    (out / "recovery-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def verify_build(args: argparse.Namespace) -> None:
    root = args.root.resolve()
    expected = json.loads(args.expected.read_text(encoding="utf-8"))
    assert expected["schema"] == "semantic-map-build-artifact/1"
    assert len(expected["files"]) == 54
    dist = root / "dist"
    actual = sorted(path.relative_to(dist).as_posix() for path in dist.rglob("*") if path.is_file())
    assert actual == sorted(expected["files"])
    for rel, spec in expected["files"].items():
        data = (dist / rel).read_bytes()
        assert len(data) == spec["bytes"], rel
        assert sha256(data) == spec["sha256"], rel
    receipt = {
        "schema": "ops.mobileAgentExactSourceBuild/1",
        "status": "PASS",
        "files": len(actual),
        "appSha256": expected["files"]["app/index.html"]["sha256"],
    }
    args.receipt.write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def finalize(args: argparse.Namespace) -> None:
    recovery = json.loads((args.out / "recovery-receipt.json").read_text(encoding="utf-8"))
    build = json.loads((args.out / "build-receipt.json").read_text(encoding="utf-8"))
    receipt = {
        "schema": "ops.mobileAgentExactSourceIngress/1",
        "status": "PASS",
        "ref": args.ref,
        "commit": args.commit,
        "tree": args.tree,
        "recovery": recovery,
        "build": build,
        "implementationRewritten": False,
        "generatedDistCommitted": False,
    }
    (args.out / "ingress-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)

    recover_parser = commands.add_parser("recover")
    recover_parser.add_argument("--comments", required=True, type=pathlib.Path)
    recover_parser.add_argument("--archives", required=True, type=pathlib.Path, nargs="+")
    recover_parser.add_argument("--json-sources", type=pathlib.Path, nargs="*")
    recover_parser.add_argument("--out", required=True, type=pathlib.Path)
    recover_parser.add_argument("--original-commit", required=True)
    recover_parser.add_argument("--original-tree", required=True)
    recover_parser.add_argument("--bundle-sha256", required=True)
    recover_parser.set_defaults(handler=recover)

    build_parser = commands.add_parser("verify-build")
    build_parser.add_argument("--root", required=True, type=pathlib.Path)
    build_parser.add_argument("--expected", required=True, type=pathlib.Path)
    build_parser.add_argument("--receipt", required=True, type=pathlib.Path)
    build_parser.set_defaults(handler=verify_build)

    finalize_parser = commands.add_parser("finalize")
    finalize_parser.add_argument("--out", required=True, type=pathlib.Path)
    finalize_parser.add_argument("--ref", required=True)
    finalize_parser.add_argument("--commit", required=True)
    finalize_parser.add_argument("--tree", required=True)
    finalize_parser.set_defaults(handler=finalize)
    return root


def main() -> None:
    args = parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
