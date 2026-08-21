#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import sys
import urllib.parse
import urllib.request


def invariant(value, message):
    if not value:
        raise RuntimeError(f"mobile-agent-preset-bootstrap: {message}")


def main(argv):
    invariant(len(argv) == 5, "expected expected.json base out receipt")
    expected_path = pathlib.Path(argv[1]).resolve()
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    base = argv[2].rstrip("/") + "/"
    out = pathlib.Path(argv[3]).resolve()
    receipt = pathlib.Path(argv[4]).resolve()
    overlay_root = expected_path.parent / "bootstrap-overlay"

    invariant(expected["schema"] == "semantic-map-build-artifact/1", "expected schema")
    invariant(not out.exists(), "out exists")
    out.mkdir(parents=True)

    rows = []
    mismatches = []
    for rel, spec in sorted(expected["files"].items()):
        invariant(".." not in pathlib.PurePosixPath(rel).parts and not rel.startswith("/"), f"unsafe path {rel}")
        overlay = overlay_root / rel
        if overlay.is_file():
            data = overlay.read_bytes()
            observed = overlay.relative_to(expected_path.parent).as_posix()
            source_kind = "checked-in-exact-overlay"
        else:
            url = urllib.parse.urljoin(base, rel)
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "mobile-agent-preset-bootstrap/2", "Cache-Control": "no-cache"},
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = response.read()
                    observed = response.geturl()
            except Exception as error:
                mismatches.append({"path": rel, "error": str(error), "sourceKind": "verified-existing-public-projection"})
                continue
            source_kind = "verified-existing-public-projection"

        observed_sha = hashlib.sha256(data).hexdigest()
        if len(data) != spec["bytes"] or observed_sha != spec["sha256"]:
            mismatches.append({
                "path": rel,
                "expectedBytes": spec["bytes"],
                "observedBytes": len(data),
                "expectedSha256": spec["sha256"],
                "observedSha256": observed_sha,
                "source": observed,
                "sourceKind": source_kind,
            })
            continue

        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        rows.append({
            "path": rel,
            "bytes": len(data),
            "sha256": observed_sha,
            "source": observed,
            "sourceKind": source_kind,
        })

    if mismatches:
        raise RuntimeError(
            "mobile-agent-preset-bootstrap: mismatches: "
            + json.dumps(mismatches, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        )

    actual = sorted(path.relative_to(out).as_posix() for path in out.rglob("*") if path.is_file())
    invariant(actual == sorted(expected["files"]), "inventory mismatch")
    canonical = json.dumps(
        [{"path": row["path"], "bytes": row["bytes"], "sha256": row["sha256"]} for row in rows],
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    overlays = [row["path"] for row in rows if row["sourceKind"] == "checked-in-exact-overlay"]
    value = {
        "schema": "ops.mobileAgentPresetBootstrapReceipt/2",
        "status": "PASS",
        "authority": False,
        "sourceBase": base,
        "distTreeDigest": "sha256:" + hashlib.sha256(canonical).hexdigest(),
        "overlays": overlays,
        "publicFiles": len(rows) - len(overlays),
        "files": rows,
    }
    receipt.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
    print(json.dumps({
        "status": "PASS",
        "files": len(rows),
        "publicFiles": value["publicFiles"],
        "overlays": overlays,
        "distTreeDigest": value["distTreeDigest"],
    }))


if __name__ == "__main__":
    main(sys.argv)
