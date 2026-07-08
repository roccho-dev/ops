#!/usr/bin/env python3
"""Thin contract kernel for append-only JSONL contract proofs.

This is intentionally small: CUE/JSON Schema/tsc do structural work; this script
only glues generated artifacts, admission, receipts, authority, graph, source
policy, lineage, and partition proofs.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

GENERATOR_VERSION = "proof-contract-kernel.v0.4"
FIXED_TIME = "2026-07-05T00:00:00Z"
HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
TIME_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
FIELD_REF_RE = re.compile(r"^[a-z][a-z0-9_]*\.v[0-9]+#[a-z][a-z0-9_.]*$")


def eprint(*a: Any) -> None:
    print(*a, file=sys.stderr)


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "rt", encoding="utf-8")


def read_bytes(path: Path) -> bytes:
    if str(path).endswith(".gz"):
        with gzip.open(path, "rb") as f:
            return f.read()
    return path.read_bytes()


def sha256_bytes(b: bytes) -> str:
    return "sha256:" + hashlib.sha256(b).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    if str(path).endswith(".gz"):
        with gzip.open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
    else:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
    return "sha256:" + h.hexdigest()


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    with open_text(path) as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception as ex:
                raise SystemExit(f"{path}:{i}: invalid JSON: {ex}")
            if not isinstance(ev, dict):
                raise SystemExit(f"{path}:{i}: JSONL row must be object")
            ev["__line__"] = i
            out.append(ev)
    return out


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def schema_name(schema_id: str) -> str:
    return schema_id.replace(".", "_").replace("-", "_")


def ts_type(field: Dict[str, Any]) -> str:
    ft = field.get("field_type")
    if ft in ("string", "timestamp", "hash", "id", "ref"):
        return "string"
    if ft in ("number", "integer"):
        return "number"
    if ft == "boolean":
        return "boolean"
    if ft == "array<string>" or ft == "array<ref>":
        return "string[]"
    if ft == "enum":
        vals = field.get("enum_values") or []
        if vals:
            return " | ".join(json.dumps(v) for v in vals)
        return "string"
    return "unknown"


def json_type(field: Dict[str, Any]) -> Dict[str, Any]:
    ft = field.get("field_type")
    if ft in ("string", "timestamp", "hash", "id", "ref"):
        sch: Dict[str, Any] = {"type": "string"}
        if ft == "hash":
            sch["pattern"] = r"^sha256:[0-9a-f]{64}$"
        if ft == "timestamp":
            sch["pattern"] = r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
        return sch
    if ft == "number":
        return {"type": "number"}
    if ft == "integer":
        return {"type": "integer"}
    if ft == "boolean":
        return {"type": "boolean"}
    if ft == "array<string>" or ft == "array<ref>":
        return {"type": "array", "items": {"type": "string"}}
    if ft == "enum":
        vals = field.get("enum_values") or []
        return {"type": "string", "enum": vals} if vals else {"type": "string"}
    return {}


def index_contract(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    idx: Dict[str, Any] = {
        "schemas": {},
        "fields": defaultdict(dict),
        "deprecated": {},
        "edges": [],
        "queries": {},
        "fixtures": {},
        "authority_rules": [],
        "events": {},
    }
    errors: List[str] = []
    for ev in events:
        line = ev.get("__line__")
        kind = ev.get("kind")
        eid = ev.get("event_id")
        if eid:
            if eid in idx["events"]:
                errors.append(f"line {line}: duplicate event_id {eid}")
            idx["events"][eid] = line
        if kind == "contract.schema.v1":
            idx["schemas"][ev["schema_id"]] = dict(ev)
        elif kind == "contract.field.v1":
            idx["fields"][ev["schema_id"]][ev["field_id"]] = dict(ev)
        elif kind == "contract.field.deprecated.v1":
            idx["deprecated"][f"{ev['schema_id']}#{ev['field_id']}"] = dict(ev)
        elif kind == "contract.edge.v1":
            idx["edges"].append(dict(ev))
        elif kind == "contract.query.v1":
            idx["queries"][ev["query_id"]] = dict(ev)
        elif kind == "contract.fixture.v1":
            idx["fixtures"][ev["fixture_id"]] = dict(ev)
        elif kind == "contract.authority_rule.v1":
            idx["authority_rules"].append(dict(ev))
    idx["errors"] = errors
    return idx


def semantic_errors(idx: Dict[str, Any]) -> List[str]:
    errors: List[str] = list(idx.get("errors", []))
    schemas = idx["schemas"]
    fields = idx["fields"]
    for sid, fmap in fields.items():
        if sid not in schemas:
            errors.append(f"field references missing schema {sid}")
    for e in idx["edges"]:
        if e["from_schema"] not in schemas:
            errors.append(f"edge {e['edge_kind']} references missing from_schema {e['from_schema']}")
        if e["to_schema"] not in schemas:
            errors.append(f"edge {e['edge_kind']} references missing to_schema {e['to_schema']}")
    fixtures = idx["fixtures"]
    for qid, q in idx["queries"].items():
        if q["output_schema"] not in schemas:
            errors.append(f"query {qid} references missing output_schema {q['output_schema']}")
        for ref in q.get("input_fields", []):
            if not FIELD_REF_RE.match(ref):
                errors.append(f"query {qid} has invalid field ref {ref}")
                continue
            sid, fid = ref.split("#", 1)
            if sid not in schemas:
                errors.append(f"query {qid} references missing schema {sid}")
            if fid not in fields.get(sid, {}):
                errors.append(f"query {qid} references missing field {sid}#{fid}")
        for fx in q.get("fixture_ids", []):
            if fx not in fixtures:
                errors.append(f"query {qid} references missing fixture {fx}")
            elif fixtures[fx].get("target_query_id") != qid:
                errors.append(f"query {qid} fixture {fx} targets {fixtures[fx].get('target_query_id')}")
    return sorted(set(errors))


def contract_event_schema() -> Dict[str, Any]:
    common = {
        "event_id": {"type": "string", "pattern": r"^evt_[a-z0-9][a-z0-9_]{6,}$"},
        "schema_version": {"const": "contract.meta.v1"},
        "created_at": {"type": "string", "pattern": r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"},
        "purpose_level": {"type": "string", "pattern": r"^(purpose|meta\^[0-9]+)$"},
        "authority": {"enum": ["contract_owner", "governance", "extractor", "projection_runner", "agent", "human"]},
    }
    def obj(kind: str, props: Dict[str, Any], req: List[str]) -> Dict[str, Any]:
        p = dict(common)
        p.update({"kind": {"const": kind}})
        p.update(props)
        return {"type": "object", "additionalProperties": False, "properties": p, "required": ["event_id", "schema_version", "created_at", "purpose_level", "authority", "kind"] + req}
    schema_id = {"type": "string", "pattern": r"^[a-z][a-z0-9_]*\.v[0-9]+$"}
    field_id = {"type": "string", "pattern": r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$"}
    qid = {"type": "string", "pattern": r"^q_[a-z0-9_]+\.v[0-9]+$"}
    fxid = {"type": "string", "pattern": r"^fx_[a-z0-9_]+$"}
    hash_s = {"type": "string", "pattern": r"^sha256:[0-9a-f]{64}$"}
    field_ref = {"type": "string", "pattern": r"^[a-z][a-z0-9_]*\.v[0-9]+#[a-z][a-z0-9_.]*$"}
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://example.invalid/contract-event.schema.json",
        "oneOf": [
            obj("contract.schema.v1", {"schema_id": schema_id, "title": {"type": "string"}, "lifecycle": {"enum": ["active", "deprecated"]}}, ["schema_id", "title", "lifecycle"]),
            obj("contract.field.v1", {"schema_id": schema_id, "field_id": field_id, "field_type": {"enum": ["string", "number", "integer", "boolean", "timestamp", "hash", "id", "enum", "ref", "array<string>", "array<ref>"]}, "required": {"type": "boolean"}, "pii": {"type": "boolean"}, "description": {"type": "string"}, "enum_values": {"type": "array", "items": {"type": "string"}}, "ref_schema": schema_id}, ["schema_id", "field_id", "field_type", "required", "pii", "description"]),
            obj("contract.field.deprecated.v1", {"schema_id": schema_id, "field_id": field_id, "reason": {"type": "string"}, "replacement_field_ref": field_ref}, ["schema_id", "field_id", "reason"]),
            obj("contract.edge.v1", {"edge_kind": {"type": "string", "pattern": r"^[a-z][a-z0-9_]*$"}, "from_schema": schema_id, "to_schema": schema_id, "cardinality": {"enum": ["one_to_one", "one_to_many", "many_to_one", "many_to_many"]}, "acyclic_required": {"type": "boolean"}}, ["edge_kind", "from_schema", "to_schema", "cardinality", "acyclic_required"]),
            obj("contract.query.v1", {"query_id": qid, "query_family": {"type": "string", "pattern": r"^[a-z][a-z0-9_]*$"}, "input_fields": {"type": "array", "items": field_ref}, "output_schema": schema_id, "runner_kind": {"enum": ["generated", "duckdb", "go", "ts", "python", "jq"]}, "projection_only": {"const": True}, "side_effects": {"const": False}, "fixture_ids": {"type": "array", "items": fxid}, "expected_output_hash": hash_s}, ["query_id", "query_family", "input_fields", "output_schema", "runner_kind", "projection_only", "side_effects", "fixture_ids", "expected_output_hash"]),
            obj("contract.fixture.v1", {"fixture_id": fxid, "target_query_id": qid, "polarity": {"enum": ["positive", "negative"]}, "payload_hash": hash_s}, ["fixture_id", "target_query_id", "polarity", "payload_hash"]),
            obj("contract.authority_rule.v1", {"subject_kind": {"enum": ["schema", "query", "projection", "decision"]}, "subject_id": {"type": "string"}, "rule": {"enum": ["projection_cannot_decide", "decision_requires_owner", "receipt_required", "raw_cannot_decide"]}}, ["subject_kind", "subject_id", "rule"]),
        ],
    }


def generate_schema_catalog(idx: Dict[str, Any]) -> Dict[str, Any]:
    catalog = {"schemas": {}, "queries": {}, "deprecated_fields": sorted(idx["deprecated"].keys())}
    for sid in sorted(idx["schemas"]):
        required = []
        props = {}
        for fid, field in sorted(idx["fields"].get(sid, {}).items()):
            props[fid] = json_type(field)
            if field.get("required"):
                required.append(fid)
        catalog["schemas"][sid] = {"properties": props, "required": required, "additionalProperties": False}
    for qid, q in sorted(idx["queries"].items()):
        catalog["queries"][qid] = {"input_fields": q.get("input_fields", []), "output_schema": q.get("output_schema"), "fixture_ids": q.get("fixture_ids", [])}
    return catalog


def generate_ts(idx: Dict[str, Any]) -> str:
    lines = ["// Generated from contract JSONL. Do not edit by hand.", "/* eslint-disable */", ""]
    for sid in sorted(idx["schemas"]):
        iface = "".join(part.capitalize() for part in re.split(r"[._]", sid))
        lines.append(f"export interface {iface} {{")
        for fid, field in sorted(idx["fields"].get(sid, {}).items()):
            opt = "" if field.get("required") else "?"
            safe = json.dumps(fid)
            lines.append(f"  {safe}{opt}: {ts_type(field)};")
        lines.append("}")
        lines.append("")
    lines.append("export const accessors = {")
    for sid in sorted(idx["schemas"]):
        iface = "".join(part.capitalize() for part in re.split(r"[._]", sid))
        obj = schema_name(sid)
        lines.append(f"  {obj}: {{")
        for fid, field in sorted(idx["fields"].get(sid, {}).items()):
            name = fid.replace(".", "_")
            lines.append(f"    {name}: (row: {iface}) => row[{json.dumps(fid)}],")
        lines.append("  },")
    lines.append("} as const;")
    lines.append("")
    lines.append("export const fieldRefs = {")
    for sid in sorted(idx["schemas"]):
        obj = schema_name(sid)
        lines.append(f"  {obj}: {{")
        for fid in sorted(idx["fields"].get(sid, {})):
            name = fid.replace(".", "_")
            lines.append(f"    {name}: {json.dumps(sid + '#' + fid)},")
        lines.append("  },")
    lines.append("} as const;")
    return "\n".join(lines) + "\n"


def artifact_hashes(outdir: Path) -> Dict[str, str]:
    hashes = {}
    for p in sorted(outdir.rglob("*")):
        if p.is_file() and p.name != "manifest.json":
            hashes[p.relative_to(outdir).as_posix()] = sha256_file(p)
    return hashes


def core_out_root(out: Path) -> Path:
    return out / "core"


def generated_schema_path(root: Path) -> Path:
    scoped = root / "core" / "jsonschema" / "contract-event.schema.json"
    if scoped.exists():
        return scoped
    return root / "jsonschema" / "contract-event.schema.json"


def cmd_generate_artifacts(args: argparse.Namespace) -> None:
    ledger = Path(args.ledger)
    meta = Path(args.meta)
    out = Path(args.out)
    core = core_out_root(out)
    if core.exists():
        shutil.rmtree(core)
    core.mkdir(parents=True, exist_ok=True)
    events = read_jsonl(ledger)
    idx = index_contract(events)
    errs = semantic_errors(idx)
    if errs:
        raise SystemExit("semantic errors: " + "; ".join(errs[:10]))
    write_json(core / "jsonschema" / "contract-event.schema.json", contract_event_schema())
    write_json(core / "jsonschema" / "schema-catalog.json", generate_schema_catalog(idx))
    (core / "ts").mkdir(parents=True, exist_ok=True)
    (core / "ts" / "accessors.ts").write_text(generate_ts(idx), encoding="utf-8")
    write_json(core / "indexes" / "contract-index.json", {
        "schema_count": len(idx["schemas"]),
        "field_count": sum(len(v) for v in idx["fields"].values()),
        "query_count": len(idx["queries"]),
        "fixture_count": len(idx["fixtures"]),
        "deprecated_fields": sorted(idx["deprecated"].keys()),
        "query_inputs": {qid: q.get("input_fields", []) for qid, q in sorted(idx["queries"].items())},
    })
    manifest = {
        "generator": "proof/python/contract_kernel.py",
        "generator_version": GENERATOR_VERSION,
        "contract_ledger": str(ledger),
        "meta_contract": str(meta),
        "contract_sha256": sha256_file(ledger),
        "meta_sha256": sha256_file(meta),
        "artifact_hashes": artifact_hashes(core),
        "scope": "generated/core",
    }
    write_json(core / "manifest.json", manifest)
    print(json.dumps({"status": "generated", "out": str(core), "artifacts": len(manifest["artifact_hashes"]), "scope": "core"}, sort_keys=True))

def compare_dirs(a: Path, b: Path) -> List[str]:
    diffs = []
    aset = {p.relative_to(a).as_posix() for p in a.rglob("*") if p.is_file()}
    bset = {p.relative_to(b).as_posix() for p in b.rglob("*") if p.is_file()}
    for rel in sorted(aset | bset):
        if rel not in aset:
            diffs.append(f"missing in current: {rel}")
        elif rel not in bset:
            diffs.append(f"extra in current: {rel}")
        elif (a / rel).read_bytes() != (b / rel).read_bytes():
            diffs.append(f"changed: {rel}")
    return diffs


def cmd_verify_generated(args: argparse.Namespace) -> None:
    out = Path(args.out)
    core = core_out_root(out)
    manifest_path = core / "manifest.json"
    if not manifest_path.exists():
        legacy = out / "manifest.json"
        manifest_path = legacy
        core = out
    if not manifest_path.exists():
        raise SystemExit("generated core manifest missing")
    manifest = json.loads(manifest_path.read_text())
    ledger = Path(args.ledger or manifest["contract_ledger"])
    meta = Path(args.meta or manifest["meta_contract"])
    errors = []
    if sha256_file(ledger) != manifest.get("contract_sha256"):
        errors.append("contract_sha256 mismatch")
    if sha256_file(meta) != manifest.get("meta_sha256"):
        errors.append("meta_sha256 mismatch")
    for rel, expected in manifest.get("artifact_hashes", {}).items():
        p = core / rel
        if not p.exists():
            errors.append(f"missing artifact {rel}")
        elif sha256_file(p) != expected:
            errors.append(f"artifact hash mismatch {rel}")
    with tempfile.TemporaryDirectory() as td:
        regen_root = Path(td) / "generated"
        ns = argparse.Namespace(ledger=str(ledger), meta=str(meta), out=str(regen_root))
        cmd_generate_artifacts(ns)
        diffs = compare_dirs(core, core_out_root(regen_root))
        errors.extend(diffs)
    if errors:
        raise SystemExit("generated integrity failed: " + "; ".join(errors[:20]))
    print(json.dumps({"status": "pass", "check": "generated-integrity", "artifacts": len(manifest.get("artifact_hashes", {})), "scope": "core"}, sort_keys=True))

def cmd_validate_jsonschema(args: argparse.Namespace) -> None:
    try:
        import jsonschema
    except Exception as ex:
        raise SystemExit(f"jsonschema package unavailable: {ex}")
    schema = json.loads(generated_schema_path(Path(args.generated)).read_text())
    validator = jsonschema.Draft202012Validator(schema)
    errors = []
    for ev in read_jsonl(Path(args.ledger)):
        line = ev.pop("__line__", None)
        for err in validator.iter_errors(ev):
            errors.append(f"line {line}: {err.message}")
            break
    if errors:
        raise SystemExit("jsonschema validation failed: " + "; ".join(errors[:20]))
    print(json.dumps({"status": "pass", "check": "jsonschema-validation", "ledger": args.ledger}, sort_keys=True))


def cmd_admit(args: argparse.Namespace) -> None:
    draft = Path(args.draft)
    canonical = Path(args.canonical)
    receipt = Path(args.receipt)
    status = "accepted"
    err_text = ""
    try:
        # Validate generated JSON Schema if present, then cross-row semantics.
        if args.generated:
            ns = argparse.Namespace(generated=args.generated, ledger=str(draft))
            cmd_validate_jsonschema(ns)
        events = read_jsonl(draft)
        errs = semantic_errors(index_contract(events))
        if errs:
            raise RuntimeError("; ".join(errs[:10]))
    except Exception as ex:
        status = "rejected"
        err_text = str(ex)
    rec = {
        "kind": "admission.receipt.v1",
        "status": status,
        "created_at": FIXED_TIME,
        "source_path": str(draft),
        "target_path": str(canonical),
        "input_sha256": sha256_file(draft) if draft.exists() else "",
    }
    if status == "accepted":
        canonical.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(draft, canonical)
        rec["output_sha256"] = sha256_file(canonical)
    else:
        rec["error"] = err_text
    receipt.parent.mkdir(parents=True, exist_ok=True)
    with open(receipt, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")
    print(json.dumps(rec, sort_keys=True))
    if status != "accepted":
        raise SystemExit(1)


def cmd_verify_canonical(args: argparse.Namespace) -> None:
    canonical = Path(args.canonical)
    receipt = Path(args.receipt)
    if not canonical.exists():
        raise SystemExit("canonical ledger missing")
    target_hash = sha256_file(canonical)
    ok = False
    for rec in read_jsonl(receipt):
        if rec.get("kind") == "admission.receipt.v1" and rec.get("status") == "accepted" and rec.get("target_path") == str(canonical) and rec.get("output_sha256") == target_hash:
            ok = True
    if not ok:
        raise SystemExit("canonical ledger has no matching accepted admission receipt; possible direct append")
    print(json.dumps({"status": "pass", "check": "canonical-admission", "canonical_sha256": target_hash}, sort_keys=True))


def cmd_authority_check(args: argparse.Namespace) -> None:
    errors = []
    for ev in read_jsonl(Path(args.attempts)):
        actor = ev.get("actor_kind")
        status = ev.get("decision_status")
        line = ev.get("__line__")
        if status == "accepted" and actor in {"projection", "ci", "agent"}:
            errors.append(f"line {line}: {actor} cannot create accepted decision")
        if status == "accepted" and actor not in {"owner", "governance"}:
            errors.append(f"line {line}: accepted decision requires owner/governance")
        if status == "accepted" and not ev.get("receipt_ref"):
            errors.append(f"line {line}: accepted decision requires receipt_ref")
    if errors:
        raise SystemExit("authority check failed: " + "; ".join(errors))
    print(json.dumps({"status": "pass", "check": "authority-boundary"}, sort_keys=True))


def validate_receipt_row(row: Dict[str, Any]) -> List[str]:
    errors = []
    required = ["kind", "receipt_id", "receipt_type", "status", "target_id", "input_hash", "created_at"]
    for k in required:
        if not row.get(k):
            errors.append(f"missing {k}")
    if row.get("kind") != "receipt.v1":
        errors.append("kind must be receipt.v1")
    if row.get("status") not in {"pass", "fail", "reject"}:
        errors.append("bad status")
    if row.get("receipt_type") not in {"validation", "projection", "migration", "action", "admission"}:
        errors.append("bad receipt_type")
    if row.get("input_hash") and not HASH_RE.match(row.get("input_hash")):
        errors.append("bad input_hash")
    if row.get("status") == "pass" and not row.get("output_hash"):
        errors.append("pass receipt requires output_hash")
    if row.get("output_hash") and not HASH_RE.match(row.get("output_hash")):
        errors.append("bad output_hash")
    if row.get("created_at") and not TIME_RE.match(row.get("created_at")):
        errors.append("bad created_at")
    return errors


def cmd_receipt_check(args: argparse.Namespace) -> None:
    errors = []
    for row in read_jsonl(Path(args.receipts)):
        line = row.pop("__line__", None)
        for e in validate_receipt_row(row):
            errors.append(f"line {line}: {e}")
    if errors:
        raise SystemExit("receipt check failed: " + "; ".join(errors))
    print(json.dumps({"status": "pass", "check": "receipt-ledger"}, sort_keys=True))


def cmd_graph_check(args: argparse.Namespace) -> None:
    idx = index_contract(read_jsonl(Path(args.ledger)))
    errors = []
    schemas = idx["schemas"]
    adj = defaultdict(list)
    for e in idx["edges"]:
        f, t = e["from_schema"], e["to_schema"]
        if f not in schemas:
            errors.append(f"missing from_schema {f}")
        if t not in schemas:
            errors.append(f"missing to_schema {t}")
        forbidden = {("raw.v1", "decision.v1"), ("projection.v1", "raw.v1"), ("projection.v1", "decision.v1")}
        if (f, t) in forbidden:
            errors.append(f"forbidden flow {f}->{t}")
        if e.get("acyclic_required"):
            adj[f].append(t)
    # cycle detection
    color: Dict[str, int] = {}
    def dfs(n: str, stack: List[str]) -> None:
        color[n] = 1
        for m in adj[n]:
            if color.get(m) == 1:
                errors.append("cycle: " + "->".join(stack + [m]))
            elif color.get(m, 0) == 0:
                dfs(m, stack + [m])
        color[n] = 2
    for n in sorted(schemas):
        if color.get(n, 0) == 0:
            dfs(n, [n])
    if errors:
        raise SystemExit("graph check failed: " + "; ".join(sorted(set(errors))))
    print(json.dumps({"status": "pass", "check": "graph", "edges": len(idx["edges"])}, sort_keys=True))


def cmd_source_policy_check(args: argparse.Namespace) -> None:
    sources = set()
    raws = set()
    errors = []
    for row in read_jsonl(Path(args.ledger)):
        line = row.get("__line__")
        kind = row.get("kind")
        if kind == "source.registry.v1":
            for k in ["source_id", "source_kind", "trust_class", "retention_class"]:
                if not row.get(k): errors.append(f"line {line}: missing {k}")
            sources.add(row.get("source_id"))
        elif kind == "raw.evidence.v1":
            for k in ["raw_id", "source_id", "raw_ref", "content_hash", "retention_class"]:
                if not row.get(k): errors.append(f"line {line}: missing {k}")
            if row.get("source_id") not in sources:
                errors.append(f"line {line}: raw references missing source")
            if row.get("content_hash") and not HASH_RE.match(row.get("content_hash")):
                errors.append(f"line {line}: bad content_hash")
            raws.add(row.get("raw_id"))
        elif kind == "extraction.v1":
            for k in ["extraction_id", "raw_id", "extractor_version", "output_schema", "output_hash"]:
                if not row.get(k): errors.append(f"line {line}: missing {k}")
            if row.get("raw_id") not in raws:
                errors.append(f"line {line}: extraction references missing raw")
            if row.get("output_hash") and not HASH_RE.match(row.get("output_hash")):
                errors.append(f"line {line}: bad output_hash")
        else:
            errors.append(f"line {line}: unknown source-policy kind {kind}")
    if errors:
        raise SystemExit("source policy failed: " + "; ".join(errors))
    print(json.dumps({"status": "pass", "check": "source-policy", "sources": len(sources), "raws": len(raws)}, sort_keys=True))


def cmd_lineage(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    idx = index_contract(read_jsonl(Path(args.ledger)))
    adj = defaultdict(list)
    for e in idx["edges"]:
        adj[e["from_schema"]].append(e["to_schema"])
    closure_rows = []
    for start in sorted(idx["schemas"]):
        seen = {start: 0}
        q = deque([start])
        while q:
            n = q.popleft()
            for m in adj[n]:
                if m not in seen:
                    seen[m] = seen[n] + 1
                    q.append(m)
        for desc, depth in sorted(seen.items()):
            if desc != start:
                closure_rows.append({"kind": "closure.v1", "ancestor_schema": start, "descendant_schema": desc, "depth": depth, "path_hash": sha256_bytes(f"{start}->{desc}:{depth}".encode())})
    write_jsonl(out / "closure.jsonl", closure_rows)
    dep = sorted(idx["deprecated"].keys())
    affected = defaultdict(list)
    for qid, q in idx["queries"].items():
        for ref in q.get("input_fields", []):
            if ref in idx["deprecated"]:
                affected[ref].append(qid)
    write_json(out / "impact_report.json", {"deprecated_fields": dep, "affected_queries": {k: sorted(v) for k, v in sorted(affected.items())}})
    write_json(out / "stale_report.json", {"stale_projection_families": []})
    print(json.dumps({"status": "pass", "check": "lineage", "closure_rows": len(closure_rows), "deprecated_fields": len(dep)}, sort_keys=True))


def cmd_partition(args: argparse.Namespace) -> None:
    ledger = Path(args.ledger)
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    chunk = int(args.chunk_lines)
    manifest = {"ledger": str(ledger), "ledger_sha256": sha256_file(ledger), "chunk_lines": chunk, "partitions": []}
    part_no = 0
    buf: List[str] = []
    total = 0
    def flush() -> None:
        nonlocal part_no, buf
        if not buf:
            return
        p = out / f"part_{part_no:05d}.jsonl.gz"
        with gzip.open(p, "wt", encoding="utf-8") as f:
            f.write("".join(buf))
        manifest["partitions"].append({"path": p.name, "lines": len(buf), "sha256": sha256_file(p)})
        part_no += 1
        buf = []
    with open_text(ledger) as f:
        for line in f:
            total += 1
            buf.append(line)
            if len(buf) >= chunk:
                flush()
    flush()
    manifest["total_lines"] = total
    write_json(out / "partition_manifest.json", manifest)
    print(json.dumps({"status": "pass", "check": "partition", "partitions": len(manifest["partitions"]), "total_lines": total}, sort_keys=True))


def cmd_verify_partition(args: argparse.Namespace) -> None:
    root = Path(args.out)
    manifest = json.loads((root / "partition_manifest.json").read_text())
    total = 0
    errors = []
    for part in manifest["partitions"]:
        p = root / part["path"]
        if not p.exists():
            errors.append(f"missing partition {p}")
            continue
        if sha256_file(p) != part["sha256"]:
            errors.append(f"hash mismatch {p.name}")
        total += part["lines"]
    if total != manifest["total_lines"]:
        errors.append("line total mismatch")
    if errors:
        raise SystemExit("partition verify failed: " + "; ".join(errors))
    print(json.dumps({"status": "pass", "check": "partition-verify", "total_lines": total, "partitions": len(manifest["partitions"])}, sort_keys=True))


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate-artifacts"); g.add_argument("--ledger", required=True); g.add_argument("--meta", default="contracts/meta.cue"); g.add_argument("--out", default="generated")
    v = sub.add_parser("verify-generated"); v.add_argument("--ledger"); v.add_argument("--meta"); v.add_argument("--out", default="generated")
    js = sub.add_parser("validate-jsonschema"); js.add_argument("--ledger", required=True); js.add_argument("--generated", default="generated")
    ad = sub.add_parser("admit"); ad.add_argument("--draft", required=True); ad.add_argument("--canonical", required=True); ad.add_argument("--receipt", required=True); ad.add_argument("--generated", default="generated")
    vc = sub.add_parser("verify-canonical"); vc.add_argument("--canonical", required=True); vc.add_argument("--receipt", required=True)
    au = sub.add_parser("authority-check"); au.add_argument("--attempts", required=True)
    rc = sub.add_parser("receipt-check"); rc.add_argument("--receipts", required=True)
    gr = sub.add_parser("graph-check"); gr.add_argument("--ledger", required=True)
    sp = sub.add_parser("source-policy-check"); sp.add_argument("--ledger", required=True)
    li = sub.add_parser("lineage"); li.add_argument("--ledger", required=True); li.add_argument("--out", required=True)
    pa = sub.add_parser("partition"); pa.add_argument("--ledger", required=True); pa.add_argument("--out", required=True); pa.add_argument("--chunk-lines", default="50000")
    pv = sub.add_parser("verify-partition"); pv.add_argument("--out", required=True)
    args = p.parse_args()
    if args.cmd == "generate-artifacts": cmd_generate_artifacts(args)
    elif args.cmd == "verify-generated": cmd_verify_generated(args)
    elif args.cmd == "validate-jsonschema": cmd_validate_jsonschema(args)
    elif args.cmd == "admit": cmd_admit(args)
    elif args.cmd == "verify-canonical": cmd_verify_canonical(args)
    elif args.cmd == "authority-check": cmd_authority_check(args)
    elif args.cmd == "receipt-check": cmd_receipt_check(args)
    elif args.cmd == "graph-check": cmd_graph_check(args)
    elif args.cmd == "source-policy-check": cmd_source_policy_check(args)
    elif args.cmd == "lineage": cmd_lineage(args)
    elif args.cmd == "partition": cmd_partition(args)
    elif args.cmd == "verify-partition": cmd_verify_partition(args)


if __name__ == "__main__":
    main()
