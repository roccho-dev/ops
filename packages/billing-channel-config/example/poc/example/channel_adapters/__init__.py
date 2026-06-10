"""Dry-run example adapters for billing-channel-config."""

from .bank_transfer import BankTransferExampleAdapter
from .manual_invoice import ManualInvoiceExampleAdapter
from .payjp import PayjpCheckoutExampleAdapter
from .stripe import StripeExampleAdapter

__all__ = [
    "BankTransferExampleAdapter",
    "ManualInvoiceExampleAdapter",
    "PayjpCheckoutExampleAdapter",
    "StripeExampleAdapter",
]
