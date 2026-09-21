#!/usr/bin/env python3
import json
import sys
from urllib.parse import urlparse

SCHEMA = "ops.deploy-effect.receipt/1"
TARGETS = {"preview", "production"}

def fail(message):
    raise SystemExit(message)

def load_one(stream):
    lines = [line.strip() for line in stream if line.strip()]
    if len(lines) != 1:
        fail("receipt must contain exactly one non-empty JSON line")
    try:
        value = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON receipt: {exc}")
    if not isinstance(value, dict):
        fail("receipt must be an object")
    return value

def verify(receipt):
    required = {
        "schema", "authority", "status", "provider", "target",
        "sourceRevision", "providerDeploymentId", "deploymentUrl", "probe",
    }
    missing = sorted(required - receipt.keys())
    if missing:
        fail("missing fields: " + ",".join(missing))
    if receipt["schema"] != SCHEMA:
        fail("unexpected schema")
    if receipt["authority"] is not False:
        fail("deployment receipt must be non-authority")
    if receipt["status"] != "PASS":
        fail("success receipt must be PASS")
    if receipt["target"] not in TARGETS:
        fail("target must be preview or production")
    for key in ("provider", "sourceRevision", "providerDeploymentId"):
        if not isinstance(receipt[key], str) or not receipt[key].strip():
            fail(f"{key} must be a non-empty string")
    url = receipt["deploymentUrl"]
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme != "https" or not parsed.netloc:
        fail("deploymentUrl must be an https URL")
    probe = receipt["probe"]
    if not isinstance(probe, dict):
        fail("probe must be an object")
    path = probe.get("path")
    status = probe.get("status")
    if not isinstance(path, str) or not path.startswith("/"):
        fail("probe.path must begin with /")
    if not isinstance(status, int) or status < 200 or status > 299:
        fail("probe.status must be 2xx")
    return receipt

def main():
    if len(sys.argv) > 2:
        fail("usage: verify.py [receipt.jsonl]")
    if len(sys.argv) == 2:
        with open(sys.argv[1], encoding="utf-8") as stream:
            receipt = load_one(stream)
    else:
        receipt = load_one(sys.stdin)
    verify(receipt)

if __name__ == "__main__":
    main()
