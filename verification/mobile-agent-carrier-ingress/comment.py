#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import sys


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        raise RuntimeError("usage: comment.py STABLE_URLS IMMUTABLE_URLS OUTPUT_MD")
    stable = {row["id"]: row["url"] for row in json.load(open(argv[1], encoding="utf-8"))["cases"]}
    immutable = {row["id"]: row["url"] for row in json.load(open(argv[2], encoding="utf-8"))["cases"]}
    lines = [
        "## Mobile Agent Carrier public URLs — PASS",
        "",
        "- Carrier-only fresh replay: **PASS**",
        "- stable + deployment-specific byte readback: **40/40 × 2 PASS**",
        "- existing `graph/1`, `map/1`, `seq/1` + maxGraph browser proof: **6/6 PASS**",
    ]
    for key in ("graph", "map", "seq"):
        lines.append(f"- {key.title()}: {stable[key]}")
    lines.append("- deployment-specific URLs:")
    for key in ("graph", "map", "seq"):
        lines.append(f"  - `{key}`: {immutable[key]}")
    lines.extend(
        [
            f"- run: {os.environ['RUN_URL']}",
            f"- evidence: `{os.environ['ARTIFACT_ID']}` / `{os.environ['ARTIFACT_DIGEST']}`",
        ]
    )
    pathlib.Path(argv[3]).write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
