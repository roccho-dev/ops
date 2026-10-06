"""Pure, non-authoritative contract comparison (ADRS #540 / PR #541).

The caller owns scope, accepted identities, input acquisition and provenance
admission. Nothing here discovers a source, reads a clock, executes a provider,
or grants organizational admission. Diagnostics contain closed codes and validated
obligation identities, never raw parser errors or unchecked input values.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any

COLLECTIONS = ("required", "provided", "observations", "receipts")
FIELDS = ("obligation_digest", "capability", "consumer", "stage", "target", "slot", "binding", "profile")
HEX = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,255}\Z")
SECRET = re.compile(r"AGE-SECRET-KEY-|BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}")
MAX_ROWS = 10000


class InputError(ValueError):
    def __init__(self, code: str, field: str = "input", status: str = "INVALID"):
        self.code, self.field, self.status = code, field, status
        super().__init__(code)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical(value)).hexdigest()


def load_json(text: str) -> Any:
    """Reject duplicate properties rather than silently selecting a winner."""
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise InputError("duplicate_property")
            result[key] = value
        return result
    try:
        return json.loads(text, object_pairs_hook=object_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(InputError("nonfinite_number")))
    except InputError:
        raise
    except (ValueError, TypeError, RecursionError) as error:
        raise InputError("invalid_json") from error


def shape(value, required, optional=(), field="input"):
    if not isinstance(value, dict) or not set(required) <= value.keys() or not value.keys() <= set(required) | set(optional):
        raise InputError("schema", field)


def name(value, field="identity"):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise InputError("identity", field)


def source(value):
    shape(value, ("repository", "revision", "path", "digest"), field="source")
    for key in ("repository", "path"):
        name(value[key], "source")
    if (not isinstance(value["revision"], str) or not HEX.fullmatch(value["revision"])
            or not isinstance(value["digest"], str) or not DIGEST.fullmatch(value["digest"])):
        raise InputError("exact_source", "source")
    if value["path"].startswith("/") or ".." in value["path"].split("/"):
        raise InputError("source_path", "source")


def profile(value):
    if not isinstance(value, list) or len(value) > 32:
        raise InputError("schema", "profile")
    roles = set()
    for row in value:
        shape(row, ("role", "operation", "readback", "grade"), field="profile")
        name(row["role"], "profile")
        if row["role"] in roles:
            raise InputError("duplicate_role", "profile")
        roles.add(row["role"])
        if row["operation"] is not None:
            name(row["operation"], "profile")
        if type(row["readback"]) is not bool or row["grade"] not in ("fixture", "source", "real"):
            raise InputError("schema", "profile")


def target(value):
    shape(value, ("provider", "resource", "account"), field="target")
    for key, item in value.items():
        if item is not None:
            name(item, "target")
        elif key != "account":
            raise InputError("schema", "target")


def contract(value):
    shape(value, FIELDS, field="contract")
    if not isinstance(value["obligation_digest"], str) or not DIGEST.fullmatch(value["obligation_digest"]):
        raise InputError("semantic_digest", "contract")
    for key in ("capability", "consumer", "stage", "slot", "binding"):
        name(value[key], "contract")
    target(value["target"])
    profile(value["profile"])


def rows(value, collection):
    if not isinstance(value, list) or len(value) > MAX_ROWS:
        raise InputError("row_limit_or_schema", collection)
    result = {}
    for row in value:
        if not isinstance(row, dict) or "id" not in row:
            raise InputError("schema", collection)
        name(row["id"], collection)
        if row["id"] in result:
            raise InputError("duplicate_id", collection)
        result[row["id"]] = row
    return result


def row_digest(value):
    return digest(sorted(value, key=lambda row: row["id"]))


def scan(value, depth=0):
    if depth > 32:
        raise InputError("depth")
    if isinstance(value, str):
        if len(value) > 4096 or SECRET.search(value):
            raise InputError("private_or_oversize_input")
    elif isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or key.lower() in {"secret", "secret_value", "secret_hash", "private_key", "api_key", "plaintext"}:
                raise InputError("private_input")
            scan(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            scan(item, depth + 1)
    elif value is not None and type(value) not in (bool, int):
        raise InputError("unsupported_value")


def compare(packet: Mapping[str, Any], admission: Mapping[str, Any]) -> dict:
    """Compare supplied finite observations against an independently admitted manifest.

    `admission` must come from the caller's trusted acquisition/authority boundary,
    not from the packet producer. Hash agreement is integrity, not authentication.
    A missing admission is UNKNOWN. The result always has authority=False.
    """
    findings = []
    def finding(kind, field, identity=None):
        item = {"kind": kind, "field": field}
        if identity is not None:
            item["obligation_id"] = identity
        if item not in findings:
            findings.append(item)
    try:
        scan(packet)
        scan(admission)
        if not admission:
            raise InputError("admission_missing", status="UNKNOWN")
        shape(admission, ("kind", "scope", "universe", "inventory", "evidence"), field="admission")
        if admission["kind"] != "contractDiffAdmission.v1":
            raise InputError("schema", "admission")
        shape(packet, ("kind", *COLLECTIONS), field="packet")
        if packet["kind"] != "contractDiffInput.v1":
            raise InputError("schema", "packet")
        scope = admission["scope"]
        shape(scope, ("id", "authority", "epoch", "allow_empty", "grade", "excluded_ids"), field="scope")
        for key in ("id", "epoch"):
            name(scope[key], "scope")
        source(scope["authority"])
        if type(scope["allow_empty"]) is not bool or scope["grade"] not in ("fixture", "source"):
            raise InputError("schema", "scope")
        if not isinstance(scope["excluded_ids"], list) or len(set(scope["excluded_ids"])) != len(scope["excluded_ids"]):
            raise InputError("schema", "scope")
        for identity in scope["excluded_ids"]:
            name(identity, "scope")
        U = rows(admission["universe"], "universe")
        for row in U.values():
            shape(row, ("id", "obligation_digest", "profile"), field="universe")
            if not isinstance(row["obligation_digest"], str) or not DIGEST.fullmatch(row["obligation_digest"]):
                raise InputError("semantic_digest", "universe")
            profile(row["profile"])
        if set(U) & set(scope["excluded_ids"]):
            raise InputError("scope_conflict", "scope")
        inventory = admission["inventory"]
        shape(inventory, COLLECTIONS, field="inventory")
        tables = {}
        for collection in COLLECTIONS:
            export = packet[collection]
            shape(export, ("source", "rows"), field=collection)
            source(export["source"])
            table = rows(export["rows"], collection)
            item = inventory[collection]
            shape(item, ("source", "rows_digest", "count"), field="inventory")
            source(item["source"])
            if type(item["count"]) is not int or item["count"] < 0:
                raise InputError("schema", "inventory")
            if export["source"] != item["source"] or item["count"] != len(table) or item["rows_digest"] != row_digest(export["rows"]):
                raise InputError("input_inventory_mismatch", collection, "UNKNOWN")
            tables[collection] = table
        R, P, O, H = (tables[k] for k in COLLECTIONS)
        for collection, table in (("required", R), ("provided", P)):
            for identity, row in table.items():
                shape(row, ("id", "contract"), ("evidence_refs",), field=collection)
                contract(row["contract"])
                if "evidence_refs" in row:
                    if not isinstance(row["evidence_refs"], dict):
                        raise InputError("schema", collection)
                    for role, ref in row["evidence_refs"].items():
                        name(role, collection); name(ref, collection)
                if identity not in U and identity not in scope["excluded_ids"]:
                    raise InputError("unproven_obligation", collection)
        # Exclusion follows the independently selected scope, never mutable row fields.
        R = {k: v for k, v in R.items() if k not in scope["excluded_ids"]}
        P = {k: v for k, v in P.items() if k not in scope["excluded_ids"]}
        for row in O.values():
            shape(row, ("id", "attempt", "epoch", "refs"), field="observations")
            name(row["attempt"], "observations"); name(row["epoch"], "observations")
            if not isinstance(row["refs"], dict):
                raise InputError("schema", "observations")
            for role, ref in row["refs"].items():
                name(role, "observations"); name(ref, "observations")
        for row in H.values():
            shape(row, ("id", "obligation_id", "role", "attempt", "epoch", "source", "target", "slot", "operation", "status", "readback", "grade"), field="receipts")
            for key in ("obligation_id", "role", "attempt", "epoch", "slot"):
                name(row[key], "receipts")
            source(row["source"])
            target(row["target"])
            if row["operation"] is not None:
                name(row["operation"], "receipts")
            if row["status"] not in ("PASS", "FAIL", "NOT_RUN") or row["readback"] not in ("PASS", "FAIL", "NOT_RUN") or row["grade"] not in ("fixture", "source", "real"):
                raise InputError("schema", "receipts")
        trusted = admission["evidence"]
        if not isinstance(trusted, dict) or any(not isinstance(v, str) or not DIGEST.fullmatch(v) for v in trusted.values()):
            raise InputError("schema", "evidence_admission")
        if set(R) != set(U):
            finding("COVERAGE_GAP", "required_universe")
        if not U and not scope["allow_empty"]:
            finding("COVERAGE_GAP", "empty_not_authorized")
        for identity in sorted(set(R) - set(P)):
            finding("SUPPLY_MISSING", "provided", identity)
        for identity in sorted(set(P) - set(R)):
            finding("SUPPLY_EXTRA", "provided", identity)
        for identity in sorted(set(R) & set(P)):
            required, provided, accepted = R[identity]["contract"], P[identity]["contract"], U[identity]
            for field in FIELDS:
                if canonical(required[field]) != canonical(provided[field]):
                    finding("CONTRACT_DRIFT", field, identity)
            for side, value in (("required", required), ("provided", provided)):
                for key in ("obligation_digest", "profile"):
                    if canonical(value[key]) != canonical(accepted[key]):
                        finding("CONTRACT_DRIFT", side + "." + key, identity)
            observation = O.get(identity)
            # Optional evidence is not mandatory, but two explicit claims may not conflict.
            p_refs = P[identity].get("evidence_refs", {})
            if observation is not None:
                for role, ref in p_refs.items():
                    if role in observation["refs"] and observation["refs"][role] != ref:
                        raise InputError("evidence_ref_conflict", "provided")
            requirements = accepted["profile"]
            # Zero evidence requirements is a normal empty selection, not a missing receipt.
            if not requirements:
                continue
            if observation is None:
                finding("EVIDENCE_MISSING", "observation", identity)
                continue
            for requirement in requirements:
                role = requirement["role"]
                ref = observation["refs"].get(role)
                p_refs = P[identity].get("evidence_refs", {})
                if role in p_refs and p_refs[role] != ref:
                    raise InputError("evidence_ref_conflict", "provided")
                receipt = H.get(ref)
                if receipt is None:
                    finding("EVIDENCE_MISSING", role, identity)
                    continue
                expected = {"obligation_id": identity, "role": role, "attempt": observation["attempt"],
                            "epoch": scope["epoch"], "source": packet["provided"]["source"],
                            "target": provided["target"], "slot": provided["slot"], "grade": requirement["grade"]}
                if observation["epoch"] != scope["epoch"]:
                    finding("EVIDENCE_DRIFT", "epoch", identity)
                for key, value in expected.items():
                    if canonical(receipt[key]) != canonical(value):
                        finding("EVIDENCE_DRIFT", key, identity)
                if trusted.get(ref) != digest(receipt):
                    finding("EVIDENCE_DRIFT", "provenance", identity)
                if requirement["operation"] is not None and (receipt["operation"] != requirement["operation"] or receipt["status"] != "PASS"):
                    finding("EVIDENCE_DRIFT", "effect", identity)
                if requirement["readback"] and receipt["readback"] != "PASS":
                    finding("EVIDENCE_DRIFT", "readback", identity)
        result = {"kind": "contractDiffResult.v1", "authority": False, "scope": scope["id"],
                  "grade": scope["grade"], "status": "OPEN" if findings else "CLOSED",
                  "findings": sorted(findings, key=lambda f: canonical(f)),
                  "coverage": {"expected": len(U), "required": len(R), "provided": len(P)},
                  "sources": {"authority": scope["authority"],
                              **{key: inventory[key]["source"] for key in COLLECTIONS}},
                  "input_manifest_digest": digest({
                      "scope": {**scope, "excluded_ids": sorted(scope["excluded_ids"])},
                      "universe": sorted(U.values(), key=lambda row: row["id"]),
                      "inventory": inventory, "evidence": trusted})}
        return result
    except InputError as error:
        finding(error.status, error.code)
        return {"kind": "contractDiffResult.v1", "authority": False, "status": error.status,
                "findings": sorted(findings, key=lambda f: canonical(f))}
    except (TypeError, ValueError, KeyError, RecursionError, UnicodeError):
        return {"kind": "contractDiffResult.v1", "authority": False, "status": "INVALID",
                "findings": [{"kind": "INVALID", "field": "schema"}]}
