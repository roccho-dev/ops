"""Focused schema and evidence-selection regressions; fixture authority only."""
import copy
import unittest
from test_core import fixture, select_inputs
from core import compare, canonical


class EdgeTests(unittest.TestCase):
    def test_exact_revision_must_be_a_string_not_a_coerced_number(self):
        packet, admission = fixture()
        packet["provided"]["source"]["revision"] = int("1" * 40)
        select_inputs(packet, admission)
        self.assertEqual(compare(packet, admission)["status"], "INVALID")

    def test_unused_receipt_still_requires_a_valid_closed_shape(self):
        for path, value in (("target", {"provider": [], "resource": "x", "account": None}), ("operation", {"unexpected": 1})):
            with self.subTest(field=path):
                packet, admission = fixture()
                for collection in ("required", "provided"):
                    packet[collection]["rows"][0]["contract"]["profile"] = []
                admission["universe"][0]["profile"] = []
                packet["receipts"]["rows"][0][path] = value
                select_inputs(packet, admission)
                self.assertEqual(compare(packet, admission)["status"], "INVALID")

    def test_explicit_ref_conflict_is_not_erased_by_an_empty_profile(self):
        packet, admission = fixture()
        for collection in ("required", "provided"):
            packet[collection]["rows"][0]["contract"]["profile"] = []
        admission["universe"][0]["profile"] = []
        packet["provided"]["rows"][0]["evidence_refs"] = {"projection": "different"}
        select_inputs(packet, admission)
        self.assertEqual(compare(packet, admission)["status"], "INVALID")

    def test_results_bind_inputs_not_only_the_verdict(self):
        packet, admission = fixture()
        first = compare(packet, admission)
        changed = copy.deepcopy(admission)
        changed["scope"]["authority"]["revision"] = "b" * 40
        second = compare(packet, changed)
        self.assertEqual(first["status"], second["status"])
        self.assertNotEqual(first.get("input_manifest_digest"), second.get("input_manifest_digest"))
        self.assertEqual(first["sources"]["provided"], packet["provided"]["source"])

    def test_two_obligation_rows_are_order_independent(self):
        packet, admission = fixture()
        row = copy.deepcopy(admission["universe"][0]); row["id"] = "fixture.second"
        admission["universe"].append(row)
        # Missing the second requirement is deliberate; permutation must not hide it.
        before = compare(packet, admission)
        admission["universe"].reverse()
        self.assertEqual(canonical(before), canonical(compare(packet, admission)))


if __name__ == "__main__":
    unittest.main()
