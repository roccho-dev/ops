#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from urllib.parse import urlsplit

CASES = (
    ("graph", "graph/1", ["Product delivery graph", "顧客要求", "採否判断", "検証証跡"]),
    ("map", "map/1", ["AI図編集の例", "User", "App", "AI"]),
    ("seq", "seq/1", ["Decision review sequence", "Human", "Agent", "Append"]),
)


def fail(message: str) -> None:
    raise RuntimeError(f"mobile-agent-url-build: {message}")


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        fail("usage: build_urls.py CARRIER_ROOT BASE OUTPUT_JSON")
    root = pathlib.Path(argv[1]).resolve()
    base = argv[2]
    output = pathlib.Path(argv[3]).resolve()
    manifest = json.loads((root / "carrier-manifest.json").read_text(encoding="utf-8"))
    rows = []
    for kind, preset, labels in CASES:
        receipt_path = output.parent / f"{kind}-compile.json"
        subprocess.run(
            [
                "node",
                str(root / manifest["runtime"]["compiler"]),
                str(root / manifest["fixtures"][kind]),
                preset,
                base,
                str(receipt_path),
            ],
            cwd=root,
            check=True,
        )
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("status") != "PASS" or receipt.get("preset") != preset or receipt.get("roundTripExact") is not True:
            fail(f"{kind}: compile receipt")
        url = receipt["url"]
        parsed_base, parsed_url = urlsplit(base), urlsplit(url)
        if (parsed_url.scheme, parsed_url.netloc) != (parsed_base.scheme, parsed_base.netloc):
            fail(f"{kind}: origin")
        if not parsed_url.path.rstrip("/").endswith("/app") or not parsed_url.fragment.startswith("smap="):
            fail(f"{kind}: URL shape")
        rows.append(
            {
                "id": kind,
                "labels": labels,
                "view": receipt["view"],
                "url": url,
                "urlLength": len(url),
                "stateHash": receipt["stateHash"],
                "sourceJsonlSha256": receipt["input"]["sha256"],
                "roundTripExact": True,
            }
        )
    value = {"schema": "ops.mobileAgentPresetUrls/2", "status": "PASS", "authority": False, "base": base, "cases": rows}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "urls": {row["id"]: row["url"] for row in rows}}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
