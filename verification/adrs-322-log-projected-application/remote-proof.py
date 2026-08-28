#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable


TRANSIENT_HTTP = {404, 408, 425, 429, 500, 502, 503, 504}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def call_once(base: str, path: str, *, method: str = "GET", value: object | None = None, raw: bytes | None = None) -> tuple[int, object]:
    data = raw if raw is not None else (json.dumps(value, separators=(",", ":")).encode() if value is not None else None)
    headers = {
        "accept": "application/json",
        "cache-control": "no-cache",
        "user-agent": "roccho-ops-adrs322-readback",
    }
    if data is not None:
        headers["content-type"] = "application/json"
    request = urllib.request.Request(f"{base.rstrip('/')}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status = response.status
            body = response.read()
            content_type = response.headers.get("content-type", "")
    except urllib.error.HTTPError as error:
        status = error.code
        body = error.read()
        content_type = error.headers.get("content-type", "")
    try:
        return status, json.loads(body)
    except json.JSONDecodeError as cause:
        raise RuntimeError(
            f"HTTP {status} returned non-JSON for {path}; content-type={content_type!r}; body={body[:500]!r}"
        ) from cause


def call_until(
    base: str,
    path: str,
    accepted: Callable[[int, object], bool],
    *,
    method: str = "GET",
    value: object | None = None,
    raw: bytes | None = None,
    retry_unmatched: bool = False,
    attempts: int = 30,
    delay: float = 1.0,
) -> tuple[int, object, int]:
    last: object = None
    for attempt in range(1, attempts + 1):
        try:
            status, body = call_once(base, path, method=method, value=value, raw=raw)
            last = {"status": status, "body": body}
            if accepted(status, body):
                return status, body, attempt
            if status not in TRANSIENT_HTTP and not retry_unmatched:
                raise AssertionError(f"unexpected response for {method} {path}: {canonical(last).strip()}")
        except (RuntimeError, TimeoutError, urllib.error.URLError) as error:
            last = {"error": repr(error)}
        if attempt < attempts:
            time.sleep(delay)
    raise AssertionError(f"bounded readback retries exhausted for {method} {path}: {canonical(last).strip()}")


def qs(**values: str) -> str:
    return urllib.parse.urlencode(values)


def is_object(value: object) -> bool:
    return isinstance(value, dict)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("subject_id")
    parser.add_argument("request_id")
    parser.add_argument("expected_app_version")
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    retry_counts: dict[str, int] = {}

    status, meta, attempts = call_until(
        args.base_url,
        "/api/meta",
        lambda code, body: code == 200 and is_object(body) and body.get("status") == "PASS" and body.get("app_version") == args.expected_app_version,
        retry_unmatched=True,
    )
    retry_counts["meta"] = attempts

    internal_path = f"/api/surface?{qs(profile_id='internal', subject_id='proof-internal-release')}"
    status, internal, attempts = call_until(
        args.base_url,
        internal_path,
        lambda code, body: code == 200 and is_object(body) and body.get("state_id") == "release-current" and body.get("app_version") == args.expected_app_version,
        retry_unmatched=True,
    )
    retry_counts["internal_before"] = attempts

    external_path = f"/api/surface?{qs(profile_id='external', subject_id=args.subject_id)}"
    status, before, attempts = call_until(
        args.base_url,
        external_path,
        lambda code, body: code == 200 and is_object(body) and body.get("state_id") == "available" and body.get("app_version") == args.expected_app_version,
        retry_unmatched=True,
    )
    retry_counts["external_before"] = attempts
    assert internal["kernel_digest"] == before["kernel_digest"]

    request = {"schema": "adrs322.actionObservationRequest/1", "request_id": args.request_id, "subject_id": args.subject_id, "profile_id": "external", "action_id": "continue"}
    status, append, attempts = call_until(
        args.base_url,
        "/api/observations",
        lambda code, body: is_object(body) and ((code == 201 and body.get("duplicate") is False) or (code == 200 and body.get("duplicate") is True)),
        method="POST",
        value=request,
    )
    retry_counts["initial_append"] = attempts
    initial_append_recovered_by_idempotency = status == 200 and append["duplicate"] is True

    readback_path = f"/api/observation?{qs(subject_id=args.subject_id, request_id=args.request_id)}"
    status, readback, attempts = call_until(
        args.base_url,
        readback_path,
        lambda code, body: code == 200 and is_object(body) and body.get("object_sha256") == append.get("object_sha256"),
        retry_unmatched=True,
    )
    retry_counts["observation_readback"] = attempts

    status, after, attempts = call_until(
        args.base_url,
        external_path,
        lambda code, body: code == 200 and is_object(body) and body.get("state_id") == "continued" and body.get("app_version") == args.expected_app_version,
        retry_unmatched=True,
    )
    retry_counts["external_after"] = attempts
    assert after["surface_digest"] != before["surface_digest"]
    assert after["kernel_digest"] == internal["kernel_digest"]

    status, duplicate, attempts = call_until(
        args.base_url,
        "/api/observations",
        lambda code, body: code == 200 and is_object(body) and body.get("duplicate") is True,
        method="POST",
        value=request,
    )
    retry_counts["explicit_duplicate"] = attempts

    conflict = {**request, "action_id": "other-action"}
    status, conflict_result, attempts = call_until(
        args.base_url,
        "/api/observations",
        lambda code, body: code == 409 and is_object(body) and body.get("code") == "IDEMPOTENCY_CONFLICT",
        method="POST",
        value=conflict,
    )
    retry_counts["idempotency_conflict"] = attempts

    unknown = {**request, "request_id": f"{args.request_id}-unknown", "action_id": "unknown-action"}
    status, unknown_result, attempts = call_until(
        args.base_url,
        "/api/observations",
        lambda code, body: code == 409 and is_object(body) and body.get("code") == "ACTION_NOT_PERMITTED",
        method="POST",
        value=unknown,
    )
    retry_counts["unknown_action"] = attempts

    pii = {**request, "request_id": f"{args.request_id}-pii", "email": "private@example.invalid"}
    status, pii_result, attempts = call_until(
        args.base_url,
        "/api/observations",
        lambda code, body: code == 400 and is_object(body) and body.get("code") == "INVALID_REQUEST",
        method="POST",
        value=pii,
    )
    retry_counts["pii_rejection"] = attempts

    status, malformed, attempts = call_until(
        args.base_url,
        "/api/observations",
        lambda code, body: code == 400 and is_object(body) and body.get("code") == "INVALID_REQUEST",
        method="POST",
        raw=b"{bad json",
    )
    retry_counts["malformed_rejection"] = attempts

    evidence_path = f"/api/evidence?{qs(subject_id=args.subject_id)}"
    status, evidence, attempts = call_until(
        args.base_url,
        evidence_path,
        lambda code, body: code == 200 and is_object(body) and body.get("object_count") == 1 and body.get("projection_object_count") == 0,
        retry_unmatched=True,
    )
    retry_counts["evidence"] = attempts

    status, replay, attempts = call_until(
        args.base_url,
        external_path,
        lambda code, body: code == 200 and is_object(body) and body.get("surface_digest") == after["surface_digest"] and body.get("state_digest") == after["state_digest"],
        retry_unmatched=True,
    )
    retry_counts["reload_replay"] = attempts

    status, internal_after, attempts = call_until(
        args.base_url,
        internal_path,
        lambda code, body: code == 200 and is_object(body) and body.get("surface_digest") == internal["surface_digest"],
        retry_unmatched=True,
    )
    retry_counts["internal_after"] = attempts

    receipt = {
        "schema": "ops.logProjectedApplicationRemoteHttpProof/1",
        "status": "PASS",
        "claim_ceiling": "BOUNDED_PROVIDER_PROOF",
        "authority": False,
        "base_url": args.base_url,
        "app_version": meta["app_version"],
        "kernel_id": internal["kernel_id"],
        "kernel_digest": internal["kernel_digest"],
        "semantic_bundle_digest": internal["semantic_bundle_digest"],
        "internal_surface_digest": internal["surface_digest"],
        "external_before_surface_digest": before["surface_digest"],
        "observation_object_key": append["object_key"],
        "observation_object_sha256": append["object_sha256"],
        "external_after_surface_digest": after["surface_digest"],
        "reload_surface_digest": replay["surface_digest"],
        "initial_append_recovered_by_idempotency": initial_append_recovered_by_idempotency,
        "retry_attempts": retry_counts,
        "duplicate_result": "PASS",
        "idempotency_conflict": "PASS",
        "unknown_action_rejected": "PASS",
        "pii_shaped_field_rejected": "PASS",
        "malformed_json_rejected": "PASS",
        "R2_remote_readback": "PASS",
        "object_count": evidence["object_count"],
        "projection_object_count": evidence["projection_object_count"],
        "internal_subject_isolation": "PASS",
        "production_cutover": False,
    }
    args.output.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
