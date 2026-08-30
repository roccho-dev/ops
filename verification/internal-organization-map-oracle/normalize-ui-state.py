#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

KEY_PACKAGE_LINKS = {
    "package:governance:repo-governance",
    "package:ui:semantic-map-profiles",
    "package:ui:semantic-map",
    "package:ops:ops-gov-package-output",
    "package:ops:artifact-assembly",
    "package:ops:gov-release-proxy",
}
PACKAGE_SUMMARY = "Observed directory; responsibility/conformance unknown."


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
    removed_set: list[str] = []
    removed_value: list[str] = []
    compacted_packages: list[str] = []
    removed_package_links: list[str] = []
    for number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line:
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise RuntimeError(f"row {number} is not an object")
        row_id = str(row.get("id", f"row:{number}"))
        if "set" in row and row.get("kind") != "set":
            removed_set.append(row_id)
            row.pop("set")
        if "value" in row:
            value = row["value"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                removed_value.append(row_id)
                row.pop("value")
        if row.get("type") == "region" and row_id.startswith("package:"):
            row["summary"] = PACKAGE_SUMMARY
            compacted_packages.append(row_id)
            if row_id not in KEY_PACKAGE_LINKS and "href" in row:
                row.pop("href")
                removed_package_links.append(row_id)
        if "set" in row and row.get("kind") != "set":
            raise RuntimeError(f"invalid set field remains at row {number}")
        if "value" in row:
            value = row["value"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise RuntimeError(f"invalid numeric value remains at row {number}")
        rows.append(row)

    output = "".join(canonical(row) + "\n" for row in rows).encode("utf-8")
    args.path.write_bytes(output)
    receipt = {
        "schema": "ops.internalOrganizationMapUiStateNormalization/3",
        "status": "PASS",
        "authority": False,
        "semanticIdsChanged": False,
        "labelsChanged": False,
        "relationsChanged": False,
        "removedInvalidSetFields": removed_set,
        "removedInvalidValues": removed_value,
        "compactedPackageSummaries": compacted_packages,
        "removedNonkeyPackageLinks": removed_package_links,
        "retainedKeyPackageLinks": sorted(KEY_PACKAGE_LINKS),
        "removedSetCount": len(removed_set),
        "removedValueCount": len(removed_value),
        "compactedPackageCount": len(compacted_packages),
        "removedPackageLinkCount": len(removed_package_links),
        "rowCount": len(rows),
        "bytes": len(output),
        "sha256": hashlib.sha256(output).hexdigest(),
    }
    print(canonical(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
