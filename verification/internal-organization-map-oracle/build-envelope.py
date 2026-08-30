#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

MAP_ID = "urn:uuid:33100000-0000-4000-8000-000000000001"


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rows", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    raw = args.rows.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw:
        raise RuntimeError("JSONL must be UTF-8 without BOM or CR bytes")
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line]
    if not rows or rows[0].get("type") != "meta":
        raise RuntimeError("first JSONL row must be meta")

    state_hash = "sha256:" + hashlib.sha256(canonical(rows).encode("utf-8")).hexdigest()
    decision = {
        "operations": [{"mapId": MAP_ID, "records": rows, "type": "CreateMap"}],
        "parent": None,
        "schema": "semantic-map-decision/2",
        "stateHash": state_hash,
    }
    envelope = {
        "schema": "semantic-map-envelope/3",
        "log": canonical(decision) + "\n",
        "proposal": None,
        "view": {"pattern": "map/1"},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(envelope, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(canonical({
        "schema": "ops.internalOrganizationMapEnvelopeBuild/1",
        "status": "PASS",
        "authority": False,
        "mapId": MAP_ID,
        "rowCount": len(rows),
        "stateHash": state_hash,
        "outputSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
