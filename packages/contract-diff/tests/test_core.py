"""Finite fixture evidence, never real provider or organization admission."""
import copy
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core import COLLECTIONS, InputError, canonical, compare, digest, load_json, row_digest


def source(label):
    return {"repository": "fixture/repo", "revision": "a" * 40,
            "path": label + ".json", "digest": digest(label)}


def fixture():
    profile = [{"role": "projection", "operation": "secret.put", "readback": True, "grade": "fixture"}]
    values = {"obligation_digest": digest("accepted-meaning"), "capability": "jev-api",
              "consumer": "roccho-dev/ops", "stage": "dev",
              "target": {"provider": "cloudflare-workers", "resource": "voice-ui", "account": None},
              "slot": "JEV_API_KEY", "binding": "jev-api", "profile": profile}
    packet = {"kind": "contractDiffInput.v1"}
    for name in COLLECTIONS:
        packet[name] = {"source": source(name), "rows": []}
    packet["required"]["rows"] = [{"id": "fixture.jev", "contract": copy.deepcopy(values)}]
    packet["provided"]["rows"] = copy.deepcopy(packet["required"]["rows"])
    packet["observations"]["rows"] = [{"id": "fixture.jev", "attempt": "run-1", "epoch": "epoch-1", "refs": {"projection": "proof-1"}}]
    packet["receipts"]["rows"] = [{"id": "proof-1", "obligation_id": "fixture.jev", "role": "projection",
        "attempt": "run-1", "epoch": "epoch-1", "source": copy.deepcopy(packet["provided"]["source"]),
        "target": copy.deepcopy(values["target"]), "slot": "JEV_API_KEY", "operation": "secret.put",
        "status": "PASS", "readback": "PASS", "grade": "fixture"}]
    admission = {"kind": "contractDiffAdmission.v1", "scope": {"id": "ops-dev", "authority": source("authority"),
                  "epoch": "epoch-1", "allow_empty": False, "grade": "fixture", "excluded_ids": []},
                 "universe": [{"id": "fixture.jev", "obligation_digest": values["obligation_digest"], "profile": profile}],
                 "inventory": {}, "evidence": {}}
    select_inputs(packet, admission)
    admission["evidence"] = {r["id"]: digest(r) for r in packet["receipts"]["rows"]}
    return packet, admission


def select_inputs(packet, admission):
    """Test-only trusted acquisition. Production acquisition has a different owner."""
    admission["inventory"] = {name: {"source": copy.deepcopy(packet[name]["source"]),
        "rows_digest": row_digest(packet[name]["rows"]), "count": len(packet[name]["rows"])} for name in COLLECTIONS}


def findings(result):
    return {(r["kind"], r["field"]) for r in result["findings"]}


