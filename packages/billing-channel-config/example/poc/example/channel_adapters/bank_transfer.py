"""Dry-run bank-transfer adapter example."""

from __future__ import annotations

from typing import Any, Mapping

from billing_channel_config.core import BillingRequest, ChannelSelection, Money
from billing_channel_config.port import BillingPreparedAction


class BankTransferExampleAdapter:
    provider_id = "bank-transfer"
    supported_channel_ids = frozenset({"bank-transfer-instructions"})

    def supports(self, selection: ChannelSelection) -> bool:
        return selection.provider_id == self.provider_id and selection.channel_id in self.supported_channel_ids and selection.mode == "bank-transfer-instructions"

    def prepare(self, selection: ChannelSelection, request: BillingRequest, context: Mapping[str, Any] | None = None) -> BillingPreparedAction:
        if not self.supports(selection):
            return BillingPreparedAction(
                ok=False,
                channel_id=selection.channel_id or "bank-transfer",
                provider_id=self.provider_id,
                action_kind="unsupported-bank-transfer-channel",
                human_label="Dry-run bank-transfer adapter does not support this selected channel",
                payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
            )
        return BillingPreparedAction(
            ok=True,
            channel_id=selection.channel_id or "bank-transfer",
            provider_id=self.provider_id,
            action_kind="prepare-bank-transfer-instructions",
            amount=Money(amount=request.amount or 0, currency=request.currency) if request.amount is not None else None,
            human_label="Dry-run bank transfer instruction action",
            payload={"dryRun": True, "productId": request.product_id, "mode": selection.mode},
        )
