"""Pure billing-channel selection core.

The core accepts explicit catalog/request values and returns JSON-serializable
results.  It performs no filesystem, environment, network, clock, database, or
provider SDK work.  Stripe, PAY.JP, bank-transfer, and future channel adapters
must be glued through the port/example boundary.

The v2 semantics add destructive-usecase guards: request validation, product
eligibility gates, provider/channel availability traces, cadence/currency/amount
compatibility checks, product-scoped preferred channels, and stricter runtime
secret/URL leakage detection.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from typing import Any, Mapping, Sequence
import copy
import re

SEMANTICS_PROFILE = "billing-channel-config-core-port-v2"

FORBIDDEN_RUNTIME_KEYS = frozenset(
    {
        "api_key",
        "apiKey",
        "apiSecret",
        "secret",
        "secretKey",
        "credential",
        "credentialRef",
        "token",
        "webhook_secret",
        "webhookSecret",
        "webhookUrl",
        "paymentLinkUrl",
        "client",
        "sdk",
        "session",
        "http",
        "url",
        "uri",
        "endpoint",
        "endpointUrl",
    }
)
FORBIDDEN_RUNTIME_KEY_FRAGMENTS = frozenset(
    {
        "apikey",
        "apisecret",
        "secret",
        "credential",
        "token",
        "webhook",
        "endpoint",
        "url",
        "uri",
        "client",
        "sdk",
        "session",
        "http",
        "oauth",
        "bearer",
        "password",
        "privatekey",
        "accesskey",
    }
)
FORBIDDEN_RUNTIME_VALUE_PREFIXES = ("sk_", "rk_", "pk_live_", "pk_test_")
PROVIDER_AVAILABLE_STATUSES = frozenset({"primary", "candidate", "fallback", "active"})
PROVIDER_UNAVAILABLE_STATUSES = frozenset({"disabled", "inactive", "blocked"})
CHANNEL_AVAILABLE_STATUSES = frozenset({"active", "candidate", "primary", "fallback"})
CHANNEL_UNAVAILABLE_STATUSES = frozenset({"disabled", "inactive", "blocked"})
ALLOWED_CUSTOMER_KINDS = frozenset({"unknown", "individual", "business"})
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


@dataclass(frozen=True)
class Money:
    amount: int
    currency: str = "JPY"

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class BillingRequest:
    product_id: str
    customer_kind: str = "unknown"  # individual | business | unknown
    amount: int | None = None
    currency: str = "JPY"
    cadence: str = "one_time"  # one_time | recurring | estimate | future catalog-defined cadence
    domestic_card_heavy: bool = False
    provider_blocked: tuple[str, ...] = ()
    preferred_channel: str | None = None

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ChannelSelection:
    ok: bool
    product_id: str
    channel_id: str | None
    provider_id: str | None
    mode: str | None
    reason: str
    fallbacks: tuple[str, ...] = ()
    diagnostics: tuple[dict[str, Any], ...] = ()
    generated_is_authority: bool = False
    semantics_profile: str = SEMANTICS_PROFILE

    def to_json(self) -> dict[str, Any]:
        out = asdict(self)
        out["generatedIsAuthority"] = out.pop("generated_is_authority")
        out["semanticsProfile"] = out.pop("semantics_profile")
        out["channelId"] = out.pop("channel_id")
        out["providerId"] = out.pop("provider_id")
        out["productId"] = out.pop("product_id")
        return out


_REQUEST_FIELD_NAMES = frozenset(field.name for field in fields(BillingRequest))


def _diagnostic(kind: str, path: str, message: str, **extra: Any) -> dict[str, Any]:
    out = {"kind": kind, "path": path, "message": message}
    out.update(extra)
    return out


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _as_sequence(value: Any) -> Sequence[Any]:
    return value if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)) else ()


def _non_bool_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _canonical_runtime_key(key_text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key_text.lower())


def _walk_forbidden_runtime_keys(value: Any, path: str = "catalog") -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            key_text = str(key)
            child_path = f"{path}.{key_text}"
            canonical_key = _canonical_runtime_key(key_text)
            if key_text in FORBIDDEN_RUNTIME_KEYS or any(fragment in canonical_key for fragment in FORBIDDEN_RUNTIME_KEY_FRAGMENTS):
                diagnostics.append(
                    _diagnostic(
                        "runtime-secret-or-io-key-in-core-catalog",
                        child_path,
                        "billing-channel catalog must describe capability, not provider runtime credentials or HTTP endpoints",
                    )
                )
            diagnostics.extend(_walk_forbidden_runtime_keys(child, child_path))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            diagnostics.extend(_walk_forbidden_runtime_keys(child, f"{path}[{index}]"))
    elif isinstance(value, str):
        stripped = value.strip()
        lowered = stripped.lower()
        if "https://" in lowered or "http://" in lowered:
            diagnostics.append(
                _diagnostic(
                    "runtime-url-value-in-core-catalog",
                    path,
                    "billing-channel catalog must not store provider/payment URLs",
                )
            )
        if lowered.startswith(FORBIDDEN_RUNTIME_VALUE_PREFIXES):
            diagnostics.append(
                _diagnostic(
                    "runtime-secret-like-value-in-core-catalog",
                    path,
                    "billing-channel catalog must not store provider key-like values",
                )
            )
    return diagnostics


def _validate_status(status: Any, path: str, available: frozenset[str], unavailable: frozenset[str], diagnostics: list[dict[str, Any]]) -> None:
    if status is None:
        return
    if not isinstance(status, str) or not status:
        diagnostics.append(_diagnostic("invalid-status", path, "status must be a non-empty string when declared"))
        return
    if status not in available and status not in unavailable:
        diagnostics.append(_diagnostic("unknown-status", path, f"status {status!r} is not declared in the availability vocabulary"))


def _validate_channel_ref(channels: Mapping[str, Any], value: Any, path: str, kind: str, diagnostics: list[dict[str, Any]]) -> str | None:
    if not isinstance(value, str) or not value:
        diagnostics.append(_diagnostic(f"invalid-{kind}", path, "channel reference must be a non-empty string"))
        return None
    if value not in channels:
        diagnostics.append(_diagnostic(f"unknown-{kind}", path, f"channel {value!r} is not declared"))
        return None
    return value


def _validate_string_sequence(value: Any, path: str, kind: str, diagnostics: list[dict[str, Any]]) -> tuple[str, ...] | None:
    if value is None:
        return ()
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        diagnostics.append(_diagnostic(f"invalid-{kind}", path, f"{kind} must be a sequence of non-empty strings"))
        return None
    out: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        item_path = f"{path}[{index}]"
        if not isinstance(item, str) or not item:
            diagnostics.append(_diagnostic(f"invalid-{kind}-entry", item_path, f"{kind} entries must be non-empty strings"))
        elif item in seen:
            diagnostics.append(_diagnostic(f"duplicate-{kind}-entry", item_path, f"{kind} entry {item!r} is duplicated"))
        else:
            out.append(item)
            seen.add(item)
    return tuple(out)


def _supported(channel: Mapping[str, Any], key: str) -> tuple[str, ...] | None:
    if key not in channel:
        return None
    value = channel.get(key)
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return tuple(item for item in value if isinstance(item, str) and item)
    return ()


def _validate_supported_list(channel: Mapping[str, Any], key: str, path: str, diagnostics: list[dict[str, Any]]) -> None:
    if key not in channel:
        return
    _validate_string_sequence(channel.get(key), path, _canonical_runtime_key(key), diagnostics)


def _validate_amount_bound(value: Any, path: str, kind: str, diagnostics: list[dict[str, Any]]) -> None:
    if value is None:
        return
    if not _non_bool_int(value) or value < 0:
        diagnostics.append(_diagnostic(kind, path, "amount bound must be a non-negative integer"))


def _validate_cadence_channel_support(channels: Mapping[str, Any], cadence: str, channel_id: str, path: str, diagnostics: list[dict[str, Any]]) -> None:
    channel = _as_mapping(channels.get(channel_id))
    supported = _supported(channel, "supportedCadences")
    if supported is not None and cadence not in supported:
        diagnostics.append(
            _diagnostic(
                "channel-does-not-support-cadence",
                path,
                f"channel {channel_id!r} does not declare support for cadence {cadence!r}",
                supportedCadences=list(supported),
            )
        )


def validate_catalog(catalog: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a billing channel catalog without touching runtime systems."""

    diagnostics: list[dict[str, Any]] = []
    if catalog.get("kind") != "billing-channel-config.catalog.v1":
        diagnostics.append(_diagnostic("invalid-catalog-kind", "catalog.kind", "catalog.kind must be billing-channel-config.catalog.v1"))
    if catalog.get("generatedIsAuthority") is True:
        diagnostics.append(_diagnostic("generated-authority-leak", "catalog.generatedIsAuthority", "generated views must not become catalog authority"))
    elif "generatedIsAuthority" in catalog and catalog.get("generatedIsAuthority") is not False:
        diagnostics.append(_diagnostic("invalid-generated-authority-flag", "catalog.generatedIsAuthority", "generatedIsAuthority must be false when present"))
    if "version" in catalog and not isinstance(catalog.get("version"), str):
        diagnostics.append(_diagnostic("invalid-catalog-version", "catalog.version", "catalog.version must be a string when declared"))

    providers = _as_mapping(catalog.get("providers"))
    channels = _as_mapping(catalog.get("channels"))
    products = _as_mapping(catalog.get("products"))
    if not providers:
        diagnostics.append(_diagnostic("missing-providers", "catalog.providers", "at least one provider must be declared"))
    if not channels:
        diagnostics.append(_diagnostic("missing-channels", "catalog.channels", "at least one channel must be declared"))
    if not products:
        diagnostics.append(_diagnostic("missing-products", "catalog.products", "at least one product must be declared"))

    for provider_id, provider in providers.items():
        if not isinstance(provider_id, str) or not provider_id:
            diagnostics.append(_diagnostic("invalid-provider-id", "catalog.providers", "provider id must be a non-empty string"))
        if not isinstance(provider, Mapping):
            diagnostics.append(_diagnostic("invalid-provider", f"catalog.providers.{provider_id}", "provider must be object"))
            continue
        if not isinstance(provider.get("label"), str) or not provider.get("label"):
            diagnostics.append(_diagnostic("missing-provider-label", f"catalog.providers.{provider_id}.label", "provider label is required"))
        _validate_status(provider.get("status"), f"catalog.providers.{provider_id}.status", PROVIDER_AVAILABLE_STATUSES, PROVIDER_UNAVAILABLE_STATUSES, diagnostics)

    for channel_id, channel in channels.items():
        if not isinstance(channel_id, str) or not channel_id:
            diagnostics.append(_diagnostic("invalid-channel-id", "catalog.channels", "channel id must be a non-empty string"))
        if not isinstance(channel, Mapping):
            diagnostics.append(_diagnostic("invalid-channel", f"catalog.channels.{channel_id}", "channel must be object"))
            continue
        provider_id = channel.get("provider")
        if provider_id not in providers:
            diagnostics.append(_diagnostic("unknown-channel-provider", f"catalog.channels.{channel_id}.provider", f"channel provider {provider_id!r} is not declared"))
        if not isinstance(channel.get("mode"), str) or not channel.get("mode"):
            diagnostics.append(_diagnostic("missing-channel-mode", f"catalog.channels.{channel_id}.mode", "channel mode is required"))
        _validate_status(channel.get("status"), f"catalog.channels.{channel_id}.status", CHANNEL_AVAILABLE_STATUSES, CHANNEL_UNAVAILABLE_STATUSES, diagnostics)
        _validate_supported_list(channel, "supportedCadences", f"catalog.channels.{channel_id}.supportedCadences", diagnostics)
        _validate_supported_list(channel, "supportedCurrencies", f"catalog.channels.{channel_id}.supportedCurrencies", diagnostics)
        _validate_amount_bound(channel.get("minAmount"), f"catalog.channels.{channel_id}.minAmount", "invalid-channel-min-amount", diagnostics)
        _validate_amount_bound(channel.get("maxAmount"), f"catalog.channels.{channel_id}.maxAmount", "invalid-channel-max-amount", diagnostics)
        if _non_bool_int(channel.get("minAmount")) and _non_bool_int(channel.get("maxAmount")) and channel["minAmount"] > channel["maxAmount"]:
            diagnostics.append(_diagnostic("invalid-channel-amount-range", f"catalog.channels.{channel_id}", "minAmount must not exceed maxAmount"))

    for product_id, product in products.items():
        if not isinstance(product_id, str) or not product_id:
            diagnostics.append(_diagnostic("invalid-product-id", "catalog.products", "product id must be a non-empty string"))
        if not isinstance(product, Mapping):
            diagnostics.append(_diagnostic("invalid-product", f"catalog.products.{product_id}", "product must be object"))
            continue
        if not isinstance(product.get("label"), str) or not product.get("label"):
            diagnostics.append(_diagnostic("missing-product-label", f"catalog.products.{product_id}.label", "product label is required"))
        _validate_channel_ref(channels, product.get("defaultChannel"), f"catalog.products.{product_id}.defaultChannel", "default-channel", diagnostics)

        fallback_channels = product.get("fallbackChannels", ())
        if isinstance(fallback_channels, (str, bytes, bytearray)) or not isinstance(fallback_channels, Sequence):
            diagnostics.append(_diagnostic("invalid-fallback-channels", f"catalog.products.{product_id}.fallbackChannels", "fallbackChannels must be a sequence of channel ids"))
        else:
            seen: set[str] = set()
            for index, fallback in enumerate(fallback_channels):
                path = f"catalog.products.{product_id}.fallbackChannels[{index}]"
                ref = _validate_channel_ref(channels, fallback, path, "fallback-channel", diagnostics)
                if ref is not None:
                    if ref in seen:
                        diagnostics.append(_diagnostic("duplicate-fallback-channel", path, f"fallback channel {ref!r} is duplicated"))
                    seen.add(ref)

        cadence_channels = product.get("cadenceChannels", {})
        if not isinstance(cadence_channels, Mapping):
            diagnostics.append(_diagnostic("invalid-cadence-channels", f"catalog.products.{product_id}.cadenceChannels", "cadenceChannels must be an object"))
        else:
            for cadence, channel_id in cadence_channels.items():
                path = f"catalog.products.{product_id}.cadenceChannels.{cadence}"
                if not isinstance(cadence, str) or not cadence:
                    diagnostics.append(_diagnostic("invalid-cadence-key", path, "cadence key must be a non-empty string"))
                    continue
                ref = _validate_channel_ref(channels, channel_id, path, "cadence-channel", diagnostics)
                if ref is not None:
                    _validate_cadence_channel_support(channels, cadence, ref, path, diagnostics)

        if "businessInvoiceThreshold" in product:
            threshold = product.get("businessInvoiceThreshold")
            if not _non_bool_int(threshold) or threshold < 0:
                diagnostics.append(_diagnostic("invalid-business-invoice-threshold", f"catalog.products.{product_id}.businessInvoiceThreshold", "businessInvoiceThreshold must be a non-negative integer"))
            _validate_channel_ref(channels, product.get("businessInvoiceChannel"), f"catalog.products.{product_id}.businessInvoiceChannel", "business-invoice-channel", diagnostics)
        elif "businessInvoiceChannel" in product:
            _validate_channel_ref(channels, product.get("businessInvoiceChannel"), f"catalog.products.{product_id}.businessInvoiceChannel", "business-invoice-channel", diagnostics)
        if "domesticCardHeavyChannel" in product:
            _validate_channel_ref(channels, product.get("domesticCardHeavyChannel"), f"catalog.products.{product_id}.domesticCardHeavyChannel", "domestic-card-heavy-channel", diagnostics)
        if "allowedPreferredChannels" in product:
            allowed = product.get("allowedPreferredChannels")
            if isinstance(allowed, (str, bytes, bytearray)) or not isinstance(allowed, Sequence):
                diagnostics.append(_diagnostic("invalid-allowed-preferred-channels", f"catalog.products.{product_id}.allowedPreferredChannels", "allowedPreferredChannels must be a sequence"))
            else:
                for index, channel_id in enumerate(allowed):
                    _validate_channel_ref(channels, channel_id, f"catalog.products.{product_id}.allowedPreferredChannels[{index}]", "allowed-preferred-channel", diagnostics)
        _validate_amount_bound(product.get("minAmount"), f"catalog.products.{product_id}.minAmount", "invalid-product-min-amount", diagnostics)
        _validate_amount_bound(product.get("maxAmount"), f"catalog.products.{product_id}.maxAmount", "invalid-product-max-amount", diagnostics)
        if _non_bool_int(product.get("minAmount")) and _non_bool_int(product.get("maxAmount")) and product["minAmount"] > product["maxAmount"]:
            diagnostics.append(_diagnostic("invalid-product-amount-range", f"catalog.products.{product_id}", "minAmount must not exceed maxAmount"))

    diagnostics.extend(_walk_forbidden_runtime_keys(catalog))
    return {
        "ok": not diagnostics,
        "classification": "billing-channel-config-catalog-pass" if not diagnostics else "billing-channel-config-catalog-fail",
        "semanticsProfile": SEMANTICS_PROFILE,
        "generatedIsAuthority": False,
        "diagnosticCount": len(diagnostics),
        "diagnostics": diagnostics,
    }


