"""Dry-run manual invoice/estimate adapter example."""

from __future__ import annotations

from typing import Any, Mapping

from billing_channel_config.core import BillingRequest, ChannelSelection, Money
from billing_channel_config.port import BillingPreparedAction


class ManualInvoiceExampleAdapter:
    provider_id = "manual-invoice"
    supported_channel_ids = frozenset({"manual-estimate-invoice", "manual-monthly-invoice"})
    action_by_mode = {
        "estimate-invoice": "prepare-estimate",
        "monthly-invoice": "prepare-manual-invoice",
    }

    def supports(self, selection: ChannelSelection) -> bool:
        return selection.provider_id == self.provider_id and selection.channel_id in self.supported_channel_ids and selection.mode in self.action_by_mode

    def prepare(self, selection: ChannelSelection, request: BillingRequest, context: Mapping[str, Any] | None = None) -> BillingPreparedAction:
        if not self.supports(selection):
            return BillingPreparedAction(
                ok=False,
                channel_id=selection.channel_id or "manual-invoice",
                provider_id=self.provider_id,
                action_kind="unsupported-manual-invoice-channel",
                human_label="Dry-run manual invoice adapter does not support this selected channel",
                payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
            )
        return BillingPreparedAction(
            ok=True,
            channel_id=selection.channel_id or "manual-invoice",
            provider_id=self.provider_id,
            action_kind=self.action_by_mode[str(selection.mode)],
            amount=Money(amount=request.amount or 0, currency=request.currency) if request.amount is not None else None,
            human_label="Dry-run manual invoice action",
            payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
        )
