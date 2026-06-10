from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE_PATH = ROOT / "saleable_corporation_purpose_gate.json"


def load_gate() -> dict:
    return json.loads(GATE_PATH.read_text(encoding="utf-8"))


class SaleableCorporationPurposeGateTests(unittest.TestCase):
    def test_gate_declares_scope_limited_permission(self) -> None:
        gate = load_gate()
        self.assertEqual(gate["decision"], "allow_as_billing_channel_subsystem_only")
        self.assertEqual(gate["notAllowedAs"], "complete_saleable_corporation_proposal")
        self.assertIn("not a full corporate saleability proposal", gate["requiredScopePhrase"])

    def test_all_meta_generations_are_explicit_and_ordered(self) -> None:
        rows = load_gate()["purposeRows"]
        self.assertEqual([row["generation"] for row in rows], [f"Meta^{i}" for i in range(11)])
        for row in rows:
            self.assertTrue(row["purpose"])
            self.assertTrue(row["proposalContribution"])
            self.assertTrue(row["saleableCorporationContribution"])
            self.assertTrue(row["failureIfMissing"])
            self.assertTrue(row["permission"].startswith("allow_as_billing_subsystem_only"))

    def test_meta10_does_not_overclaim_complete_saleability(self) -> None:
        meta10 = load_gate()["purposeRows"][-1]
        self.assertEqual(meta10["generation"], "Meta^10")
        self.assertIn("売却価値", meta10["purpose"])
        self.assertIn("法人格", meta10["saleableCorporationContribution"])
        self.assertIn("満たさない", meta10["saleableCorporationContribution"])
        self.assertEqual(meta10["permission"], "allow_as_billing_subsystem_only_not_complete_company")

    def test_uncovered_saleability_areas_require_next_proposals(self) -> None:
        areas = {row["area"]: row for row in load_gate()["notCoveredAreas"]}
        required = {
            "corporate_identity",
            "ownership_structure",
            "transaction_structure",
            "tax_accounting_revenue_recognition",
            "legal_compliance",
            "runtime_provider_adapter",
            "management_reporting",
        }
        self.assertLessEqual(required, set(areas))
        for row in areas.values():
            self.assertTrue(row["notCovered"])
            self.assertTrue(row["requiredNextProposal"])

    def test_reject_conditions_protect_billing_authority_boundary(self) -> None:
        reject = set(load_gate()["rejectIf"])
        self.assertIn("claims complete saleable company coverage", reject)
        self.assertIn("moves secrets/webhooks/live invoice state into lib catalog", reject)
        self.assertIn("lets provider adapter override selected channel/provider authority", reject)
        self.assertIn("treats generated LP/admin UI as billing authority", reject)


if __name__ == "__main__":
    unittest.main()
