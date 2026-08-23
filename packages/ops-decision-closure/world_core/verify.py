"""Fail-closed verification for world records and bounded corpus proofs."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from .model import (
    CLAIM_BASES,
    CLAIM_MODES,
    CLAIM_SCHEMA,
    CORE_STATUS,
    ITEM_SCHEMA,
    MAPPING_QUALITIES,
    MAPPING_SCHEMA,
    RELATION_SCHEMA,
    WorldError,
    plain_rows,
    require_keys,
)


def verify_world(
    items_path: Path,
    claims_path: Path,
    mappings_path: Path,
    relations_path: Path,
) -> dict[str, Any]:
    items: dict[str, dict[str, Any]] = {}
    claims: dict[str, dict[str, Any]] = {}
    mappings: list[dict[str, Any]] = []
    relations: set[str] = set()

    for line, row in plain_rows(items_path):
        where = f"{items_path}:{line}"
        require_keys(row, ("schema", "id", "kind", "recorded_at", "origin", "status"), where)
        if row["schema"] != ITEM_SCHEMA:
            raise WorldError(f"{where}: schema must be {ITEM_SCHEMA}")
        if row["status"] not in CORE_STATUS:
            raise WorldError(f"{where}: invalid status {row['status']!r}")
        if row["id"] in items:
            raise WorldError(f"{where}: duplicate item id {row['id']}")
        items[row["id"]] = row

    for line, row in plain_rows(claims_path):
        where = f"{claims_path}:{line}"
        require_keys(
            row,
            ("schema", "id", "subject", "relation", "target", "basis", "mode", "recorded_at", "origin", "status"),
            where,
        )
        if row["schema"] != CLAIM_SCHEMA:
            raise WorldError(f"{where}: schema must be {CLAIM_SCHEMA}")
        if row["status"] not in CORE_STATUS:
            raise WorldError(f"{where}: invalid status {row['status']!r}")
        if row["basis"] not in CLAIM_BASES:
            raise WorldError(f"{where}: invalid basis {row['basis']!r}")
        if row["mode"] not in CLAIM_MODES:
            raise WorldError(f"{where}: invalid mode {row['mode']!r}")
        target = row["target"]
        if not isinstance(target, dict) or not any(key in target for key in ("ref", "value", "min", "max")):
            raise WorldError(f"{where}: target must contain ref, value, min, or max")
        if row["id"] in claims:
            raise WorldError(f"{where}: duplicate claim id {row['id']}")
        claims[row["id"]] = row

    for line, row in plain_rows(relations_path):
        where = f"{relations_path}:{line}"
        require_keys(row, ("schema", "id", "name", "aliases"), where)
        if row["schema"] != RELATION_SCHEMA:
            raise WorldError(f"{where}: schema must be {RELATION_SCHEMA}")
        if row["name"] in relations:
            raise WorldError(f"{where}: duplicate relation {row['name']}")
        relations.add(row["name"])

    all_ids = set(items) | set(claims)
    if len(all_ids) != len(items) + len(claims):
        overlap = sorted(set(items) & set(claims))
        raise WorldError(f"item/claim id collision: {overlap[:5]}")
    for claim in claims.values():
        if claim["subject"] not in all_ids:
            raise WorldError(f"claim {claim['id']}: unresolved subject {claim['subject']}")
        target_ref = claim["target"].get("ref")
        if target_ref is not None and target_ref not in all_ids:
            raise WorldError(f"claim {claim['id']}: unresolved target ref {target_ref}")
        if claim["relation"] not in relations:
            raise WorldError(f"claim {claim['id']}: unregistered relation {claim['relation']}")

    source_lines: set[tuple[str, int]] = set()
    output_count = 0
    quality_counts: dict[str, int] = defaultdict(int)
    for line, row in plain_rows(mappings_path):
        where = f"{mappings_path}:{line}"
        require_keys(row, ("schema", "id", "source", "line", "mapper", "quality", "outputs"), where)
        if row["schema"] != MAPPING_SCHEMA:
            raise WorldError(f"{where}: schema must be {MAPPING_SCHEMA}")
        if row["quality"] not in MAPPING_QUALITIES:
            raise WorldError(f"{where}: invalid mapping quality {row['quality']!r}")
        key = (str(row["source"]), int(row["line"]))
        if key in source_lines:
            raise WorldError(f"{where}: duplicate mapping source line {key}")
        source_lines.add(key)
        if not isinstance(row["outputs"], list) or not row["outputs"]:
            raise WorldError(f"{where}: outputs must be a non-empty array")
        for output in row["outputs"]:
            if output not in all_ids:
                raise WorldError(f"{where}: unresolved mapping output {output}")
            output_count += 1
        quality_counts[row["quality"]] += 1
        mappings.append(row)

    return {
        "status": "PASS",
        "items": len(items),
        "claims": len(claims),
        "mappings": len(mappings),
        "relations": len(relations),
        "mapping_quality": dict(sorted(quality_counts.items())),
        "mapped_outputs": output_count,
    }


def verify_proof(root: Path) -> dict[str, Any]:
    world = root / "world" if (root / "world").is_dir() else root
    result = verify_world(
        world / "normalized/items.jsonl",
        world / "normalized/claims.jsonl",
        world / "normalized/mappings.jsonl",
        world / "registries/relations.jsonl",
    )
    verification_path = world / "verification.json"
    if verification_path.exists():
        expected = json.loads(verification_path.read_text(encoding="utf-8"))
        counts = expected.get("counts", {})
        for key in ("items", "claims", "mappings", "relations"):
            expected_value = counts.get(key)
            if expected_value is not None and result[key] != expected_value:
                raise WorldError(f"proof count mismatch for {key}: {result[key]} != {expected_value}")
    result.update({"schema": "world.proof.verify/1", "proof_dir": root.as_posix()})
    return result
