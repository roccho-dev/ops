#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import re
import sys


def main(argv: list[str]) -> int:
    if len(argv) != 6:
        raise RuntimeError("usage: normalize_comments.py INPUT OUTPUT DIAGNOSTIC OWNER PREFIX")
    source = json.loads(pathlib.Path(argv[1]).read_text(encoding="utf-8"))
    output = pathlib.Path(argv[2])
    diagnostic_path = pathlib.Path(argv[3])
    owner = argv[4]
    prefix = argv[5]
    header_pattern = re.compile(rf"^{re.escape(prefix)} ([0-9]{{2}})/10$")
    normalized: list[dict] = []
    diagnostics: list[dict] = []
    for comment in source:
        body = (comment.get("body") or "").replace("\r\n", "\n").strip()
        lines = body.split("\n")
        first = lines[0] if lines else ""
        login = comment.get("user", {}).get("login")
        match = header_pattern.fullmatch(first)
        payload_raw = "\n".join(lines[1:]) if len(lines) > 1 else ""
        payload = re.sub(r"\s+", "", payload_raw)
        invalid = re.sub(r"[A-Za-z0-9+/=]", "", payload)
        row = {
            "id": comment.get("id"),
            "login": login,
            "header": first,
            "bodyChars": len(body),
            "lines": len(lines),
            "payloadChars": len(payload),
            "headerMatch": bool(match),
            "ownerMatch": login == owner,
            "invalidChars": len(invalid),
            "payloadTail": payload[-16:],
        }
        diagnostics.append(row)
        if login != owner or not match or invalid:
            continue
        clone = dict(comment)
        clone["body"] = f"{first}\n{payload}"
        normalized.append(clone)
    output.write_text(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    diagnostic_path.write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "comments": len(source), "normalized": len(normalized), "diagnostics": diagnostics}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
