"""Shared contracts and normalization for the world-core compatibility layer."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence

JSON_SEPARATORS = (",", ":")
ITEM_SCHEMA = "world.item/1"
CLAIM_SCHEMA = "world.claim/1"
MAPPING_SCHEMA = "world.mapping/1"
RELATION_SCHEMA = "world.relation/1"
IDENTITY_SCHEMA = "world.identity/1"
SCALE_SCHEMA = "world.scale/1"
UNIT_SCHEMA = "world.unit/1"
MAPPER_ID = "ops.fcc/1"
CORE_STATUS = {"active", "withdrawn"}
CLAIM_BASES = {"observed", "reported", "computed", "inferred", "assumed", "declared"}
CLAIM_MODES = {
    "actual", "possible", "expected", "required", "forbidden",
    "permitted", "desired", "recommended", "selected",
}
MAPPING_QUALITIES = {"semantic", "structural", "preserved"}
STREAMS = ("facts", "conditions", "claims")

RELATION_ALIASES = {
    "based_on": "depends_on",
    "evidenced_by": "depends_on",
    "grounded_in": "depends_on",
    "supported_by": "depends_on",
    "outcome_of": "result_of",
    "replaces": "supersedes",
    "refutes": "contradicts",
}

UNIT_ALIASES = {
    "%": "percent", "percent": "percent", "percentage": "percent",
    "jpy": "jpy", "円": "jpy",
    "jpy/year": "jpy_per_year", "jpy_per_year": "jpy_per_year",
    "円/年": "jpy_per_year", "円／年": "jpy_per_year",
    "year": "year", "years": "year", "年": "year",
    "count": "count", "件": "count",
}


class WorldError(RuntimeError):
    pass


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=JSON_SEPARATORS)


def digest_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def token(value: Any, fallback: str = "value") -> str:
    raw = unicodedata.normalize("NFKC", str(value)).strip()
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", raw)
    text = re.sub(r"[^0-9A-Za-z]+", "_", text).strip("_").lower()
    text = re.sub(r"_+", "_", text)
    return text or f"{fallback}_{digest_text(raw)[:8]}"


def canonical_relation(value: str) -> str:
    normalized = token(value, "relation")
    return RELATION_ALIASES.get(normalized, normalized)


def canonical_unit(value: Any) -> str:
    raw = unicodedata.normalize("NFKC", str(value)).strip()
    return UNIT_ALIASES.get(raw.lower(), UNIT_ALIASES.get(raw, token(raw, "unit")))


def item_id(domain: str, subject: str) -> str:
    identity = dumps({"domain": domain, "subject": subject})
    return f"item.topic.{token(subject, 'topic')}.{digest_text(identity)[:12]}"


def edge_id(source_id: str, position: int, relation: str, target: str) -> str:
    return f"claim.edge.{digest_text(dumps([source_id, position, relation, target]))[:24]}"


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.strip():
                continue
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise WorldError(f"{path}:{line_number}: malformed JSON: {exc.msg}") from exc
            if not isinstance(value, dict):
                raise WorldError(f"{path}:{line_number}: JSONL row must be an object")
            value = dict(value)
            value["__line__"] = line_number
            rows.append(value)
    return rows


def write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(dumps(row))
            handle.write("\n")


def source_origin(source: str, line: int, record_type: str) -> dict[str, Any]:
    return {
        "source": source,
        "line": line,
        "path": source,
        "schema": f"ops.{record_type}/1",
        "mapper": MAPPER_ID,
    }


def confidence_value(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        score = float(raw)
        if not 0 <= score <= 1:
            return {"scale": "confidence", "raw": raw, "data": {"invalid_score": True}}
        return {"scale": "confidence", "score": score, "raw": raw}
    return {"scale": "confidence", "level": str(raw), "raw": raw}


def semantic_class(record: Mapping[str, Any]) -> tuple[str, str]:
    record_type = record.get("record_type")
    subtype = record.get("subtype")
    role = record.get("role")
    legacy_mode = record.get("mode")
    if record_type == "fact":
        return "observed", "actual"
    if record_type == "condition":
        if subtype == "goal":
            return "declared", "desired"
        if subtype in {"constraint", "threshold", "freshness"}:
            return "declared", "required"
        return "declared", "actual"
    if record_type == "claim":
        if role == "decision":
            return "declared", "selected"
        if role == "proposal":
            return "declared", "recommended"
        if role == "rule":
            return "declared", "required"
        if role == "definition":
            return "declared", "actual"
        if legacy_mode == "calc":
            return "computed", "actual"
        if role == "derived" or legacy_mode == "judge":
            return "inferred", "actual"
        return "declared", "actual"
    raise WorldError(f"unsupported FCC record_type: {record_type!r}")


def claim_target(record: Mapping[str, Any]) -> dict[str, Any]:
    target: dict[str, Any] = {"value": record["value"]}
    if isinstance(record.get("unit"), str) and record["unit"].strip():
        target["unit"] = canonical_unit(record["unit"])
    if isinstance(record.get("scale"), str) and record["scale"].strip():
        target["scale"] = token(record["scale"], "scale")
    return target


def without_meta(record: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if key != "__line__"}


def require_keys(row: Mapping[str, Any], keys: Sequence[str], where: str) -> None:
    missing = [key for key in keys if key not in row]
    if missing:
        raise WorldError(f"{where}: missing keys: {', '.join(missing)}")


def plain_rows(path: Path) -> Iterator[tuple[int, dict[str, Any]]]:
    for row in load_jsonl(path):
        line = int(row.pop("__line__"))
        yield line, row
