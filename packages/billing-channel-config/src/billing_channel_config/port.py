"""Adapter port for billing-channel runtime glue.

The port defines what runtime/provider packages must implement.  It does not
import provider SDKs and the core package remains pure.  Bad adapters become
provider-neutral diagnostics instead of corrupting selected channel authority.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from .core import BillingRequest, ChannelSelection, Money, SEMANTICS_PROFILE


@dataclass(frozen=True)
class BillingPreparedAction:
    """Provider-neutral intent returned by adapter glue."""

    ok: bool
    channel_id: str
    provider_id: str
    action_kind: str
    amount: Money | None = None
    external_reference: str | None = None
    human_label: str | None = None
    generated_is_authority: bool = False
    payload: Mapping[str, Any] | None = None
    diagnostics: tuple[dict[str, Any], ...] = ()
    semantics_profile: str = SEMANTICS_PROFILE

    def to_json(self) -> dict[str, Any]:
        out = asdict(self)
        if self.amount is not None:
            out["amount"] = self.amount.to_json()
        out["channelId"] = out.pop("channel_id")
        out["providerId"] = out.pop("provider_id")
        out["actionKind"] = out.pop("action_kind")
        out["externalReference"] = out.pop("external_reference")
        out["humanLabel"] = out.pop("human_label")
        out["generatedIsAuthority"] = out.pop("generated_is_authority")
        out["semanticsProfile"] = out.pop("semantics_profile")
        return out


@runtime_checkable
class BillingChannelAdapter(Protocol):
    """Glue boundary from selected core channel to provider/runtime action."""

    provider_id: str

    def supports(self, selection: ChannelSelection) -> bool:
        """Return true when this adapter can handle the selected provider/channel."""

    def prepare(self, selection: ChannelSelection, request: BillingRequest, context: Mapping[str, Any] | None = None) -> BillingPreparedAction:
        """Prepare a provider-neutral billing action."""


def _diagnostic(kind: str, path: str, message: str, **extra: Any) -> dict[str, Any]:
    out = {"kind": kind, "path": path, "message": message}
    out.update(extra)
    return out


def _adapter_name(adapter: Any) -> str:
    return getattr(adapter, "provider_id", adapter.__class__.__name__)


def validate_prepared_action(action: Any, selection: ChannelSelection | None = None) -> dict[str, Any]:
    """Validate adapter output without touching provider runtime."""

    diagnostics: list[dict[str, Any]] = []
    if not isinstance(action, BillingPreparedAction):
        diagnostics.append(_diagnostic("invalid-prepared-action-type", "action", "adapter must return BillingPreparedAction", actualType=type(action).__name__))
        return {
            "ok": False,
            "classification": "billing-channel-config-prepared-action-fail",
            "semanticsProfile": SEMANTICS_PROFILE,
            "generatedIsAuthority": False,
            "diagnosticCount": len(diagnostics),
            "diagnostics": diagnostics,
        }
    if not isinstance(action.channel_id, str) or not action.channel_id:
        diagnostics.append(_diagnostic("invalid-action-channel", "action.channel_id", "action channel_id must be non-empty string"))
    if not isinstance(action.provider_id, str) or not action.provider_id:
        diagnostics.append(_diagnostic("invalid-action-provider", "action.provider_id", "action provider_id must be non-empty string"))
    if action.ok and (not isinstance(action.action_kind, str) or not action.action_kind):
        diagnostics.append(_diagnostic("invalid-action-kind", "action.action_kind", "ok action must have non-empty action_kind"))
    if action.generated_is_authority:
        diagnostics.append(_diagnostic("generated-action-authority-leak", "action.generated_is_authority", "adapter output must not become catalog authority"))
    if selection is not None:
        if action.channel_id != selection.channel_id or action.provider_id != selection.provider_id:
            diagnostics.append(
                _diagnostic(
                    "adapter-action-boundary-mismatch",
                    "action",
                    "adapter action must preserve selected channel/provider",
                    selectedChannelId=selection.channel_id,
                    selectedProviderId=selection.provider_id,
                    actionChannelId=action.channel_id,
                    actionProviderId=action.provider_id,
                )
            )
    return {
        "ok": not diagnostics,
        "classification": "billing-channel-config-prepared-action-pass" if not diagnostics else "billing-channel-config-prepared-action-fail",
        "semanticsProfile": SEMANTICS_PROFILE,
        "generatedIsAuthority": False,
        "diagnosticCount": len(diagnostics),
        "diagnostics": diagnostics,
    }


def _failure(
    selection: ChannelSelection,
    action_kind: str,
    human_label: str,
    diagnostics: tuple[dict[str, Any], ...] = (),
    payload: Mapping[str, Any] | None = None,
) -> BillingPreparedAction:
    return BillingPreparedAction(
        ok=False,
        channel_id=selection.channel_id or "<none>",
        provider_id=selection.provider_id or "<none>",
        action_kind=action_kind,
        human_label=human_label,
        payload=payload,
        diagnostics=diagnostics,
    )


def glue_prepare(
    selection: ChannelSelection,
    request: BillingRequest,
    adapters: list[BillingChannelAdapter],
    context: Mapping[str, Any] | None = None,
) -> BillingPreparedAction:
    """Use the first adapter that supports the selected provider/channel."""

    if not selection.ok or not selection.channel_id or not selection.provider_id:
        return BillingPreparedAction(
            ok=False,
            channel_id=selection.channel_id or "<none>",
            provider_id=selection.provider_id or "<none>",
            action_kind="no-selected-channel",
            human_label="No channel selected",
            payload={"reason": selection.reason},
            diagnostics=tuple(selection.diagnostics),
        )

    support_errors: list[dict[str, Any]] = []
    for adapter in adapters:
        adapter_id = _adapter_name(adapter)
        try:
            supported = bool(adapter.supports(selection))
        except Exception as exc:
            support_errors.append(_diagnostic("adapter-support-error", "adapter.supports", "adapter raised while checking support", adapter=adapter_id, error=type(exc).__name__, errorMessage=str(exc)))
            continue
        if not supported:
            continue
        try:
            action = adapter.prepare(selection, request, context=context)
        except Exception as exc:
            diagnostic = _diagnostic("adapter-prepare-error", "adapter.prepare", "adapter raised while preparing action", adapter=adapter_id, error=type(exc).__name__, errorMessage=str(exc))
            return _failure(selection, "adapter-error", "Adapter raised while preparing a billing action", (diagnostic,))
        report = validate_prepared_action(action, selection=selection)
        if not report["ok"]:
            return _failure(selection, "invalid-adapter-action", "Adapter returned invalid billing action", tuple(report["diagnostics"]))
        return action

    return BillingPreparedAction(
        ok=False,
        channel_id=selection.channel_id,
        provider_id=selection.provider_id,
        action_kind="missing-adapter",
        human_label="No adapter was provided for the selected channel",
        payload={"reason": selection.reason},
        diagnostics=tuple(support_errors),
    )
