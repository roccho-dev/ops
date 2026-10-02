#!/usr/bin/env python3
"""Deterministically project package decision JSONL into Mobile Agent semantic views.

This is a non-authority candidate for roccho-dev/adrs#318. It does not reduce ADR
lifecycle or verify authority. Its input must already contain the effective package
responsibility/publication decisions selected by the upstream governance contract.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

INPUT_SCHEMA = "package-decision-event.sample/1"
SEMANTIC_SCHEMA = "semantic-map-state/1"
ROOT_ID = "package-decision-atlas"
ALLOWED_STATUSES = {"accepted", "proposed", "rejected", "revoked", "superseded", "conflict"}


class ContractError(ValueError):
    pass


def canonical_line(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def read_events(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ContractError(f"line {line_no}: invalid JSON") from exc
        if not isinstance(row, dict):
            raise ContractError(f"line {line_no}: record must be an object")
        if row.get("schema") != INPUT_SCHEMA or row.get("sample") is not True:
            raise ContractError(f"line {line_no}: only explicit sample input is accepted by this draft")
        event_id = row.get("id")
        package_id = row.get("subject", {}).get("package_id") if isinstance(row.get("subject"), dict) else None
        if not isinstance(event_id, str) or not event_id:
            raise ContractError(f"line {line_no}: id is required")
        if event_id in seen_ids:
            raise ContractError(f"line {line_no}: duplicate id {event_id}")
        seen_ids.add(event_id)
        if not isinstance(package_id, str) or not package_id:
            raise ContractError(f"line {line_no}: subject.package_id is required")
        if row.get("status") not in ALLOWED_STATUSES:
            raise ContractError(f"line {line_no}: unsupported status {row.get('status')!r}")
        if not isinstance(row.get("effective_at"), str) or not row["effective_at"]:
            raise ContractError(f"line {line_no}: effective_at is required")
        for relation in row.get("relations", []):
            if not isinstance(relation, dict) or not isinstance(relation.get("kind"), str) or not isinstance(relation.get("target"), str):
                raise ContractError(f"line {line_no}: invalid relation")
        rows.append(row)
    if not rows:
        raise ContractError("no decision events")
    return sorted(rows, key=lambda row: (row["effective_at"], row["id"]))


def group_events(events: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        grouped[event["subject"]["package_id"]].append(event)
    return {package_id: sorted(rows, key=lambda row: (row["effective_at"], row["id"])) for package_id, rows in sorted(grouped.items())}


def current_state(events: list[dict[str, Any]]) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    accepted = [row for row in events if row["status"] == "accepted"]
    proposed = [row for row in events if row["status"] == "proposed"]
    accepted_row = accepted[-1] if accepted else None
    proposed_row = proposed[-1] if proposed else None
    if accepted_row and proposed_row and proposed_row["effective_at"] > accepted_row["effective_at"]:
        return "accepted + pending", accepted_row, proposed_row
    if accepted_row:
        return "accepted", accepted_row, None
    latest = events[-1]
    return latest["status"], latest, None


def compact(values: list[str] | None) -> str:
    return " / ".join(values or ["—"])


def display_name(package_id: str) -> str:
    return package_id.removeprefix("pkg.").replace(".", "/")


def package_summary(package_id: str, status: str, current: dict[str, Any], pending: dict[str, Any] | None) -> str:
    pending_text = f" pending={pending['id']}" if pending else ""
    carrier = current.get("carrier", {}).get("repo", "—") if isinstance(current.get("carrier"), dict) else "—"
    return (
        f"stable_id={package_id}。carrier={carrier}。status={status}。"
        f"責務={current.get('responsibility', '—')} publishes={compact(current.get('publishes'))}。"
        f"current={current['id']}{pending_text}。"
    )


def event_summary(event: dict[str, Any]) -> str:
    return (
        f"status={event['status']}。責務={event.get('responsibility', '—')} "
        f"publishes={compact(event.get('publishes'))}。source={event.get('source_ref', '—')}"
    )


def base_records(title: str, summary: str, bounds: list[int]) -> list[dict[str, Any]]:
    return [
        {"type": "meta", "schema": SEMANTIC_SCHEMA, "root": ROOT_ID, "title": title},
        {
            "type": "region", "id": ROOT_ID, "parent": None, "label": title,
            "kind": "root", "bounds": bounds, "summary": summary,
        },
    ]


def package_relations(grouped: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    known = set(grouped)
    for package_id, events in grouped.items():
        _status, current, pending = current_state(events)
        source = pending or current
        for relation in sorted(source.get("relations", []), key=lambda row: (row["kind"], row["target"])):
            key = (package_id, relation["target"], relation["kind"])
            if key in seen:
                continue
            if relation["target"] not in known:
                raise ContractError(f"relation target not found: {relation['target']}")
            seen.add(key)
            rows.append({
                "type": "relation", "id": f"package-rel.{len(rows) + 1:03d}",
                "from": package_id, "to": relation["target"],
                "kind": relation["kind"], "label": relation["kind"],
            })
    return rows


def build_map(events: list[dict[str, Any]], title: str) -> list[dict[str, Any]]:
    grouped = group_events(events)
    domains = sorted({str((rows[-1].get("domain") or "other")) for rows in grouped.values()})
    width = max(1100, 120 + len(grouped) * 330)
    records = base_records(
        title,
        "package=責務・公開単位、carrier repo=現在位置、child=保留中decision。sampleでありauthorityではない。",
        [0, 0, width, 900],
    )
    domain_index = {name: index for index, name in enumerate(domains)}
    for index, domain in enumerate(domains):
        records.append({
            "type": "region", "id": f"domain.{domain}", "parent": ROOT_ID,
            "label": domain, "kind": "domain", "bounds": [30 + index * 340, 55, 310, 65],
            "summary": "repoではなく責務domain。repoはpackage属性として保持する。",
        })
    domain_counts: dict[str, int] = defaultdict(int)
    extra_relations: list[dict[str, Any]] = []
    event_position = {event["id"]: index for index, event in enumerate(events)}
    for package_id, package_events in grouped.items():
        status, current, pending = current_state(package_events)
        domain = str(current.get("domain") or "other")
        slot = domain_counts[domain]
        domain_counts[domain] += 1
        x = 45 + domain_index[domain] * 340
        y = 145 + slot * 260
        height = 225 if pending else 185
        records.append({
            "type": "region", "id": package_id, "parent": ROOT_ID,
            "label": f"{display_name(package_id)} · {status}", "kind": "package",
            "bounds": [x, y, 300, height], "summary": package_summary(package_id, status, current, pending),
        })
        if pending:
            for offset, event in enumerate((current, pending)):
                records.append({
                    "type": "region", "id": f"event.{event['id']}", "parent": package_id,
                    "label": f"{event['id']} · {event['status']}", "kind": "decision",
                    "bounds": [x + 15, y + 90 + offset * 58, 270, 48], "summary": event_summary(event),
                    "temporal": {"actor": package_id, "ordinal": {"start": event_position[event["id"]], "end": event_position[event["id"]]}},
                })
            extra_relations.append({
                "type": "relation", "id": f"pending.{pending['id']}",
                "from": f"event.{pending['id']}", "to": f"event.{current['id']}",
                "kind": "supersedes", "label": "supersedes",
            })
    records.extend(package_relations(grouped))
    records.extend(extra_relations)
    return records


def build_graph(events: list[dict[str, Any]], title: str) -> list[dict[str, Any]]:
    grouped = group_events(events)
    records = base_records(title + " / Relations", "package間の供給・依存・実行関係。", [0, 0, 1500, 900])
    for index, (package_id, package_events) in enumerate(grouped.items()):
        status, current, pending = current_state(package_events)
        records.append({
            "type": "region", "id": package_id, "parent": ROOT_ID,
            "label": f"{display_name(package_id)} · {status}", "kind": "package",
            "bounds": [70 + (index % 3) * 450, 100 + (index // 3) * 300, 340, 175],
            "summary": package_summary(package_id, status, current, pending),
        })
    records.extend(package_relations(grouped))
    return records


def build_history(events: list[dict[str, Any]], title: str) -> list[dict[str, Any]]:
    grouped = group_events(events)
    records = base_records(title + " / History", "package stable IDをlane、decision eventをordinal順に表示する。", [0, 0, 1900, 1200])
    relations: list[dict[str, Any]] = []
    event_position = {event["id"]: index for index, event in enumerate(events)}
    for package_index, (package_id, package_events) in enumerate(grouped.items()):
        status, current, pending = current_state(package_events)
        y = 80 + package_index * 145
        records.append({
            "type": "region", "id": package_id, "parent": ROOT_ID,
            "label": f"{display_name(package_id)} · {status}", "kind": "actor",
            "bounds": [25, y, 320, 90], "summary": package_summary(package_id, status, current, pending),
        })
        for event in package_events:
            ordinal = event_position[event["id"]]
            records.append({
                "type": "region", "id": f"event.{event['id']}", "parent": ROOT_ID,
                "label": f"{event['id']} · {event['status']}", "kind": "decision",
                "bounds": [390 + ordinal * 175, y, 155, 90], "summary": event_summary(event),
                "temporal": {"actor": package_id, "ordinal": {"start": ordinal, "end": ordinal}},
            })
            supersedes = event.get("supersedes")
            if supersedes:
                if supersedes not in event_position:
                    raise ContractError(f"superseded event not found: {supersedes}")
                relations.append({
                    "type": "relation", "id": f"supersedes.{event['id']}",
                    "from": f"event.{event['id']}", "to": f"event.{supersedes}",
                    "kind": "supersedes", "label": "supersedes",
                })
    records.extend(relations)
    return records


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    data = b"".join(canonical_line(row) for row in rows)
    path.write_bytes(data)
    return {"path": path.name, "records": len(rows), "bytes": len(data), "sha256": digest(data)}


def project(input_path: Path, out_dir: Path, title: str) -> dict[str, Any]:
    events = read_events(input_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    projections = {
        "map": write_jsonl(out_dir / "map.semantic.jsonl", build_map(events, title)),
        "relations": write_jsonl(out_dir / "relations.semantic.jsonl", build_graph(events, title)),
        "history": write_jsonl(out_dir / "history.semantic.jsonl", build_history(events, title)),
    }
    input_bytes = input_path.read_bytes()
    receipt = {
        "schema": "ops.packageDecisionAtlasProjection/1",
        "status": "PASS", "authority": False, "sample": True,
        "input": {"path": input_path.name, "events": len(events), "sha256": digest(input_bytes)},
        "projections": projections,
        "views": {"map": "map/1", "relations": "graph/1", "history": "seq/1"},
        "open": ["production package decision schema", "upstream authority/lifecycle binding", "Mobile Agent source carrier CI binding"],
    }
    (out_dir / "projection-receipt.json").write_bytes(canonical_line(receipt))
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--title", default="Package Decision Atlas — SAMPLE")
    args = parser.parse_args()
    try:
        receipt = project(args.input, args.out_dir, args.title)
    except (ContractError, OSError) as exc:
        print(f"package-decision-project: {exc}", file=__import__("sys").stderr)
        return 2
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
