from __future__ import annotations

import gzip
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


projector = load("projector", ROOT / "project_package_decisions.py")
composer = load("composer", ROOT / "compose_mobile_agent.py")
FIXTURE = ROOT / "fixtures/package-decisions.sample.jsonl"


class AtlasTests(unittest.TestCase):
    def test_projection_is_deterministic_and_has_three_views(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp) / "a"
            b = Path(tmp) / "b"
            first = projector.project(FIXTURE, a, "Package Decision Atlas — SAMPLE")
            second = projector.project(FIXTURE, b, "Package Decision Atlas — SAMPLE")
            self.assertEqual(first, second)
            for name in ("map", "relations", "history"):
                self.assertEqual((a / f"{name}.semantic.jsonl").read_bytes(), (b / f"{name}.semantic.jsonl").read_bytes())
            self.assertEqual(first["views"], {"map": "map/1", "relations": "graph/1", "history": "seq/1"})
            self.assertFalse(first["authority"])

    def test_projection_rejects_duplicate_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "bad.jsonl"
            line = FIXTURE.read_text(encoding="utf-8").splitlines()[0]
            source.write_text(line + "\n" + line + "\n", encoding="utf-8")
            with self.assertRaises(projector.ContractError):
                projector.project(source, Path(tmp) / "out", "bad")

    def test_composite_is_deterministic_and_embeds_exact_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.jsonl"
            source.write_text('{"sample":true}\n', encoding="utf-8")
            inputs = []
            for name in ("map", "relations", "history"):
                path = root / f"{name}.html"
                path.write_text(f"<!doctype html><title>{name}</title>", encoding="utf-8")
                inputs.append(path)
            one = root / "one.html"
            two = root / "two.html"
            r1 = composer.build(source, *inputs, one, "Atlas")
            r2 = composer.build(source, *inputs, two, "Atlas")
            self.assertEqual(one.read_bytes(), two.read_bytes())
            self.assertEqual(r1["output"]["sha256"], r2["output"]["sha256"])
            text = one.read_text(encoding="utf-8")
            payloads = json.loads(re.search(r'<script id="frame-payloads" type="application/json">(.*?)</script>', text, re.S).group(1))
            import base64
            for name, original in zip(("map", "relations", "history"), inputs):
                self.assertEqual(gzip.decompress(base64.b64decode(payloads[name])), original.read_bytes())
            self.assertFalse(r1["boundary"]["cutover"])


if __name__ == "__main__":
    unittest.main()
