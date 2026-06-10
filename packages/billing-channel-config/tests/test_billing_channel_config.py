from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

from billing_channel_config import (
    BillingPreparedAction,
    BillingRequest,
    add_channel,
    get_default_catalog,
    glue_prepare,
    select_billing_channel,
    validate_catalog,
    validate_prepared_action,
    validate_request,
)

PKG = Path(__file__).resolve().parents[1]
SRC = PKG / "src"
EXAMPLE = PKG / "example" / "poc" / "example"


def _load_example_adapters():
    sys.path.insert(0, str(EXAMPLE))
    try:
        from channel_adapters import BankTransferExampleAdapter, ManualInvoiceExampleAdapter, PayjpCheckoutExampleAdapter, StripeExampleAdapter
    finally:
        try:
            sys.path.remove(str(EXAMPLE))
        except ValueError:
            pass
    return BankTransferExampleAdapter, ManualInvoiceExampleAdapter, PayjpCheckoutExampleAdapter, StripeExampleAdapter


class BillingChannelConfigTests(unittest.TestCase):
    def test_default_catalog_validates(self):
        result = validate_catalog(get_default_catalog())
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["semanticsProfile"], "billing-channel-config-core-port-v2")

    def test_robot_audit_defaults_to_payment_link(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-audit", customer_kind="individual", amount=55000),
        )
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "stripe-payment-link")
        self.assertEqual(selection.provider_id, "stripe")
        self.assertIn("stripe-invoice-bank-transfer", selection.fallbacks)

    def test_business_high_value_audit_uses_invoice(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-audit", customer_kind="business", amount=110000),
        )
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "stripe-invoice-bank-transfer")

    def test_retainer_recurring_uses_recurring_invoice(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-retainer", customer_kind="business", amount=110000, cadence="recurring"),
        )
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "stripe-recurring-invoice")

    def test_blocked_provider_falls_back_to_manual_for_retainer(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-retainer", amount=110000, cadence="recurring", provider_blocked=("stripe",)),
        )
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "manual-monthly-invoice")
        self.assertEqual(selection.provider_id, "manual-invoice")

    def test_blocked_stripe_for_build_uses_bank_transfer_before_manual(self):
        BankTransferExampleAdapter, ManualInvoiceExampleAdapter, _Payjp, StripeExampleAdapter = _load_example_adapters()
        request = BillingRequest(product_id="robot-build", customer_kind="business", amount=220000, provider_blocked=("stripe",))
        selection = select_billing_channel(get_default_catalog(), request)
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "bank-transfer-instructions")
        action = glue_prepare(selection, request, [ManualInvoiceExampleAdapter(), StripeExampleAdapter(), BankTransferExampleAdapter()])
        self.assertTrue(action.ok, action)
        self.assertEqual(action.action_kind, "prepare-bank-transfer-instructions")

    def test_domestic_card_heavy_can_select_payjp_candidate(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="skill-pack", amount=19800, domestic_card_heavy=True),
        )
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "payjp-checkout")
        self.assertEqual(selection.provider_id, "payjp")

    def test_recurring_skill_pack_does_not_accidentally_use_payjp(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="skill-pack", amount=19800, cadence="recurring", domestic_card_heavy=True),
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "product-not-eligible-for-request")

    def test_unsupported_currency_rejects_all_default_channels(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-audit", customer_kind="individual", amount=55000, currency="USD"),
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "no-available-channel")
        self.assertTrue(any("unsupported-currency" in d.get("reasons", []) for d in selection.diagnostics))

    def test_product_amount_bounds_are_enforced(self):
        selection = select_billing_channel(get_default_catalog(), BillingRequest(product_id="robot-audit", amount=1000))
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "product-not-eligible-for-request")

    def test_channel_amount_bounds_are_enforced_before_selection(self):
        catalog = get_default_catalog()
        catalog["products"]["skill-pack"]["maxAmount"] = 2000000
        request = BillingRequest(product_id="skill-pack", amount=1500000, domestic_card_heavy=True)
        selection = select_billing_channel(catalog, request)
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "manual-estimate-invoice")
        rejected_payjp = [d for d in selection.diagnostics if d.get("channelId") == "payjp-checkout"]
        self.assertTrue(any("above-channel-max-amount" in d.get("reasons", []) for d in rejected_payjp))

    def test_new_channel_can_be_added_as_catalog_data_without_core_change(self):
        base = get_default_catalog()
        patched = add_channel(
            base,
            "future-escrow-checkout",
            {
                "provider": "future-escrow",
                "mode": "escrow-checkout",
                "status": "candidate",
                "supportedCadences": ["one_time"],
                "supportedCurrencies": ["JPY"],
                "selectionReason": "future-provider-test",
                "adapterRole": "glue-or-example-until-promoted",
            },
            product_patches={
                "robot-audit": {
                    "defaultChannel": "future-escrow-checkout",
                    "cadenceChannels": {"one_time": "future-escrow-checkout"},
                    "fallbackChannels": ["stripe-payment-link", "manual-estimate-invoice"],
                }
            },
        )
        report = validate_catalog(patched)
        self.assertTrue(report["ok"], report)
        selection = select_billing_channel(patched, BillingRequest(product_id="robot-audit", amount=33000))
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "future-escrow-checkout")
        self.assertEqual(selection.provider_id, "future-escrow")

    def test_runtime_secrets_or_urls_are_rejected_from_core_catalog(self):
        bad = get_default_catalog()
        bad["channels"]["stripe-payment-link"]["secret"] = "sk_test_should_not_be_here"
        bad["channels"]["stripe-payment-link"]["paymentLinkUrl"] = "https://example.invalid/pay"
        result = validate_catalog(bad)
        self.assertFalse(result["ok"])
        self.assertTrue(any(d["kind"] == "runtime-secret-or-io-key-in-core-catalog" for d in result["diagnostics"]))

    def test_generated_views_are_rejected_as_authority(self):
        bad = get_default_catalog()
        bad["generatedIsAuthority"] = True
        result = validate_catalog(bad)
        self.assertFalse(result["ok"])
        self.assertTrue(any(d["kind"] == "generated-authority-leak" for d in result["diagnostics"]))

    def test_provider_disabled_is_not_available_even_if_channel_active(self):
        catalog = get_default_catalog()
        catalog["providers"]["stripe"]["status"] = "disabled"
        selection = select_billing_channel(catalog, BillingRequest(product_id="robot-audit", amount=55000))
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "bank-transfer-instructions")
        self.assertTrue(any("provider-disabled" in d.get("reasons", []) for d in selection.diagnostics))

    def test_channel_disabled_falls_back(self):
        catalog = get_default_catalog()
        catalog["channels"]["stripe-payment-link"]["status"] = "disabled"
        selection = select_billing_channel(catalog, BillingRequest(product_id="robot-audit", amount=55000))
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "stripe-invoice-bank-transfer")
        self.assertTrue(any("channel-disabled" in d.get("reasons", []) for d in selection.diagnostics))

    def test_invalid_request_mapping_returns_structured_failure(self):
        selection = select_billing_channel(
            get_default_catalog(),
            {"product_id": "robot-audit", "amount": "55000", "customer_kind": "alien", "unexpected": True},
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "invalid-request")
        self.assertTrue(any(d["kind"] == "unknown-request-field" for d in selection.diagnostics))
        self.assertTrue(any(d["kind"] == "invalid-amount" for d in selection.diagnostics))

    def test_negative_or_boolean_amount_is_invalid_request(self):
        for amount in (-1, 0, True):
            with self.subTest(amount=amount):
                result = validate_request({"product_id": "robot-audit", "amount": amount}, catalog=get_default_catalog())
                self.assertFalse(result["ok"])
                self.assertTrue(any(d["kind"] == "invalid-amount" for d in result["diagnostics"]))

    def test_provider_blocked_string_is_invalid_not_character_set(self):
        selection = select_billing_channel(
            get_default_catalog(),
            {"product_id": "robot-retainer", "amount": 110000, "cadence": "recurring", "provider_blocked": "stripe"},
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "invalid-request")
        self.assertTrue(any(d["kind"] == "invalid-provider-blocked" for d in selection.diagnostics))

    def test_unknown_blocked_provider_is_invalid(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-audit", amount=55000, provider_blocked=("stripee",)),
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "invalid-request")
        self.assertTrue(any(d["kind"] == "unknown-blocked-provider" for d in selection.diagnostics))

    def test_unknown_preferred_channel_is_invalid(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-audit", amount=55000, preferred_channel="not-a-channel"),
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "invalid-request")
        self.assertTrue(any(d["kind"] == "unknown-preferred-channel" for d in selection.diagnostics))

    def test_declared_but_product_undeclared_preferred_channel_is_rejected(self):
        selection = select_billing_channel(
            get_default_catalog(),
            BillingRequest(product_id="robot-audit", amount=55000, preferred_channel="payjp-checkout"),
        )
        self.assertFalse(selection.ok)
        self.assertEqual(selection.reason, "preferred-channel-not-declared-for-product")

    def test_src_does_not_import_examples(self):
        for path in (SRC / "billing_channel_config").rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("example.poc.example", text, path)
            self.assertNotIn("channel_adapters", text, path)

    def test_src_does_not_import_runtime_io_or_provider_sdks(self):
        forbidden = {"os", "requests", "httpx", "urllib", "socket", "stripe", "payjp", "subprocess", "sqlite3", "boto3", "http"}
        for path in (SRC / "billing_channel_config").rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        self.assertNotIn(alias.name.split(".")[0], forbidden, path)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    self.assertNotIn(node.module.split(".")[0], forbidden, path)

    def test_example_adapters_can_be_glued_from_test_root(self):
        _Bank, ManualInvoiceExampleAdapter, PayjpCheckoutExampleAdapter, StripeExampleAdapter = _load_example_adapters()
        request = BillingRequest(product_id="robot-audit", amount=55000)
        selection = select_billing_channel(get_default_catalog(), request)
        action = glue_prepare(selection, request, [ManualInvoiceExampleAdapter(), PayjpCheckoutExampleAdapter(), StripeExampleAdapter()])
        self.assertTrue(action.ok, action)
        self.assertEqual(action.provider_id, "stripe")
        self.assertEqual(action.action_kind, "create-payment-link")
        self.assertFalse(action.generated_is_authority)
        self.assertTrue(validate_prepared_action(action)["ok"])

    def test_example_adapter_exact_channel_support_prevents_provider_wildcard(self):
        _Bank, _Manual, _Payjp, StripeExampleAdapter = _load_example_adapters()
        catalog = add_channel(
            get_default_catalog(),
            "stripe-tax-portal",
            {
                "provider": "stripe",
                "mode": "tax-portal",
                "status": "candidate",
                "supportedCadences": ["one_time"],
                "supportedCurrencies": ["JPY"],
                "selectionReason": "future-stripe-channel-without-example-adapter",
                "adapterRole": "future-runtime-package-required",
            },
            product_patches={
                "robot-audit": {
                    "defaultChannel": "stripe-tax-portal",
                    "cadenceChannels": {"one_time": "stripe-tax-portal"},
                    "fallbackChannels": ["stripe-payment-link"],
                }
            },
        )
        request = BillingRequest(product_id="robot-audit", amount=55000)
        selection = select_billing_channel(catalog, request)
        self.assertTrue(selection.ok, selection)
        self.assertEqual(selection.channel_id, "stripe-tax-portal")
        action = glue_prepare(selection, request, [StripeExampleAdapter()])
        self.assertFalse(action.ok)
        self.assertEqual(action.action_kind, "missing-adapter")

    def test_glue_prepare_adapter_prepare_exception_is_data_not_crash(self):
        class ExplodingAdapter:
            provider_id = "stripe"

            def supports(self, selection):
                return True

            def prepare(self, selection, request, context=None):
                raise RuntimeError("boom")

        request = BillingRequest(product_id="robot-audit", amount=55000)
        selection = select_billing_channel(get_default_catalog(), request)
        action = glue_prepare(selection, request, [ExplodingAdapter()])
        self.assertFalse(action.ok)
        self.assertEqual(action.action_kind, "adapter-error")
        self.assertTrue(any(d["kind"] == "adapter-prepare-error" for d in action.diagnostics))

    def test_glue_prepare_adapter_support_exception_is_data_not_crash(self):
        class BadSupportAdapter:
            provider_id = "stripe"

            def supports(self, selection):
                raise RuntimeError("support boom")

            def prepare(self, selection, request, context=None):
                raise AssertionError("must not be called")

        request = BillingRequest(product_id="robot-audit", amount=55000)
        selection = select_billing_channel(get_default_catalog(), request)
        action = glue_prepare(selection, request, [BadSupportAdapter()])
        self.assertFalse(action.ok)
        self.assertEqual(action.action_kind, "missing-adapter")
        self.assertTrue(any(d["kind"] == "adapter-support-error" for d in action.diagnostics))


    def test_glue_prepare_rejects_non_action_return(self):
        class NonActionAdapter:
            provider_id = "stripe"

            def supports(self, selection):
                return True

            def prepare(self, selection, request, context=None):
                return {"not": "an action"}

        request = BillingRequest(product_id="robot-audit", amount=55000)
        selection = select_billing_channel(get_default_catalog(), request)
        action = glue_prepare(selection, request, [NonActionAdapter()])
        self.assertFalse(action.ok)
        self.assertIn(action.action_kind, {"invalid-adapter-action", "adapter-contract-error"})

    def test_glue_prepare_rejects_action_channel_provider_mismatch(self):
        class MismatchAdapter:
            provider_id = "stripe"

            def supports(self, selection):
                return True

            def prepare(self, selection, request, context=None):
                return BillingPreparedAction(ok=True, channel_id="payjp-checkout", provider_id="payjp", action_kind="wrong-boundary")

        request = BillingRequest(product_id="robot-audit", amount=55000)
        selection = select_billing_channel(get_default_catalog(), request)
        action = glue_prepare(selection, request, [MismatchAdapter()])
        self.assertFalse(action.ok)
        self.assertEqual(action.action_kind, "invalid-adapter-action")

    def test_add_channel_deep_copy_prevents_failed_experiment_mutating_base(self):
        base = get_default_catalog()
        patched = add_channel(
            base,
            "future-card",
            {"provider": "future-card", "mode": "card", "supportedCadences": ["one_time"], "supportedCurrencies": ["JPY"]},
            product_patches={"robot-audit": {"fallbackChannels": ["future-card"]}},
        )
        patched["products"]["robot-audit"]["fallbackChannels"].append("mutated")
        self.assertNotIn("future-card", base["products"]["robot-audit"]["fallbackChannels"])
        self.assertNotIn("mutated", base["products"]["robot-audit"]["fallbackChannels"])

    def test_validate_prepared_action_rejects_generated_authority(self):
        action = BillingPreparedAction(
            ok=True,
            channel_id="stripe-payment-link",
            provider_id="stripe",
            action_kind="create-payment-link",
            generated_is_authority=True,
        )
        report = validate_prepared_action(action)
        self.assertFalse(report["ok"])
        self.assertTrue(any(d["kind"] == "generated-action-authority-leak" for d in report["diagnostics"]))


if __name__ == "__main__":
    unittest.main()
