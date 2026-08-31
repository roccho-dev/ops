#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser


def invariant(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(f"mobile-agent-migration: {message}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ImportMapParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._capture = False
        self._parts: list[str] = []
        self.maps: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "script" and dict(attrs).get("type") == "importmap":
            self._capture = True
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capture:
            text = "".join(self._parts).strip()
            invariant(text != "", "empty import map")
            self.maps.append(json.loads(text))
            self._capture = False
            self._parts = []


def decode_data_module(value: str, specifier: str) -> str:
    invariant(value.startswith("data:text/javascript"), f"{specifier}: module is not an embedded JavaScript data URL")
    header, payload = value.split(",", 1)
    if ";base64" in header:
        data = base64.b64decode(payload, validate=True)
    else:
        data = urllib.parse.unquote_to_bytes(payload)
    return data.decode("utf-8")


SPECIFIER = re.compile(r"(?P<quote>['\"])semantic:packages/(?P<target>[^'\"]+)(?P=quote)")


def package_dependencies(source: str) -> set[str]:
    return {match.group("target") for match in SPECIFIER.finditer(source)}


def rewrite_package_specifiers(source: str, current: pathlib.PurePosixPath) -> str:
    def replace(match: re.Match[str]) -> str:
        target = pathlib.PurePosixPath(match.group("target"))
        relative = pathlib.PurePosixPath(os.path.relpath(str(target), str(current.parent))).as_posix()
        if not relative.startswith("."):
            relative = f"./{relative}"
        quote = match.group("quote")
        return f"{quote}{relative}{quote}"

    return SPECIFIER.sub(replace, source)


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "ops-mobile-agent-carrier-migration/2", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        invariant(response.status == 200, f"{url}: HTTP {response.status}")
        return response.read()


def main(argv: list[str]) -> int:
    invariant(len(argv) == 6, "usage: migrate_projection.py EXPECTED BASE DIST MANIFEST RECEIPT")
    expected_path = pathlib.Path(argv[1]).resolve()
    base = argv[2].rstrip("/") + "/"
    dist = pathlib.Path(argv[3]).resolve()
    manifest_path = pathlib.Path(argv[4]).resolve()
    receipt_path = pathlib.Path(argv[5]).resolve()
    invariant(expected_path.is_file(), "expected manifest missing")
    invariant(not dist.exists(), "output dist already exists")
    dist.mkdir(parents=True)

    required_markers = ("graph/1", "map/1", "seq/1", "maxgraph")
    observations: list[dict] = []
    app = None
    app_text = None
    app_source_url = None
    for relative in ("app", "app/", "app/index.html", "app/example", "app/example/", "app/example/index.html"):
        url = urllib.parse.urljoin(base, relative)
        try:
            candidate = fetch(url)
            text = candidate.decode("utf-8")
        except Exception as error:
            observations.append({"url": url, "error": str(error)})
            continue
        present = [marker for marker in required_markers if marker.lower() in text.lower()]
        observations.append({"url": url, "bytes": len(candidate), "sha256": sha256(candidate), "markers": present})
        if len(candidate) > 1_500_000 and len(present) == len(required_markers):
            app = candidate
            app_text = text
            app_source_url = url
            break
    invariant(app is not None and app_text is not None and app_source_url is not None, f"existing preset App not found: {json.dumps(observations, sort_keys=True)}")

    app_path = dist / "app/index.html"
    app_path.parent.mkdir(parents=True, exist_ok=True)
    app_path.write_bytes(app)

    parser = ImportMapParser()
    parser.feed(app_text)
    invariant(len(parser.maps) == 1, f"expected one import map, got {len(parser.maps)}")
    imports = parser.maps[0].get("imports")
    invariant(isinstance(imports, dict), "import map imports missing")

    prefix = "semantic:packages/"
    roots = ("protocol/index.js", "transport/index.js")
    pending = list(roots)
    selected: dict[str, str] = {}
    while pending:
        relative = pending.pop()
        if relative in selected:
            continue
        specifier = prefix + relative
        invariant(specifier in imports, f"embedded module missing: {specifier}")
        source = decode_data_module(imports[specifier], specifier)
        selected[relative] = source
        for dependency in sorted(package_dependencies(source)):
            if dependency not in selected:
                pending.append(dependency)

    modules_root = dist / "protocol/v3/modules/packages"
    for relative, source in sorted(selected.items()):
        current = pathlib.PurePosixPath(relative)
        rewritten = rewrite_package_specifiers(source, current)
        invariant("semantic:packages/" not in rewritten, f"unresolved package import in {relative}")
        target = modules_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rewritten, encoding="utf-8")

    codec = dist / "protocol/v3/codec.mjs"
    codec.parent.mkdir(parents=True, exist_ok=True)
    codec.write_text(
        "export * from './modules/packages/protocol/index.js';\n"
        "export * from './modules/packages/transport/index.js';\n",
        encoding="utf-8",
    )

    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    invariant(expected.get("schema") == "semantic-map-build-artifact/1", "unexpected source manifest schema")

    rows = []
    for path in sorted(item for item in dist.rglob("*") if item.is_file()):
        data = path.read_bytes()
        rows.append({
            "path": path.relative_to(dist).as_posix(),
            "bytes": len(data),
            "sha256": sha256(data),
        })
    invariant(any(row["path"] == "app/index.html" for row in rows), "App missing from Carrier")
    invariant(any(row["path"] == "protocol/v3/codec.mjs" for row in rows), "codec missing from Carrier")

    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    tree_digest = "sha256:" + sha256(canonical)
    manifest = {
        "schema": "ops.mobileAgentMigratedProjection/2",
        "authority": False,
        "status": "PASS",
        "sourceBase": base,
        "sourceAppUrl": app_source_url,
        "sourceObservations": observations,
        "sourceExpectedSchema": expected["schema"],
        "distTreeDigest": tree_digest,
        "files": rows,
        "app": {"bytes": len(app), "sha256": sha256(app), "sourceUrl": app_source_url},
        "codecProjection": {
            "source": "embedded import map",
            "entrypoints": list(roots),
            "moduleCount": len(selected),
            "implementationRewritten": False,
            "specifierProjectionOnly": True,
        },
        "presets": ["graph/1", "map/1", "seq/1"],
        "sourceCloneUsed": False,
        "sourceBuildUsed": False,
    }
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    receipt = {
        "schema": "ops.mobileAgentMigrationReceipt/2",
        "status": "PASS",
        "authority": False,
        "distTreeDigest": tree_digest,
        "files": len(rows),
        "bytes": sum(row["bytes"] for row in rows),
        "app": manifest["app"],
        "codecProjection": manifest["codecProjection"],
    }
    receipt_path.write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