class ContractDiffTests(unittest.TestCase):
    def test_v01_same_contract_and_admitted_evidence(self):
        p, a = fixture()
        result = compare(p, a)
        self.assertEqual(result["status"], "CLOSED")
        self.assertFalse(result["authority"])
        self.assertEqual(result["grade"], "fixture")

    def test_v02_supply_is_distinct_from_evidence(self):
        for collection, expected in [("provided", "SUPPLY_MISSING"), ("required", "SUPPLY_EXTRA"), ("receipts", "EVIDENCE_MISSING")]:
            with self.subTest(collection=collection):
                p, a = fixture(); p[collection]["rows"] = []; select_inputs(p, a)
                self.assertIn(expected, {r["kind"] for r in compare(p, a)["findings"]})

    def test_v03_workers_pages_is_one_target_drift(self):
        p, a = fixture(); p["provided"]["rows"][0]["contract"]["target"]["provider"] = "cloudflare-pages"; select_inputs(p, a)
        result = compare(p, a)
        self.assertIn(("CONTRACT_DRIFT", "target"), findings(result))
        self.assertFalse(any(r["kind"].startswith("SUPPLY_") for r in result["findings"]))

    def test_v04_compare_each_contract_field(self):
        for field in ("capability", "consumer", "stage", "slot", "binding", "obligation_digest"):
            with self.subTest(field=field):
                p, a = fixture(); p["provided"]["rows"][0]["contract"][field] = digest("different") if field == "obligation_digest" else "different"
                select_inputs(p, a)
                self.assertIn(("CONTRACT_DRIFT", field), findings(compare(p, a)))

    def test_v04_unrelated_authority_revision_is_not_semantic_drift(self):
        p, a = fixture(); a["scope"]["authority"]["revision"] = "b" * 40
        self.assertEqual(compare(p, a)["status"], "CLOSED")

    def test_v05_unknown_id_is_not_guessed(self):
        p, a = fixture(); p["provided"]["rows"][0]["id"] = "renamed"; select_inputs(p, a)
        self.assertEqual(compare(p, a)["status"], "INVALID")

    def test_v06_zero_requirements_has_normal_empty_evidence(self):
        p, a = fixture()
        for name in ("required", "provided"):
            p[name]["rows"][0]["contract"]["profile"] = []
        a["universe"][0]["profile"] = []
        p["observations"]["rows"] = []; p["receipts"]["rows"] = []; a["evidence"] = {}
        select_inputs(p, a)
        self.assertEqual(compare(p, a)["status"], "CLOSED")
        self.assertEqual(compare(p, a)["grade"], "fixture")

    def test_v06_no_effect_profile_does_not_require_effect(self):
        p, a = fixture()
        for name in ("required", "provided"):
            p[name]["rows"][0]["contract"]["profile"][0].update(operation=None, readback=False)
        a["universe"][0]["profile"][0].update(operation=None, readback=False)
        p["receipts"]["rows"][0].update(operation=None, status="NOT_RUN", readback="NOT_RUN")
        select_inputs(p, a); a["evidence"]["proof-1"] = digest(p["receipts"]["rows"][0])
        self.assertEqual(compare(p, a)["status"], "CLOSED")

    def test_v07_receipt_binding_fields(self):
        for key in ("obligation_id", "attempt", "epoch", "slot", "role"):
            with self.subTest(field=key):
                p, a = fixture(); p["receipts"]["rows"][0][key] = "different"; select_inputs(p, a)
                self.assertIn(("EVIDENCE_DRIFT", key), findings(compare(p, a)))

    def test_v07_source_and_target_mismatch(self):
        for key in ("source", "target"):
            with self.subTest(field=key):
                p, a = fixture()
                if key == "source": p["receipts"]["rows"][0][key]["revision"] = "b" * 40
                else: p["receipts"]["rows"][0][key]["resource"] = "another-worker"
                select_inputs(p, a)
                self.assertIn(("EVIDENCE_DRIFT", key), findings(compare(p, a)))

    def test_v08_not_run_and_failed_are_never_success(self):
        for field in ("status", "readback"):
            for value in ("FAIL", "NOT_RUN"):
                with self.subTest(field=field, value=value):
                    p, a = fixture(); p["receipts"]["rows"][0][field] = value; select_inputs(p, a)
                    a["evidence"]["proof-1"] = digest(p["receipts"]["rows"][0])
                    self.assertEqual(compare(p, a)["status"], "OPEN")

    def test_v09_fixture_cannot_satisfy_real_profile(self):
        p, a = fixture()
        for name in ("required", "provided"):
            p[name]["rows"][0]["contract"]["profile"][0]["grade"] = "real"
        a["universe"][0]["profile"][0]["grade"] = "real"; select_inputs(p, a)
        self.assertIn(("EVIDENCE_DRIFT", "grade"), findings(compare(p, a)))

    def test_v09_self_asserted_pass_has_no_provenance(self):
        p, a = fixture(); a["evidence"] = {}
        self.assertIn(("EVIDENCE_DRIFT", "provenance"), findings(compare(p, a)))

    def test_v10_freshness_is_explicit(self):
        p, a = fixture(); a["scope"]["epoch"] = "epoch-2"
        result = compare(p, a)
        self.assertIn(("EVIDENCE_DRIFT", "epoch"), findings(result))
        self.assertEqual(canonical(result), canonical(compare(p, a)))

    def test_v11_declared_contract_is_not_verified(self):
        p, a = fixture(); p["observations"]["rows"] = []; p["receipts"]["rows"] = []; select_inputs(p, a)
        result = compare(p, a)
        self.assertNotIn("CONTRACT_DRIFT", {r["kind"] for r in result["findings"]})
        self.assertNotEqual(result["status"], "CLOSED")

    def test_v12_duplicate_ids_and_refs_conflict(self):
        for name in COLLECTIONS:
            with self.subTest(collection=name):
                p, a = fixture(); p[name]["rows"].append(copy.deepcopy(p[name]["rows"][0])); select_inputs(p, a)
                self.assertEqual(compare(p, a)["status"], "INVALID")
        p, a = fixture(); p["provided"]["rows"][0]["evidence_refs"] = {"projection": "other"}; select_inputs(p, a)
        self.assertEqual(compare(p, a)["status"], "INVALID")

    def test_v13_unknown_field_and_mutable_revision(self):
        p, a = fixture(); p["provided"]["rows"][0]["alias"] = "guess"; select_inputs(p, a)
        self.assertEqual(compare(p, a)["status"], "INVALID")
        p, a = fixture(); p["provided"]["source"]["revision"] = "proposals"; select_inputs(p, a)
        self.assertEqual(compare(p, a)["status"], "INVALID")
        with self.assertRaises(InputError): load_json('{"id":1,"id":2}')
        with self.assertRaises(InputError): load_json('{"number":NaN}')

    def test_v14_truncation_and_missing_admission_are_unknown(self):
        p, a = fixture(); p["provided"]["rows"] = []
        self.assertEqual(compare(p, a)["status"], "UNKNOWN")
        self.assertEqual(compare(p, {})["status"], "UNKNOWN")
        p, a = fixture(); a["inventory"]["provided"] = {"complete": True}
        self.assertNotEqual(compare(p, a)["status"], "CLOSED")

    def test_v15_empty_observed_does_not_remove_required_scope(self):
        p, a = fixture()
        for name in COLLECTIONS: p[name]["rows"] = []
        select_inputs(p, a)
        self.assertIn(("COVERAGE_GAP", "required_universe"), findings(compare(p, a)))

    def test_v16_empty_requires_authority(self):
        p, a = fixture()
        for name in COLLECTIONS: p[name]["rows"] = []
        a["universe"] = []; a["evidence"] = {}; select_inputs(p, a)
        self.assertNotEqual(compare(p, a)["status"], "CLOSED")
        a["scope"]["allow_empty"] = True
        self.assertEqual(compare(p, a)["status"], "CLOSED")

    def test_v17_foreign_scope_exclusion_cannot_hide_required_key(self):
        p, a = fixture(); extra = copy.deepcopy(p["provided"]["rows"][0]); extra["id"] = "windows.other"
        p["provided"]["rows"].append(extra); a["scope"]["excluded_ids"] = [extra["id"]]; select_inputs(p, a)
        self.assertEqual(compare(p, a)["status"], "CLOSED")
        a["scope"]["excluded_ids"].append("fixture.jev")
        self.assertEqual(compare(p, a)["status"], "INVALID")

    def test_v18_row_and_property_order_are_stable(self):
        p, a = fixture(); p["provided"]["rows"][0]["contract"]["slot"] = "DIFFERENT"; select_inputs(p, a)
        before = canonical(compare(p, a))
        def reverse(value):
            if isinstance(value, dict): return {k: reverse(v) for k, v in reversed(list(value.items()))}
            if isinstance(value, list): return [reverse(v) for v in reversed(value)]
            return value
        self.assertEqual(before, canonical(compare(reverse(p), reverse(a))))

    def test_v19_unrelated_execution_metadata_not_part_of_core(self):
        p, a = fixture(); result = compare(p, a)
        self.assertNotIn("timestamp", result); self.assertNotIn("run_id", result)

    def test_v20_private_data_never_echoed(self):
        for key in ("secret_value", "secret_hash", "private_key", "api_key"):
            with self.subTest(key=key):
                p, a = fixture(); p["provided"]["rows"][0][key] = "PRIVATE-CANARY-654321"
                result = compare(p, a)
                self.assertEqual(result["status"], "INVALID")
                self.assertNotIn(b"PRIVATE-CANARY", canonical(result))

    def test_v21_hand_edit_without_new_source_inventory(self):
        p, a = fixture(); p["provided"]["rows"][0]["contract"]["stage"] = "prod"
        self.assertEqual(compare(p, a)["status"], "UNKNOWN")

    def test_v22_v23_no_network_effect_or_authority_imports(self):
        import ast
        tree = ast.parse((ROOT / "core.py").read_text())
        imports = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        imports |= {x.name for n in ast.walk(tree) if isinstance(n, ast.Import) for x in n.names}
        self.assertFalse(imports & {"os", "pathlib", "subprocess", "socket", "requests", "time", "datetime"})

    def test_profile_cannot_be_weakened_by_matching_producer_and_consumer(self):
        p, a = fixture()
        for name in ("required", "provided"): p[name]["rows"][0]["contract"]["profile"] = []
        select_inputs(p, a)
        self.assertIn(("CONTRACT_DRIFT", "required.profile"), findings(compare(p, a)))

    def test_v29_independent_cli_processes_and_installed_entry(self):
        p, a = fixture()
        entry = os.environ.get("CONTRACT_DIFF_BIN")
        command = [entry] if entry else [sys.executable, str(ROOT / "bin/contract-diff.py")]
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); (root / "input.json").write_bytes(canonical(p)); (root / "admission.json").write_bytes(canonical(a))
            argv = command + ["--input", str(root / "input.json"), "--admission", str(root / "admission.json")]
            first = subprocess.run(argv, cwd=root, capture_output=True, check=True)
            second = subprocess.run(argv, cwd=root, capture_output=True, check=True)
            self.assertEqual(first.stdout, second.stdout)
            self.assertEqual(json.loads(first.stdout)["status"], "CLOSED")
            (root / "input.json").unlink()
            missing = subprocess.run(argv, cwd=root, capture_output=True)
            self.assertEqual(missing.returncode, 4)
            self.assertEqual(json.loads(missing.stdout)["status"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