def _coerce_request(request: BillingRequest | Mapping[str, Any]) -> tuple[BillingRequest, tuple[dict[str, Any], ...]]:
    diagnostics: list[dict[str, Any]] = []
    if isinstance(request, BillingRequest):
        raw = request.to_json()
    elif isinstance(request, Mapping):
        for key in sorted(str(k) for k in set(request.keys()) - _REQUEST_FIELD_NAMES):
            diagnostics.append(_diagnostic("unknown-request-field", f"request.{key}", "request contains an unknown field"))
        raw = {key: request[key] for key in _REQUEST_FIELD_NAMES if key in request}
    else:
        diagnostics.append(_diagnostic("invalid-request", "request", "request must be BillingRequest or mapping"))
        raw = {}
    if "product_id" not in raw:
        diagnostics.append(_diagnostic("missing-request-product", "request.product_id", "request.product_id is required"))
        raw["product_id"] = "<invalid>"
    raw.setdefault("customer_kind", "unknown")
    raw.setdefault("amount", None)
    raw.setdefault("currency", "JPY")
    raw.setdefault("cadence", "one_time")
    raw.setdefault("domestic_card_heavy", False)
    raw.setdefault("provider_blocked", ())
    raw.setdefault("preferred_channel", None)
    provider_blocked = raw.get("provider_blocked")
    if isinstance(provider_blocked, str):
        diagnostics.append(_diagnostic("invalid-provider-blocked", "request.provider_blocked", "provider_blocked must be a sequence of provider ids, not a scalar string"))
        raw["provider_blocked"] = ()
    elif isinstance(provider_blocked, Sequence) and not isinstance(provider_blocked, (bytes, bytearray)):
        normalized: list[str] = []
        seen: set[str] = set()
        for index, item in enumerate(provider_blocked):
            if not isinstance(item, str) or not item:
                diagnostics.append(_diagnostic("invalid-provider-blocked", f"request.provider_blocked[{index}]", "provider ids must be non-empty strings"))
            elif item not in seen:
                normalized.append(item)
                seen.add(item)
        raw["provider_blocked"] = tuple(normalized)
    else:
        diagnostics.append(_diagnostic("invalid-provider-blocked", "request.provider_blocked", "provider_blocked must be a sequence of provider ids"))
        raw["provider_blocked"] = ()
    try:
        return BillingRequest(**{key: raw[key] for key in _REQUEST_FIELD_NAMES}), tuple(diagnostics)
    except TypeError as exc:
        diagnostics.append(_diagnostic("invalid-request", "request", f"request could not be coerced: {exc}"))
        return BillingRequest(product_id=str(raw.get("product_id", "<invalid>"))), tuple(diagnostics)


