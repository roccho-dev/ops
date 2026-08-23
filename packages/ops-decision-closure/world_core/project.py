"""Fact / Condition / Claim projection and exact reverse reconstruction."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Mapping

from .model import (
    CLAIM_SCHEMA,
    IDENTITY_SCHEMA,
    ITEM_SCHEMA,
    MAPPER_ID,
    MAPPING_SCHEMA,
    RELATION_SCHEMA,
    SCALE_SCHEMA,
    STREAMS,
    UNIT_SCHEMA,
    WorldError,
    canonical_relation,
    claim_target,
    confidence_value,
    digest_text,
    dumps,
    edge_id,
    item_id,
    load_jsonl,
    plain_rows,
    semantic_class,
    source_origin,
    without_meta,
    write_jsonl,
)


def project_fcc(inputs: Mapping[str, Path]) -> tuple[list[dict[str, Any]], ...]:
    items_by_id: dict[str, dict[str, Any]] = {}
    primary_claims: list[dict[str, Any]] = []
    edge_claims: list[dict[str, Any]] = []
    mappings: list[dict[str, Any]] = []
    relation_uses: dict[str, int] = defaultdict(int)
    relation_aliases: dict[str, set[str]] = defaultdict(set)
    identity_uses: dict[tuple[str, str], int] = defaultdict(int)
    unit_aliases: dict[str, set[str]] = defaultdict(set)
    confidence_levels: set[str] = set()
    source_ids: set[str] = set()

    for stream in STREAMS:
        path = inputs[stream]
        source = f"{stream}/{path.name}"
        expected_type = stream[:-1]
        for record in load_jsonl(path):
            line = int(record["__line__"])
            row = without_meta(record)
            if row.get("record_type") != expected_type:
                raise WorldError(
                    f"{path}:{line}: expected record_type={expected_type!r}, got {row.get('record_type')!r}"
                )
            required = ("id", "subject", "predicate", "value", "at", "rel")
            missing = [key for key in required if key not in row]
            if missing:
                raise WorldError(f"{path}:{line}: missing FCC keys: {', '.join(missing)}")
            for key in ("id", "subject", "predicate"):
                if not isinstance(row[key], str) or not row[key]:
                    raise WorldError(f"{path}:{line}: {key} must be a non-empty string")
            if row["id"] in source_ids:
                raise WorldError(f"{path}:{line}: duplicate FCC id {row['id']}")
            source_ids.add(row["id"])
            if not isinstance(row["rel"], list):
                raise WorldError(f"{path}:{line}: rel must be an array")

            domain = str(row.get("domain") or "")
            subject_id = item_id(domain, row["subject"])
            identity_uses[(domain, row["subject"])] += 1
            if subject_id not in items_by_id:
                items_by_id[subject_id] = {
                    "schema": ITEM_SCHEMA,
                    "id": subject_id,
                    "kind": "topic",
                    "name": row["subject"],
                    "recorded_at": row["at"],
                    "origin": source_origin(source, line, expected_type),
                    "status": "active",
                    "data": {
                        "identity": {
                            "kind": "topic",
                            "key": {"domain": domain, "subject": row["subject"]},
                            "rule": "exact",
                        },
                        "mapping_quality": "semantic",
                    },
                }

            basis, mode = semantic_class(row)
            raw_relation = row["predicate"]
            relation = canonical_relation(raw_relation)
            relation_uses[relation] += 1
            relation_aliases[relation].add(raw_relation)
            core_keys = {"id", "subject", "predicate", "value", "at", "rel", "record_type"}
            extra = {key: value for key, value in row.items() if key not in core_keys}
            claim: dict[str, Any] = {
                "schema": CLAIM_SCHEMA,
                "id": row["id"],
                "subject": subject_id,
                "relation": relation,
                "target": claim_target(row),
                "basis": basis,
                "mode": mode,
                "recorded_at": row["at"],
                "origin": source_origin(source, line, expected_type),
                "status": "active",
                "data": {
                    "mapping_quality": "semantic",
                    "legacy": {
                        "stream": stream,
                        "record_type": expected_type,
                        "predicate": raw_relation,
                        "subject": row["subject"],
                        "extra": extra,
                    },
                },
            }
            if row.get("domain") is not None:
                claim["scope"] = {"domain": row["domain"]}
            if isinstance(row.get("observed_at"), str):
                claim["time"] = {"observed_at": row["observed_at"]}
            if isinstance(row.get("negated"), bool):
                claim["negated"] = row["negated"]
            confidence = confidence_value(row.get("confidence"))
            if confidence is not None:
                claim["confidence"] = confidence
                if isinstance(confidence.get("level"), str):
                    confidence_levels.add(confidence["level"])
            if isinstance(row.get("unit"), str) and row["unit"].strip():
                unit_aliases[claim["target"]["unit"]].add(row["unit"])
            if isinstance(row.get("statement"), str):
                claim["text"] = row["statement"]
            elif isinstance(row.get("reason"), str):
                claim["text"] = row["reason"]
            primary_claims.append(claim)

            outputs = [subject_id, row["id"]]
            for position, edge in enumerate(row["rel"]):
                if not isinstance(edge, dict):
                    raise WorldError(f"{path}:{line}: rel[{position}] must be an object")
                edge_type = edge.get("type")
                target = edge.get("target")
                if not isinstance(edge_type, str) or not edge_type:
                    raise WorldError(f"{path}:{line}: rel[{position}].type must be a non-empty string")
                if not isinstance(target, str) or not target:
                    raise WorldError(f"{path}:{line}: rel[{position}].target must be a non-empty string")
                edge_relation = canonical_relation(edge_type)
                relation_uses[edge_relation] += 1
                relation_aliases[edge_relation].add(edge_type)
                edge_claim_id = edge_id(row["id"], position, edge_relation, target)
                edge_claims.append(
                    {
                        "schema": CLAIM_SCHEMA,
                        "id": edge_claim_id,
                        "subject": row["id"],
                        "relation": edge_relation,
                        "target": {"ref": target},
                        "basis": "declared",
                        "mode": "actual",
                        "recorded_at": row["at"],
                        "origin": source_origin(source, line, expected_type),
                        "status": "active",
                        "data": {
                            "mapping_quality": "semantic",
                            "legacy_edge": {
                                "source": row["id"],
                                "position": position,
                                "type": edge_type,
                            },
                        },
                    }
                )
                outputs.append(edge_claim_id)

            mappings.append(
                {
                    "schema": MAPPING_SCHEMA,
                    "id": f"mapping.{digest_text(dumps([source, line, row['id']]))[:24]}",
                    "source": source,
                    "line": line,
                    "mapper": MAPPER_ID,
                    "quality": "semantic",
                    "strategy": f"fcc_{expected_type}",
                    "outputs": outputs,
                    "kept": sorted(extra),
                    "source_sha256": digest_text(dumps(row)),
                }
            )

    inverse = {
        "depends_on": "supports", "supports": "depends_on",
        "result_of": "has_result", "has_result": "result_of",
        "supersedes": "superseded_by", "superseded_by": "supersedes",
    }
    relations: list[dict[str, Any]] = []
    for name in sorted(relation_uses):
        relation_row: dict[str, Any] = {
            "schema": RELATION_SCHEMA,
            "id": f"relation.{name}",
            "name": name,
            "aliases": sorted({name, *relation_aliases[name]}),
            "uses": relation_uses[name],
        }
        if name in inverse:
            relation_row["inverse"] = inverse[name]
        if name == "contradicts":
            relation_row["symmetric"] = True
        relations.append(relation_row)

    identities = [
        {
            "schema": IDENTITY_SCHEMA,
            "id": f"identity.{digest_text(dumps([domain, subject]))[:24]}",
            "kind": "topic",
            "key": {"domain": domain, "subject": subject},
            "item": item_id(domain, subject),
            "name": subject,
            "domain": domain,
            "uses": count,
            "rule": "exact",
        }
        for (domain, subject), count in sorted(identity_uses.items())
    ]
    default_levels = ["unknown", "low", "medium", "high", "verified"]
    levels = default_levels + sorted(confidence_levels - set(default_levels))
    scales = [
        {
            "schema": SCALE_SCHEMA,
            "id": "scale.confidence",
            "name": "confidence",
            "ordered": True,
            "values": [{"name": name, "rank": rank} for rank, name in enumerate(levels)],
        }
    ]
    units = [
        {
            "schema": UNIT_SCHEMA,
            "id": f"unit.{name}",
            "name": name,
            "aliases": sorted({name, *aliases}),
        }
        for name, aliases in sorted(unit_aliases.items())
    ]
    return (
        sorted(items_by_id.values(), key=lambda row: row["id"]),
        sorted(primary_claims + edge_claims, key=lambda row: row["id"]),
        sorted(mappings, key=lambda row: (row["source"], row["line"])),
        relations,
        identities,
        units,
        scales,
    )


def reconstruct_fcc(items_path: Path, claims_path: Path, out_dir: Path) -> dict[str, int]:
    item_names: dict[str, str] = {}
    for _, row in plain_rows(items_path):
        if row.get("schema") == ITEM_SCHEMA and isinstance(row.get("name"), str):
            item_names[row["id"]] = row["name"]

    primary: list[dict[str, Any]] = []
    edges_by_source: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for _, row in plain_rows(claims_path):
        data = row.get("data", {})
        if isinstance(data, dict) and "legacy_edge" in data:
            edge = data["legacy_edge"]
            edges_by_source[edge["source"]].append((int(edge["position"]), row))
        elif isinstance(data, dict) and "legacy" in data:
            primary.append(row)

    streams: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for claim in primary:
        legacy = claim["data"]["legacy"]
        record: dict[str, Any] = dict(legacy.get("extra", {}))
        record.update(
            {
                "at": claim["recorded_at"],
                "id": claim["id"],
                "predicate": legacy.get("predicate", claim["relation"]),
                "record_type": legacy["record_type"],
                "rel": [],
                "subject": legacy.get("subject", item_names.get(claim["subject"], claim["subject"])),
                "value": claim["target"].get("value"),
            }
        )
        for _, edge_claim in sorted(edges_by_source.get(claim["id"], []), key=lambda pair: pair[0]):
            edge_meta = edge_claim["data"]["legacy_edge"]
            record["rel"].append(
                {
                    "target": edge_claim["target"]["ref"],
                    "type": edge_meta.get("type", edge_claim["relation"]),
                }
            )
        streams[legacy["stream"]].append((int(claim["origin"]["line"]), record))

    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for stream in STREAMS:
        rows = [row for _, row in sorted(streams.get(stream, []), key=lambda pair: pair[0])]
        write_jsonl(out_dir / f"{stream}.jsonl", rows)
        counts[stream] = len(rows)
    return counts
