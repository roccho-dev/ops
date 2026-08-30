#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    args = parser.parse_args()

    raw = args.path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw:
        raise RuntimeError("JSONL must be UTF-8 without BOM or CR bytes")

    rows: list[dict[str, object]] = []
    removed: list[str] = []
    for number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line:
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise RuntimeError(f"row {number} is not an object")
        if "set" in row and row.get("kind") != "set":
            removed.append(str(row.get("id", f"row:{number}")))
            row.pop("set")
        if "set" in row and row.get("kind") != "set":
            raise RuntimeError(f"invalid set field remains at row {number}")
        rows.append(row)

    output = "".join(canonical(row) + "\n" for row in rows).encode("utf-8")
    args.path.write_bytes(output)
    receipt = {
        "schema": "ops.internalOrganizationMapUiStateNormalization/1",
        "status": "PASS",
        "authority": False,
        "removedInvalidSetFields": removed,
        "removedCount": len(removed),
        "rowCount": len(rows),
        "sha256": hashlib.sha256(output).hexdigest(),
    }
    print(canonical(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