def validate_request(request: BillingRequest | Mapping[str, Any], catalog: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Validate a request.  Passing catalog also validates provider/channel references."""

    req, diagnostics = _coerce_request(request)
    out = list(diagnostics)
    if not isinstance(req.product_id, str) or not req.product_id.strip():
        out.append(_diagnostic("invalid-request-product", "request.product_id", "product_id must be a non-empty string"))
    if not isinstance(req.customer_kind, str) or req.customer_kind not in ALLOWED_CUSTOMER_KINDS:
        out.append(_diagnostic("invalid-customer-kind", "request.customer_kind", "customer_kind must be unknown, individual, or business"))
    if req.amount is not None and (not _non_bool_int(req.amount) or req.amount <= 0):
        out.append(_diagnostic("invalid-amount", "request.amount", "amount must be a positive integer when provided"))
    if not isinstance(req.currency, str) or not _CURRENCY_RE.fullmatch(req.currency):
        out.append(_diagnostic("invalid-currency", "request.currency", "currency must be a three-letter uppercase code"))
    if not isinstance(req.cadence, str) or not req.cadence:
        out.append(_diagnostic("invalid-cadence", "request.cadence", "cadence must be a non-empty string"))
    if not isinstance(req.domestic_card_heavy, bool):
        out.append(_diagnostic("invalid-domestic-card-heavy", "request.domestic_card_heavy", "domestic_card_heavy must be boolean"))
    if req.preferred_channel is not None and (not isinstance(req.preferred_channel, str) or not req.preferred_channel):
        out.append(_diagnostic("invalid-preferred-channel", "request.preferred_channel", "preferred_channel must be non-empty string when provided"))

    if catalog is not None:
        providers = _as_mapping(catalog.get("providers"))
        channels = _as_mapping(catalog.get("channels"))
        for provider_id in req.provider_blocked:
            if provider_id not in providers:
                out.append(_diagnostic("unknown-blocked-provider", "request.provider_blocked", f"blocked provider {provider_id!r} is not declared"))
        if req.preferred_channel and req.preferred_channel not in channels:
            out.append(_diagnostic("unknown-preferred-channel", "request.preferred_channel", f"preferred channel {req.preferred_channel!r} is not declared"))

    return {
        "ok": not out,
        "classification": "billing-channel-config-request-pass" if not out else "billing-channel-config-request-fail",
        "semanticsProfile": SEMANTICS_PROFILE,
        "generatedIsAuthority": False,
        "diagnosticCount": len(out),
        "diagnostics": out,
        "request": req.to_json(),
    }


def _product_cadences(product: Mapping[str, Any]) -> set[str]:
    cadences = set(str(c) for c in _as_mapping(product.get("cadenceChannels")).keys() if isinstance(c, str))
    return cadences


def _product_eligibility_diagnostics(product_id: str, product: Mapping[str, Any], request: BillingRequest) -> tuple[dict[str, Any], ...]:
    reasons: list[str] = []
    amount = request.amount
    if _non_bool_int(amount):
        min_amount = product.get("minAmount")
        max_amount = product.get("maxAmount")
        if _non_bool_int(min_amount) and amount < min_amount:
            reasons.append("below-product-min-amount")
        if _non_bool_int(max_amount) and amount > max_amount:
            reasons.append("above-product-max-amount")
    product_cadences = _product_cadences(product)
    if product_cadences and request.cadence not in product_cadences:
        reasons.append("unsupported-product-cadence")
    if reasons:
        return (
            _diagnostic(
                "product-not-eligible-for-request",
                f"catalog.products.{product_id}",
                "request does not satisfy product-level eligibility constraints",
                productId=product_id,
                reasons=reasons,
            ),
        )
    return ()


def _business_high_value_channel(product: Mapping[str, Any], request: BillingRequest) -> str | None:
    threshold = product.get("businessInvoiceThreshold")
    invoice_channel = product.get("businessInvoiceChannel")
    if request.customer_kind == "business" and _non_bool_int(request.amount) and _non_bool_int(threshold) and request.amount >= threshold and isinstance(invoice_channel, str):
        return invoice_channel
    return None


def _cadence_channel(product: Mapping[str, Any], request: BillingRequest) -> str | None:
    candidate = _as_mapping(product.get("cadenceChannels")).get(request.cadence)
    return candidate if isinstance(candidate, str) else None


def _domestic_card_channel(product: Mapping[str, Any], request: BillingRequest) -> str | None:
    candidate = product.get("domesticCardHeavyChannel")
    if request.domestic_card_heavy and isinstance(candidate, str):
        return candidate
    return None


def _declared_product_channels(product: Mapping[str, Any]) -> set[str]:
    declared: set[str] = set()

    def add(value: Any) -> None:
        if isinstance(value, str) and value:
            declared.add(value)

    add(product.get("defaultChannel"))
    add(product.get("businessInvoiceChannel"))
    add(product.get("domesticCardHeavyChannel"))
    for fallback in _as_sequence(product.get("fallbackChannels")):
        add(fallback)
    for channel_id in _as_mapping(product.get("cadenceChannels")).values():
        add(channel_id)
    for channel_id in _as_sequence(product.get("allowedPreferredChannels")):
        add(channel_id)
    return declared


def _append_unique(ordered: list[str], candidate: Any) -> None:
    if isinstance(candidate, str) and candidate and candidate not in ordered:
        ordered.append(candidate)


def _select_candidate_order(product: Mapping[str, Any], request: BillingRequest) -> tuple[str, ...]:
    ordered: list[str] = []
    _append_unique(ordered, _business_high_value_channel(product, request))
    if request.cadence != "one_time":
        _append_unique(ordered, _cadence_channel(product, request))
    _append_unique(ordered, _domestic_card_channel(product, request))
    _append_unique(ordered, request.preferred_channel)
    if request.cadence == "one_time":
        _append_unique(ordered, _cadence_channel(product, request))
    _append_unique(ordered, product.get("defaultChannel"))
    for fallback in _as_sequence(product.get("fallbackChannels")):
        _append_unique(ordered, fallback)
    return tuple(ordered)


def _channel_rejection(channel_id: str, catalog: Mapping[str, Any], request: BillingRequest) -> tuple[str, ...]:
    reasons: list[str] = []
    channels = _as_mapping(catalog.get("channels"))
    providers = _as_mapping(catalog.get("providers"))
    channel = _as_mapping(channels.get(channel_id))
    if not channel:
        return ("unknown-channel",)
    channel_status = channel.get("status", "active")
    if channel_status in CHANNEL_UNAVAILABLE_STATUSES:
        reasons.append("channel-disabled")
    provider_id = channel.get("provider")
    provider = _as_mapping(providers.get(provider_id))
    if provider_id in set(request.provider_blocked):
        reasons.append("provider-blocked")
    if provider.get("status", "active") in PROVIDER_UNAVAILABLE_STATUSES:
        reasons.append("provider-disabled")
    supported_cadences = _supported(channel, "supportedCadences")
    if supported_cadences is not None and request.cadence not in supported_cadences:
        reasons.append("unsupported-cadence")
    supported_currencies = _supported(channel, "supportedCurrencies")
    if supported_currencies is not None and request.currency not in supported_currencies:
        reasons.append("unsupported-currency")
    if _non_bool_int(request.amount):
        min_amount = channel.get("minAmount")
        max_amount = channel.get("maxAmount")
        if _non_bool_int(min_amount) and request.amount < min_amount:
            reasons.append("below-channel-min-amount")
        if _non_bool_int(max_amount) and request.amount > max_amount:
            reasons.append("above-channel-max-amount")
    return tuple(reasons)


def _rejection_diagnostic(channel_id: str, reasons: Sequence[str]) -> dict[str, Any]:
    return _diagnostic(
        "candidate-channel-rejected",
        f"catalog.channels.{channel_id}",
        "candidate channel is not available for this request",
        channelId=channel_id,
        reasons=list(reasons),
    )


def _available(channel_id: str, catalog: Mapping[str, Any], request: BillingRequest) -> bool:
    return not _channel_rejection(channel_id, catalog, request)


def select_billing_channel(catalog: Mapping[str, Any], request: BillingRequest | Mapping[str, Any]) -> ChannelSelection:
    """Select the channel for a product/request using catalog data only."""

    req, _ = _coerce_request(request)
    request_report = validate_request(request, catalog=catalog)
    if not request_report["ok"]:
        return ChannelSelection(
            ok=False,
            product_id=req.product_id if isinstance(req.product_id, str) else "<invalid>",
            channel_id=None,
            provider_id=None,
            mode=None,
            reason="invalid-request",
            diagnostics=tuple(request_report["diagnostics"]),
        )

    catalog_report = validate_catalog(catalog)
    if not catalog_report["ok"]:
        return ChannelSelection(
            ok=False,
            product_id=req.product_id,
            channel_id=None,
            provider_id=None,
            mode=None,
            reason="invalid-catalog",
            diagnostics=tuple(catalog_report["diagnostics"]),
        )

    products = _as_mapping(catalog.get("products"))
    channels = _as_mapping(catalog.get("channels"))
    product = _as_mapping(products.get(req.product_id))
    if not product:
        return ChannelSelection(
            ok=False,
            product_id=req.product_id,
            channel_id=None,
            provider_id=None,
            mode=None,
            reason="unknown-product",
            diagnostics=(
                _diagnostic("unknown-product", f"catalog.products.{req.product_id}", "request.product_id is not declared in catalog"),
            ),
        )

    product_diags = _product_eligibility_diagnostics(req.product_id, product, req)
    if product_diags:
        return ChannelSelection(ok=False, product_id=req.product_id, channel_id=None, provider_id=None, mode=None, reason="product-not-eligible-for-request", diagnostics=product_diags)

    if req.preferred_channel and req.preferred_channel not in _declared_product_channels(product):
        return ChannelSelection(
            ok=False,
            product_id=req.product_id,
            channel_id=None,
            provider_id=None,
            mode=None,
            reason="preferred-channel-not-declared-for-product",
            diagnostics=(
                _diagnostic(
                    "preferred-channel-not-declared-for-product",
                    "request.preferred_channel",
                    "preferred_channel exists in catalog but is not declared for this product",
                    preferredChannel=req.preferred_channel,
                    productId=req.product_id,
                ),
            ),
        )

    order = _select_candidate_order(product, req)
    rejected: list[dict[str, Any]] = []
    selected: str | None = None
    for channel_id in order:
        reasons = _channel_rejection(channel_id, catalog, req)
        if reasons:
            rejected.append(_rejection_diagnostic(channel_id, reasons))
            continue
        selected = channel_id
        break

    if selected is None:
        return ChannelSelection(
            ok=False,
            product_id=req.product_id,
            channel_id=None,
            provider_id=None,
            mode=None,
            reason="no-available-channel",
            fallbacks=tuple(channel_id for channel_id in order if isinstance(channel_id, str)),
            diagnostics=tuple(rejected)
            + (
                _diagnostic(
                    "no-available-channel",
                    f"catalog.products.{req.product_id}",
                    "all product-declared candidate channels were rejected for this request",
                ),
            ),
        )

    channel = _as_mapping(channels.get(selected))
    remaining = tuple(channel_id for channel_id in order if channel_id != selected and _available(channel_id, catalog, req))
    return ChannelSelection(
        ok=True,
        product_id=req.product_id,
        channel_id=selected,
        provider_id=str(channel.get("provider")),
        mode=str(channel.get("mode")),
        reason=str(channel.get("selectionReason", product.get("selectionReason", "catalog-order"))),
        fallbacks=remaining,
        diagnostics=tuple(rejected),
    )


def add_channel(catalog: Mapping[str, Any], channel_id: str, channel: Mapping[str, Any], product_patches: Mapping[str, Mapping[str, Any]] | None = None) -> dict[str, Any]:
    """Return a new catalog with an additional channel/provider and product patches."""

    next_catalog = copy.deepcopy(dict(catalog))
    next_catalog["providers"] = copy.deepcopy(dict(_as_mapping(catalog.get("providers"))))
    next_catalog["channels"] = copy.deepcopy(dict(_as_mapping(catalog.get("channels"))))
    next_catalog["products"] = copy.deepcopy({k: dict(v) for k, v in _as_mapping(catalog.get("products")).items() if isinstance(v, Mapping)})
    provider_id = channel.get("provider")
    if isinstance(provider_id, str) and provider_id not in next_catalog["providers"]:
        next_catalog["providers"][provider_id] = {"label": provider_id, "status": "candidate"}
    next_catalog["channels"][channel_id] = copy.deepcopy(dict(channel))
    for product_id, patch in (product_patches or {}).items():
        current = copy.deepcopy(dict(next_catalog["products"].get(product_id, {})))
        current.update(copy.deepcopy(dict(patch)))
        next_catalog["products"][product_id] = current
    return next_catalog
