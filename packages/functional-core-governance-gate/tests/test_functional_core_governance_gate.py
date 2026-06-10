from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from functional_core_governance_gate.adapter import load_declared_core_texts, load_manifest
from functional_core_governance_gate.core import SEMANTICS_PROFILE, evaluate_manifest

PKG = Path(__file__).resolve().parents[1]


class FunctionalCoreGovernanceGateTests(unittest.TestCase):
    def _evaluate_fixture(self, name: str):
        manifest_path = PKG / "tests" / "fixtures" / name / "manifest.json"
        manifest = load_manifest(manifest_path)
        texts = load_declared_core_texts(manifest, manifest_path, manifest_path.parent)
        return evaluate_manifest(manifest, texts)

    def test_good_fixture_passes(self):
        result = self._evaluate_fixture("good")
        self.assertTrue(result["ok"])
        self.assertEqual(result["semanticsProfile"], SEMANTICS_PROFILE)
        self.assertEqual(result["diagnosticCount"], 0)

    def test_hidden_effect_fails(self):
        result = self._evaluate_fixture("bad-hidden-effect")
        self.assertFalse(result["ok"])
        self.assertTrue(any(d["kind"] == "hidden-effect-in-core" for d in result["diagnostics"]))

    def test_adapter_dependency_fails(self):
        result = self._evaluate_fixture("bad-adapter-dependency")
        self.assertFalse(result["ok"])
        self.assertTrue(any(d["kind"] == "adapter-dependency-in-core" for d in result["diagnostics"]))

    def test_cli_emits_json_and_exit_codes(self):
        good_manifest = PKG / "tests" / "fixtures" / "good" / "manifest.json"
        good = subprocess.run(
            [sys.executable, "-m", "functional_core_governance_gate", "check", "--manifest", str(good_manifest), "--root", str(good_manifest.parent), "--json"],
            check=True,
            text=True,
            capture_output=True,
        )
        self.assertTrue(json.loads(good.stdout)["ok"])

        bad_manifest = PKG / "tests" / "fixtures" / "bad-hidden-effect" / "manifest.json"
        bad = subprocess.run(
            [sys.executable, "-m", "functional_core_governance_gate", "check", "--manifest", str(bad_manifest), "--root", str(bad_manifest.parent), "--json"],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(bad.returncode, 0)
        self.assertFalse(json.loads(bad.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
