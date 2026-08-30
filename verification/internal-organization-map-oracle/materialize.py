#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import pathlib
import re
import urllib.request

ORACLE_URL = "https://github.com/user-attachments/files/31609275/260830094145.6a8d6f71-cbac-83ee-ad15-566201f495bf.html"
ORACLE_SHA256 = "82b9d61c3e8076a8e5a7fa67b5495ef666125956da0b43af7988984f67897355"
TITLE = "Internal Organization Semantic Map — #331 current chain"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def download(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "roccho-ops-internal-organization-map/1", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        require(response.status == 200, f"oracle HTTP {response.status}")
        return response.read()


def read_rows(path: pathlib.Path) -> tuple[bytes, list[dict[str, object]]]:
    raw = path.read_bytes()
    require(not raw.startswith(b"\xef\xbb\xbf"), "JSONL BOM is forbidden")
    require(b"\r" not in raw, "JSONL CR bytes are forbidden")
    rows: list[dict[str, object]] = []
    for number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line:
            continue
        value = json.loads(line)
        require(isinstance(value, dict), f"JSONL row {number} is not an object")
        rows.append(value)
    require(rows and rows[0].get("type") == "meta", "first JSONL row must be meta")
    ids = [str(row["id"]) for row in rows if row.get("type") in {"region", "relation"}]
    require(len(ids) == len(set(ids)), "duplicate semantic ID")
    region_ids = {str(row["id"]) for row in rows if row.get("type") == "region"}
    root = str(rows[0].get("root", ""))
    require(root in region_ids, "meta root is missing")
    for row in rows:
        if row.get("type") == "region":
            parent = row.get("parent")
            require(parent is None or str(parent) in region_ids, f"dangling parent: {row.get('id')}")
        elif row.get("type") == "relation":
            require(str(row.get("from")) in region_ids, f"dangling relation.from: {row.get('id')}")
            require(str(row.get("to")) in region_ids, f"dangling relation.to: {row.get('id')}")
    required = {
        "repo:adrs", "repo:governance", "repo:policy", "repo:deploy", "repo:ui", "repo:ops",
        "decision:adrs#331", "decision-pr:adrs#332", "work:governance#210",
        "package:governance:repo-governance", "package:ui:semantic-map-profiles",
        "package:ui:semantic-map", "package:ops:ops-gov-package-output",
        "package:ops:artifact-assembly", "package:ops:gov-release-proxy",
        "effect:ops:staging-deploy", "evidence:ops:byte-readback",
        "evidence:ops:browser-readback", "gap:accepted-record",
        "gap:complete-universe", "gap:terminal-closure", "gap:owner-wide-universe",
    }
    require(required <= region_ids, f"required semantic IDs missing: {sorted(required - region_ids)}")
    prefix_counts = {
        "package:ops:": 49,
        "package:ui:": 13,
        "package:governance:": 2,
    }
    for prefix, expected in prefix_counts.items():
        actual = sum(region_id.startswith(prefix) for region_id in region_ids)
        require(actual == expected, f"{prefix} count differs: {actual} != {expected}")
    require(any(row.get("type") == "relation" and row.get("kind") == "blocks" for row in rows), "blocking relation missing")
    return raw, rows


def replace_script(document: str, element_id: str, content: str) -> str:
    pattern = re.compile(rf'(<script[^>]*\bid="{re.escape(element_id)}"[^>]*>)(.*?)(</script>)', re.S)
    updated, count = pattern.subn(lambda match: match.group(1) + content + match.group(3), document, count=1)
    require(count == 1, f"missing or duplicate script #{element_id}")
    return updated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rows", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--oracle-file", type=pathlib.Path)
    args = parser.parse_args()

    oracle = args.oracle_file.read_bytes() if args.oracle_file else download(ORACLE_URL)
    require(sha256(oracle) == ORACLE_SHA256, "visual oracle digest mismatch")
    rows_raw, rows = read_rows(args.rows)

    document = oracle.decode("utf-8")
    config = {
        "mode": "example",
        "title": TITLE,
        "mapId": "semantic-map:internal-organization-current:adrs-331",
        "view": {"pattern": "map/1", "frame": {"bbox": [0, 0, 6900, 6200], "viewport": [1600, 900]}},
    }
    document, title_count = re.subn(r"<title>.*?</title>", f"<title>{html.escape(TITLE)}</title>", document, count=1, flags=re.S)
    require(title_count == 1, "document title missing")
    document = replace_script(document, "semantic-page-config", canonical(config))
    document = replace_script(document, "semantic-initial-state", rows_raw.decode("utf-8").rstrip("\n"))

    receipt_base = {
        "schema": "ops.internalOrganizationMapMaterialize/1",
        "status": "PASS",
        "authority": False,
        "claimCeiling": "VISUAL_EVALUATION_ONLY",
        "oracle": {"url": ORACLE_URL, "sha256": ORACLE_SHA256, "bytes": len(oracle)},
        "input": {"path": args.rows.name, "sha256": sha256(rows_raw), "bytes": len(rows_raw), "rows": len(rows)},
        "projection": {
            "mapId": config["mapId"],
            "title": TITLE,
            "patterns": ["map/1", "graph/1", "seq/1"],
            "regionCount": sum(row.get("type") == "region" for row in rows),
            "relationCount": sum(row.get("type") == "relation" for row in rows),
            "blockingGapCount": sum(row.get("type") == "region" and str(row.get("id", "")).startswith("gap:") for row in rows),
        },
        "boundary": {
            "acceptedMeaningChanged": False,
            "generatedProjectionAuthority": False,
            "productionCutover": False,
            "unknownsHidden": False,
        },
    }
    receipt_json = canonical(receipt_base)
    marker = f'<script id="organization-projection-receipt" type="application/json">{receipt_json}</script>\n'
    document = document.replace("</body>", marker + "</body>", 1)
    output_bytes = document.encode("utf-8")
    receipt = {**receipt_base, "output": {"path": "index.html", "sha256": sha256(output_bytes), "bytes": len(output_bytes)}}

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "index.html").write_bytes(output_bytes)
    (args.output / "organization-current.jsonl").write_bytes(rows_raw)
    (args.output / "materialize-receipt.json").write_text(canonical(receipt) + "\n", encoding="utf-8")
    print(canonical(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
