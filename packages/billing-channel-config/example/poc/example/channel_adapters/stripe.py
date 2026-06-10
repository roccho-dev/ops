"""Dry-run Stripe adapter example.

This is example glue, not production Stripe code.  It intentionally avoids
Stripe SDK imports, secrets, payment-link URLs, webhook handling, and network IO.
"""

from __future__ import annotations

from typing import Any, Mapping

from billing_channel_config.core import BillingRequest, ChannelSelection, Money
from billing_channel_config.port import BillingPreparedAction


class StripeExampleAdapter:
    provider_id = "stripe"
    supported_channel_ids = frozenset({"stripe-payment-link", "stripe-invoice-bank-transfer", "stripe-recurring-invoice"})
    action_by_mode = {
        "payment-link": "create-payment-link",
        "invoice-bank-transfer": "create-invoice",
        "recurring-invoice": "create-recurring-invoice",
    }

    def supports(self, selection: ChannelSelection) -> bool:
        return selection.provider_id == self.provider_id and selection.channel_id in self.supported_channel_ids and selection.mode in self.action_by_mode

    def prepare(self, selection: ChannelSelection, request: BillingRequest, context: Mapping[str, Any] | None = None) -> BillingPreparedAction:
        if not self.supports(selection):
            return BillingPreparedAction(
                ok=False,
                channel_id=selection.channel_id or "stripe",
                provider_id=self.provider_id,
                action_kind="unsupported-stripe-channel",
                human_label="Dry-run Stripe adapter does not support this selected channel",
                payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
            )
        amount = Money(amount=request.amount or 0, currency=request.currency) if request.amount is not None else None
        return BillingPreparedAction(
            ok=True,
            channel_id=selection.channel_id or "stripe",
            provider_id=self.provider_id,
            action_kind=self.action_by_mode[str(selection.mode)],
            amount=amount,
            human_label="Dry-run Stripe billing action",
            payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
        )
