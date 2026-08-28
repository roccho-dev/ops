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
from typing import Any

HEADER = re.compile(r"^SEQ-CARRIER-CHUNK/2\s+(\d+)/(\d+)\s*$")
BASE64_LINE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
MIN_PAYLOAD_CHARS = 4096


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_chunk(body: str) -> tuple[int, int, str] | None:
    normalized = body.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return None
    lines = normalized.split("\n")
    header_index = next(
        (index for index, line in enumerate(lines) if line.strip().startswith("SEQ-CARRIER-CHUNK/2")),
        None,
    )
    if header_index is None:
        return None
    match = HEADER.fullmatch(lines[header_index].strip())
    if match is None:
        return None

    groups: list[str] = []
    current: list[str] = []
    for raw_line in lines[header_index + 1 :]:
        line = raw_line.strip().strip("`").strip()
        if line and BASE64_LINE.fullmatch(line):
            current.append(line)
            continue
        if current:
            groups.append("".join(current))
            current = []
    if current:
        groups.append("".join(current))

    groups = [group for group in groups if len(group) >= MIN_PAYLOAD_CHARS]
    if not groups:
        return None
    payload = max(groups, key=len)
    assert groups.count(payload) == 1, f"ambiguous carrier payload: {lines[header_index]!r}"
    return int(match.group(1)), int(match.group(2)), payload


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
    previous = parts.get(index)
    if previous is not None:
        assert previous == payload, f"carrier conflict at part {index}"
    parts[index] = payload
    row = {**evidence_row, "part": index, "payloadBytes": len(payload.encode("ascii"))}
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


def recover(args: argparse.Namespace) -> None:
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    parts: dict[int, str] = {}
    evidence: dict[int, list[dict[str, Any]]] = {}
    archive_summary: dict[str, dict[str, Any]] = {}

    current = json.loads(args.comments.read_text(encoding="utf-8"))
    assert isinstance(current, list)
    for comment in current:
        absorb(
            body=comment.get("body") or "",
            evidence_row={
                "source": "github-current",
                "commentId": comment.get("id"),
                "createdAt": comment.get("created_at"),
                "updatedAt": comment.get("updated_at"),
            },
            parts=parts,
            evidence=evidence,
        )

    for archive_path in sorted(args.archives):
        action_counts: dict[str, int] = {}
        matched_parts: set[int] = set()
        matching_issue_events = 0
        with gzip.open(archive_path, "rt", encoding="utf-8") as stream:
            for line in stream:
                event = json.loads(line)
                if event.get("type") != "IssueCommentEvent":
                    continue
                if (event.get("repo") or {}).get("name") != "roccho-dev/ops":
                    continue
                payload = event.get("payload") or {}
                if int((payload.get("issue") or {}).get("number") or 0) != 286:
                    continue
                matching_issue_events += 1
                action = str(payload.get("action") or "unknown")
                action_counts[action] = action_counts.get(action, 0) + 1
                comment = payload.get("comment") or {}
                body = comment.get("body") or ""
                parsed = parse_chunk(body)
                if parsed is None:
                    continue
                index, _, _ = parsed
                matched_parts.add(index)
                absorb(
                    body=body,
                    evidence_row={
                        "source": "gharchive",
                        "archive": archive_path.name,
                        "eventId": event.get("id"),
                        "eventCreatedAt": event.get("created_at"),
                        "action": action,
                        "commentId": comment.get("id"),
                        "commentCreatedAt": comment.get("created_at"),
                        "commentUpdatedAt": comment.get("updated_at"),
                    },
                    parts=parts,
                    evidence=evidence,
                )
        archive_summary[archive_path.name] = {
            "matchingIssueEvents": matching_issue_events,
            "actions": action_counts,
            "matchedParts": sorted(matched_parts),
        }

    diagnostic = {
        "schema": "ops.mobileAgentSourceCarrierRecoveryDiagnostic/1",
        "discoveredParts": sorted(parts),
        "missingParts": sorted(set(range(1, 11)) - set(parts)),
        "archives": archive_summary,
        "evidence": {str(index): evidence[index] for index in sorted(evidence)},
    }
    (out / "recovery-diagnostic.json").write_text(
        json.dumps(diagnostic, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(diagnostic, ensure_ascii=False, sort_keys=True))

    assert sorted(parts) == list(range(1, 11)), sorted(parts)
    for missing_historical_part in (4, 5):
        assert any(row["source"] == "gharchive" for row in evidence[missing_historical_part])

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
