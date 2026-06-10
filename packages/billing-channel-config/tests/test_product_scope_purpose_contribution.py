from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRIBUTION_PATH = ROOT / "product_scope_purpose_contribution.json"
DEFAULT_NIX_PATH = ROOT / "default.nix"


def load_contribution() -> dict:
    return json.loads(CONTRIBUTION_PATH.read_text(encoding="utf-8"))


class ProductScopePurposeContributionTests(unittest.TestCase):
    def test_product_knows_upper_purpose_through_product_scope(self) -> None:
        data = load_contribution()
        self.assertEqual(data["kind"], "billing-channel-config.productScopePurposeContribution.v1")
        self.assertIn("upper purpose", data["principle"])
        self.assertIn("product scope", data["principle"])
        self.assertIn("high-value corporation", data["ultimatePurpose"])
        self.assertIn("billing-channel-config selects billing channels", data["productScope"])

    def test_all_meta_generations_are_explicit_and_classified(self) -> None:
        data = load_contribution()
        rows = data["purposeRows"]
        self.assertEqual([row["generation"] for row in rows], [f"Meta^{i}" for i in range(11)])
        direct = {row["generation"] for row in rows if row["contributionType"] == "direct"}
        indirect = {row["generation"] for row in rows if row["contributionType"] == "indirect"}
        self.assertEqual(direct, set(data["directContributionGenerations"]))
        self.assertEqual(indirect, set(data["indirectContributionGenerations"]))
        for row in rows:
            self.assertTrue(row["productScopeContribution"])
            self.assertTrue(row["productScopeBoundary"])
            self.assertTrue(row["failureIfMissing"])

    def test_meta10_is_indirect_and_scope_limited(self) -> None:
        meta10 = load_contribution()["purposeRows"][-1]
        self.assertEqual(meta10["generation"], "Meta^10")
        self.assertEqual(meta10["contributionType"], "indirect")
        self.assertIn("間接寄与", meta10["productScopeContribution"])
        self.assertIn("does not complete", meta10["productScopeBoundary"])

    def test_rejects_both_purpose_ignorance_and_overclaiming(self) -> None:
        reject = set(load_contribution()["rejectIf"])
        self.assertIn("claims product is purpose-ignorant", reject)
        self.assertIn("claims this package completes high-value corporation or sale readiness", reject)
        self.assertIn("moves CEO/owner objective, legal, accounting, or DD workflow into billing-channel core", reject)

    def test_default_nix_points_to_scoped_contribution_and_scope_limited_saleable_gate(self) -> None:
        text = DEFAULT_NIX_PATH.read_text(encoding="utf-8")
        self.assertIn("productScopePurposeContribution", text)
        self.assertIn("PRODUCT_SCOPE_PURPOSE_CONTRIBUTION.md", text)
        if "saleableCorporationPurposeGate" in text:
            self.assertIn("billing subsystem scope", text)
            self.assertIn("overclaim-complete-saleable-corporation", text)
            self.assertNotIn("complete_saleable_corporation_proposal", text)


if __name__ == "__main__":
    unittest.main()
