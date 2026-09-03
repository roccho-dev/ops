#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import re
import unittest
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schemas" / "semantic-log-verified-dist-v1.schema.json"
EXAMPLE = ROOT / "examples" / "semantic-log-verified-dist-v1.json"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SHA1 = re.compile(r"^[0-9a-f]{40}$")
REQUIRED_PAYLOAD_PATHS = {
    "bin/caddy",
    "bin/cloudflared",
    "config/Caddyfile",
    "schemas/semantic-intent-v1.schema.json",
    "schemas/semantic-intent-result-v1.schema.json",
    "manifest.json",
    "SHA256SUMS",
}
REQUIRED_PROOFS = {
    "loopback_only",
    "static_refresh",
    "intent_route",
    "append_before_github",
    "restart_recovery",
    "ambiguous_effect_reconcile",
    "secret_scan_zero",
}


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest(value: dict[str, Any]) -> None:
    if value.get("kind") != "ops.semantic-log.verified-dist.v1":
        raise ValueError("unsupported manifest kind")
    if value.get("source", {}).get("repository") != "roccho-dev/ops":
        raise ValueError("source repository is not fixed")
    if not SHA1.fullmatch(value["source"]["commit"]) or not SHA1.fullmatch(value["source"]["tree"]):
        raise ValueError("source commit/tree must be exact Git identities")
    if not str(value["workflow"]["attestation_digest"]).startswith("sha256:"):
        raise ValueError("attestation digest is required")

    assets = value.get("assets")
    if not isinstance(assets, list) or {row.get("arch") for row in assets} != {"amd64", "arm64"}:
        raise ValueError("exact amd64 and arm64 assets are required")
    for asset in assets:
        if not SHA256.fullmatch(asset["asset_sha256"]) or asset["asset_bytes"] <= 0:
            raise ValueError("asset identity is incomplete")
        payload = asset["payload"]
        if payload["caddy"]["path"] != "bin/caddy" or payload["cloudflared"]["path"] != "bin/cloudflared":
            raise ValueError("runtime executable paths are fixed")
        if set(payload["caddy"]["modules"]) != {"http.handlers.file_server", "http.handlers.semantic_log"}:
            raise ValueError("Caddy module inventory is incomplete")
        files = payload.get("files")
        paths = {row.get("path") for row in files or []}
        if paths != REQUIRED_PAYLOAD_PATHS:
            raise ValueError(f"payload file inventory differs: {paths}")
        for row in files:
            if not SHA256.fullmatch(row["sha256"]) or row["bytes"] <= 0:
                raise ValueError("payload file identity is incomplete")

    runtime = value["runtime"]
    if runtime["request_schema"] != "semantic-intent.v1" or runtime["result_schema"] != "semantic-intent.result.v1":
        raise ValueError("wire schema identity differs")
    if not str(runtime["config_template"]["listen"]).startswith("127.0.0.1:"):
        raise ValueError("origin must be loopback-only")

    layout = value["data_layout"]
    if layout != {
        "schema": "semantic-log.data-layout.v1",
        "authoring_intent": "authoring-intent.jsonl",
        "projection_receipt": "projection-receipt.jsonl",
        "backward_read": ["semantic-log.data-layout.v1"],
        "rollback_read": ["semantic-log.data-layout.v1"],
    }:
        raise ValueError("persistent data compatibility is incomplete")

    if value["health"] != {"path": "/healthz", "expected_status": 200}:
        raise ValueError("health contract differs")
    for name in ("github", "tunnel"):
        credential = value["credentials"][name]
        if credential["delivery"] != "file" or not credential["capability"] or not credential["file_name"]:
            raise ValueError(f"{name} credential reference is incomplete")
    if value["proofs"].get("packaged_dist_run_id", 0) <= 0:
        raise ValueError("packaged-dist workflow proof is required")
    if any(value["proofs"].get(key) is not True for key in REQUIRED_PROOFS):
        raise ValueError("all packaged-dist proof flags must be true")

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                lowered = key.lower()
                if lowered in {"secret", "token", "credential_value", "password", "private_key"}:
                    raise ValueError(f"secret-bearing field is forbidden: {key}")
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)


class SemanticLogVerifiedDistContractTest(unittest.TestCase):
    def test_schema_is_closed_and_declares_exact_handoff(self) -> None:
        schema = load(SCHEMA)
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["kind"]["const"], "ops.semantic-log.verified-dist.v1")
        self.assertEqual(schema["properties"]["source"]["properties"]["repository"]["const"], "roccho-dev/ops")
        self.assertEqual(schema["properties"]["assets"]["minItems"], 2)
        self.assertEqual(schema["properties"]["assets"]["maxItems"], 2)

    def test_complete_example_is_envctl_ready_by_shape(self) -> None:
        validate_manifest(load(EXAMPLE))

    def test_missing_architecture_is_rejected(self) -> None:
        value = load(EXAMPLE)
        value["assets"] = value["assets"][:1]
        with self.assertRaisesRegex(ValueError, "amd64 and arm64"):
            validate_manifest(value)

    def test_missing_payload_file_is_rejected(self) -> None:
        value = copy.deepcopy(load(EXAMPLE))
        value["assets"][0]["payload"]["files"].pop()
        with self.assertRaisesRegex(ValueError, "file inventory"):
            validate_manifest(value)

    def test_false_packaged_proof_is_rejected(self) -> None:
        value = copy.deepcopy(load(EXAMPLE))
        value["proofs"]["append_before_github"] = False
        with self.assertRaisesRegex(ValueError, "proof flags"):
            validate_manifest(value)

    def test_secret_value_field_is_rejected(self) -> None:
        value = copy.deepcopy(load(EXAMPLE))
        value["credentials"]["github"]["token"] = "forbidden"
        with self.assertRaisesRegex(ValueError, "secret-bearing"):
            validate_manifest(value)


if __name__ == "__main__":
    unittest.main()
