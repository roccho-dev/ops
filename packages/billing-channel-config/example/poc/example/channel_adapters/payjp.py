"""Dry-run PAY.JP adapter example.

Production PAY.JP checkout/API code should live in a promoted runtime adapter
package when domestic-card volume justifies it.
"""

from __future__ import annotations

from typing import Any, Mapping

from billing_channel_config.core import BillingRequest, ChannelSelection, Money
from billing_channel_config.port import BillingPreparedAction


class PayjpCheckoutExampleAdapter:
    provider_id = "payjp"
    supported_channel_ids = frozenset({"payjp-checkout"})

    def supports(self, selection: ChannelSelection) -> bool:
        return selection.provider_id == self.provider_id and selection.channel_id in self.supported_channel_ids and selection.mode == "card-checkout"

    def prepare(self, selection: ChannelSelection, request: BillingRequest, context: Mapping[str, Any] | None = None) -> BillingPreparedAction:
        if not self.supports(selection):
            return BillingPreparedAction(
                ok=False,
                channel_id=selection.channel_id or "payjp-checkout",
                provider_id=self.provider_id,
                action_kind="unsupported-payjp-channel",
                human_label="Dry-run PAY.JP adapter does not support this selected channel",
                payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
            )
        return BillingPreparedAction(
            ok=True,
            channel_id=selection.channel_id or "payjp-checkout",
            provider_id=self.provider_id,
            action_kind="create-card-checkout",
            amount=Money(amount=request.amount or 0, currency=request.currency) if request.amount is not None else None,
            human_label="Dry-run PAY.JP checkout action",
            payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
        )
