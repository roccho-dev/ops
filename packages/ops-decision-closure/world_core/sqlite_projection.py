"""Deterministic read-only SQLite projection for world records."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Mapping, Sequence

from .model import WorldError, dumps


def create_sqlite(
    path: Path,
    items: Sequence[Mapping[str, Any]],
    claims: Sequence[Mapping[str, Any]],
    mappings: Sequence[Mapping[str, Any]],
    relations: Sequence[Mapping[str, Any]],
    units: Sequence[Mapping[str, Any]],
    scales: Sequence[Mapping[str, Any]],
) -> None:
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            CREATE TABLE world_items (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              name TEXT,
              recorded_at TEXT NOT NULL,
              status TEXT NOT NULL,
              origin_source TEXT NOT NULL,
              origin_line INTEGER NOT NULL,
              data_json TEXT NOT NULL
            );
            CREATE TABLE world_claims (
              id TEXT PRIMARY KEY,
              subject TEXT NOT NULL,
              relation TEXT NOT NULL,
              target_ref TEXT,
              target_value_json TEXT,
              target_unit TEXT,
              target_scale TEXT,
              basis TEXT NOT NULL,
              mode TEXT NOT NULL,
              recorded_at TEXT NOT NULL,
              status TEXT NOT NULL,
              origin_source TEXT NOT NULL,
              origin_line INTEGER NOT NULL,
              mapping_quality TEXT,
              legacy_stream TEXT,
              legacy_record_type TEXT,
              legacy_subtype TEXT,
              legacy_role TEXT,
              confidence_scale TEXT,
              confidence_score REAL,
              confidence_level TEXT,
              data_json TEXT NOT NULL
            );
            CREATE TABLE world_mappings (
              id TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              line INTEGER NOT NULL,
              mapper TEXT NOT NULL,
              quality TEXT NOT NULL,
              strategy TEXT,
              outputs_json TEXT NOT NULL,
              UNIQUE(source, line)
            );
            CREATE TABLE world_relations (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              inverse TEXT,
              symmetric INTEGER NOT NULL,
              aliases_json TEXT NOT NULL
            );
            CREATE TABLE world_units (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              aliases_json TEXT NOT NULL
            );
            CREATE TABLE world_scales (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              ordered INTEGER NOT NULL,
              values_json TEXT NOT NULL
            );
            CREATE INDEX world_claims_subject_relation ON world_claims(subject, relation);
            CREATE INDEX world_claims_mode_basis ON world_claims(mode, basis);
            CREATE INDEX world_claims_legacy_type ON world_claims(legacy_record_type);
            CREATE VIEW v_world_attributes AS
              SELECT * FROM world_claims WHERE status='active' AND mode='actual';
            CREATE VIEW v_world_facts AS
              SELECT * FROM world_claims
              WHERE status='active' AND legacy_record_type='fact' AND mapping_quality='semantic';
            CREATE VIEW v_world_constraints AS
              SELECT * FROM world_claims
              WHERE status='active' AND mode IN ('required','forbidden') AND mapping_quality='semantic';
            CREATE VIEW v_world_proposals AS
              SELECT * FROM world_claims
              WHERE status='active' AND mode IN ('desired','recommended','selected') AND mapping_quality='semantic';
            CREATE VIEW v_world_inferences AS
              SELECT * FROM world_claims
              WHERE status='active' AND basis IN ('inferred','assumed') AND mapping_quality='semantic';
            CREATE VIEW v_world_edges AS
              SELECT id, subject, relation, target_ref, basis, mode, recorded_at
              FROM world_claims WHERE target_ref IS NOT NULL;
            """
        )
        for row in items:
            connection.execute(
                "INSERT INTO world_items VALUES (?,?,?,?,?,?,?,?)",
                (
                    row["id"], row["kind"], row.get("name"), row["recorded_at"],
                    row["status"], row["origin"]["source"], row["origin"]["line"],
                    dumps(row.get("data", {})),
                ),
            )
        for row in claims:
            target = row["target"]
            legacy = row.get("data", {}).get("legacy", {})
            extra = legacy.get("extra", {}) if isinstance(legacy, dict) else {}
            confidence = row.get("confidence", {})
            connection.execute(
                "INSERT INTO world_claims VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    row["id"], row["subject"], row["relation"], target.get("ref"),
                    dumps(target.get("value")) if "value" in target else None,
                    target.get("unit"), target.get("scale"), row["basis"], row["mode"],
                    row["recorded_at"], row["status"], row["origin"]["source"], row["origin"]["line"],
                    row.get("data", {}).get("mapping_quality"),
                    legacy.get("stream") if isinstance(legacy, dict) else None,
                    legacy.get("record_type") if isinstance(legacy, dict) else None,
                    extra.get("subtype") if isinstance(extra, dict) else None,
                    extra.get("role") if isinstance(extra, dict) else None,
                    confidence.get("scale") if isinstance(confidence, dict) else None,
                    confidence.get("score") if isinstance(confidence, dict) else None,
                    confidence.get("level") if isinstance(confidence, dict) else None,
                    dumps(row.get("data", {})),
                ),
            )
        for row in mappings:
            connection.execute(
                "INSERT INTO world_mappings VALUES (?,?,?,?,?,?,?)",
                (
                    row["id"], row["source"], row["line"], row["mapper"],
                    row["quality"], row.get("strategy"), dumps(row["outputs"]),
                ),
            )
        for row in relations:
            connection.execute(
                "INSERT INTO world_relations VALUES (?,?,?,?,?)",
                (
                    row["id"], row["name"], row.get("inverse"),
                    1 if row.get("symmetric") else 0, dumps(row["aliases"]),
                ),
            )
        for row in units:
            connection.execute(
                "INSERT INTO world_units VALUES (?,?,?)",
                (row["id"], row["name"], dumps(row["aliases"])),
            )
        for row in scales:
            connection.execute(
                "INSERT INTO world_scales VALUES (?,?,?,?)",
                (
                    row["id"], row["name"], 1 if row.get("ordered") else 0,
                    dumps(row.get("values", [])),
                ),
            )
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise WorldError(f"SQLite integrity_check failed: {integrity}")
        connection.execute("VACUUM")
    finally:
        connection.close()
