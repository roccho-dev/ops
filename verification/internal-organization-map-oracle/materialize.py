#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import pathlib
import re

VISUAL_ORACLE_ATTACHMENT = "260830094145.6a8d6f71-cbac-83ee-ad15-566201f495bf.html"
VISUAL_ORACLE_SHA256 = "82b9d61c3e8076a8e5a7fa67b5495ef666125956da0b43af7988984f67897355"
UI_REF = "59ba7c0370de72a790c8828994d5b726ce4cd944"
UI_BUILDER = "packages/semantic-map/scripts/build-browser-example.mjs"
MAP_ID = "urn:uuid:33100000-0000-4000-8000-000000000001"
TITLE = "Internal Organization Semantic Map — #331 current chain"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


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
    for prefix, expected in {
        "package:ops:": 49,
        "package:ui:": 13,
        "package:governance:": 2,
    }.items():
        actual = sum(region_id.startswith(prefix) for region_id in region_ids)
        require(actual == expected, f"{prefix} count differs: {actual} != {expected}")
    require(any(row.get("type") == "relation" and row.get("kind") == "blocks" for row in rows), "blocking relation missing")
    return raw, rows


def replace_script(document: str, element_id: str, content: str) -> str:
    pattern = re.compile(rf'(<script[^>]*\bid="{re.escape(element_id)}"[^>]*>)(.*?)(</script>)', re.S)
    updated, count = pattern.subn(lambda match: match.group(1) + content + match.group(3), document, count=1)
    require(count == 1, f"missing or duplicate script #{element_id}")
    return updated


def verify_generated_shell(document: str) -> None:
    required_markers = [
        '<script type="importmap">',
        'id="semantic-page-config"',
        'id="semantic-initial-state"',
        'semantic:authoring/index.js',
        'id="graph-container"',
        'id="pattern-select"',
        'map/1',
        'graph/1',
        'seq/1',
    ]
    missing = [marker for marker in required_markers if marker not in document]
    require(not missing, f"generated UI shell markers missing: {missing}")
    require("@INLINE_IMPORTMAP" not in document, "unresolved import-map marker")
    require("@PAGE_CONFIG" not in document, "unresolved page-config marker")
    require("@INITIAL_DOCUMENT" not in document, "unresolved initial-document marker")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rows", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--oracle-file", type=pathlib.Path, required=True)
    parser.add_argument("--ui-ref", required=True)
    args = parser.parse_args()

    require(args.ui_ref == UI_REF, f"UI ref differs: {args.ui_ref} != {UI_REF}")
    oracle = args.oracle_file.read_bytes()
    document = oracle.decode("utf-8")
    verify_generated_shell(document)
    rows_raw, rows = read_rows(args.rows)

    config = {
        "route": "app",
        "mode": "example",
        "title": TITLE,
        "mapId": MAP_ID,
        "view": {"pattern": "map/1"},
        "artifactStore": None,
    }
    document, title_count = re.subn(r"<title>.*?</title>", f"<title>{html.escape(TITLE)}</title>", document, count=1, flags=re.S)
    require(title_count == 1, "document title missing")
    document = replace_script(document, "semantic-page-config", canonical(config))
    document = replace_script(document, "semantic-initial-state", rows_raw.decode("utf-8").rstrip("\n"))

    receipt_base = {
        "schema": "ops.internalOrganizationMapMaterialize/2",
        "status": "PASS",
        "authority": False,
        "claimCeiling": "VISUAL_EVALUATION_ONLY",
        "visualOracle": {
            "attachment": VISUAL_ORACLE_ATTACHMENT,
            "sha256": VISUAL_ORACLE_SHA256,
            "role": "appearance-and-interaction-goal-only",
        },
        "generatedShell": {
            "repository": "roccho-dev/ui",
            "ref": UI_REF,
            "builder": UI_BUILDER,
            "sha256": sha256(oracle),
            "bytes": len(oracle),
        },
        "input": {"path": args.rows.name, "sha256": sha256(rows_raw), "bytes": len(rows_raw), "rows": len(rows)},
        "projection": {
            "mapId": MAP_ID,
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
    receipt_json = canonical(receipt_base).replace("</", "<\\/")
    marker = f'<script id="organization-projection-receipt" type="application/json">{receipt_json}</script>\n'
    require("</body>" in document, "body close marker missing")
    document = document.replace("</body>", marker + "</body>", 1)
    output_bytes = document.encode("utf-8")
    receipt = {**receipt_base, "output": {"path": "index.html", "sha256": sha256(output_bytes), "bytes": len(output_bytes)}}

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "index.html").write_bytes(output_bytes)
    (args.output / "organization-current.jsonl").write_bytes(rows_raw)
    (args.output / "materialize-receipt.json").write_text(canonical(receipt) + "\n", encoding="utf-8", newline="\n")
    print(canonical(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
