"""Default billing channel catalog.

This is static product/channel data.  It intentionally contains no provider
secret, endpoint, webhook, payment-link URL, invoice state, or SDK object.
"""

from __future__ import annotations

from typing import Any

DEFAULT_CATALOG: dict[str, Any] = {
    "kind": "billing-channel-config.catalog.v1",
    "version": "2026-06-05.destructive-refactor-v2",
    "generatedIsAuthority": False,
    "providers": {
        "stripe": {"label": "Stripe", "status": "primary"},
        "payjp": {"label": "PAY.JP", "status": "candidate"},
        "bank-transfer": {"label": "Bank transfer", "status": "primary"},
        "manual-invoice": {"label": "Manual invoice", "status": "fallback"},
    },
    "channels": {
        "stripe-payment-link": {
            "provider": "stripe",
            "mode": "payment-link",
            "supportedCadences": ["one_time"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 100,
            "maxAmount": 1000000,
            "selectionReason": "fast-one-shot-card-checkout",
            "adapterRole": "glue-or-example-until-runtime-package",
        },
        "stripe-invoice-bank-transfer": {
            "provider": "stripe",
            "mode": "invoice-bank-transfer",
            "supportedCadences": ["one_time", "estimate"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 10000,
            "maxAmount": 10000000,
            "selectionReason": "business-invoice-with-bank-transfer-option",
            "adapterRole": "glue-or-example-until-runtime-package",
        },
        "stripe-recurring-invoice": {
            "provider": "stripe",
            "mode": "recurring-invoice",
            "supportedCadences": ["recurring"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 1000,
            "maxAmount": 10000000,
            "selectionReason": "monthly-retainer-recurring-billing",
            "adapterRole": "glue-or-example-until-runtime-package",
        },
        "bank-transfer-instructions": {
            "provider": "bank-transfer",
            "mode": "bank-transfer-instructions",
            "supportedCadences": ["one_time", "estimate"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 10000,
            "maxAmount": 100000000,
            "selectionReason": "bank-transfer-provider-independent-fallback",
            "adapterRole": "ops-glue-or-runtime-package",
        },
        "manual-estimate-invoice": {
            "provider": "manual-invoice",
            "mode": "estimate-invoice",
            "supportedCadences": ["one_time", "estimate"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 100,
            "selectionReason": "high-value-estimate-before-invoice",
            "adapterRole": "human-or-ops-glue",
        },
        "manual-monthly-invoice": {
            "provider": "manual-invoice",
            "mode": "monthly-invoice",
            "supportedCadences": ["recurring"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 1000,
            "selectionReason": "fallback-monthly-manual-invoice",
            "adapterRole": "human-or-ops-glue",
        },
        "payjp-checkout": {
            "provider": "payjp",
            "mode": "card-checkout",
            "supportedCadences": ["one_time"],
            "supportedCurrencies": ["JPY"],
            "minAmount": 100,
            "maxAmount": 1000000,
            "selectionReason": "domestic-card-heavy-future-channel",
            "adapterRole": "candidate-glue-example",
        },
    },
    "products": {
        "robot-audit": {
            "label": "知見ロボット化診断",
            "minAmount": 30000,
            "maxAmount": 150000,
            "defaultChannel": "stripe-payment-link",
            "fallbackChannels": ["stripe-invoice-bank-transfer", "bank-transfer-instructions", "manual-estimate-invoice"],
            "businessInvoiceThreshold": 100000,
            "businessInvoiceChannel": "stripe-invoice-bank-transfer",
            "cadenceChannels": {"one_time": "stripe-payment-link"},
            "selectionReason": "diagnosis-first-payment-link",
        },
        "robot-build": {
            "label": "業務ロボット1体納品",
            "minAmount": 150000,
            "maxAmount": 800000,
            "defaultChannel": "stripe-invoice-bank-transfer",
            "fallbackChannels": ["bank-transfer-instructions", "manual-estimate-invoice", "stripe-payment-link"],
            "businessInvoiceThreshold": 150000,
            "businessInvoiceChannel": "stripe-invoice-bank-transfer",
            "cadenceChannels": {"one_time": "stripe-invoice-bank-transfer"},
            "selectionReason": "b2b-delivery-invoice-first",
        },
        "robot-squad-build": {
            "label": "ロボット部隊構築",
            "minAmount": 500000,
            "maxAmount": 3000000,
            "defaultChannel": "manual-estimate-invoice",
            "fallbackChannels": ["bank-transfer-instructions", "stripe-invoice-bank-transfer"],
            "businessInvoiceThreshold": 500000,
            "businessInvoiceChannel": "manual-estimate-invoice",
            "cadenceChannels": {"estimate": "manual-estimate-invoice"},
            "selectionReason": "high-value-estimate-first",
        },
        "robot-retainer": {
            "label": "ロボット保守",
            "minAmount": 50000,
            "maxAmount": 500000,
            "defaultChannel": "stripe-recurring-invoice",
            "fallbackChannels": ["manual-monthly-invoice", "stripe-invoice-bank-transfer"],
            "cadenceChannels": {"recurring": "stripe-recurring-invoice", "one_time": "stripe-invoice-bank-transfer"},
            "selectionReason": "retainer-recurring-first",
        },
        "skill-pack": {
            "label": "Skill pack / template",
            "minAmount": 1000,
            "maxAmount": 300000,
            "defaultChannel": "stripe-payment-link",
            "fallbackChannels": ["payjp-checkout", "manual-estimate-invoice"],
            "domesticCardHeavyChannel": "payjp-checkout",
            "cadenceChannels": {"one_time": "stripe-payment-link"},
            "selectionReason": "low-ticket-payment-link-first",
        },
    },
}


def get_default_catalog() -> dict[str, Any]:
    """Return a copy of the default catalog for callers to patch safely."""

    import copy

    return copy.deepcopy(DEFAULT_CATALOG)
