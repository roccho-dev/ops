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

TRANSIENT = {404, 408, 425, 429, 500, 502, 503, 504}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def call_once(base: str, path: str, *, method: str = "GET", value: object | None = None) -> tuple[int, object]:
    data = json.dumps(value, separators=(",", ":")).encode() if value is not None else None
    headers = {"accept": "application/json", "cache-control": "no-cache", "user-agent": "roccho-ops-semantic-evolution-proof"}
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
        raise RuntimeError(f"HTTP {status} non-JSON at {path}; type={content_type!r}; body={body[:500]!r}") from cause


def until(
    base: str,
    path: str,
    accepted: Callable[[int, object], bool],
    *,
    method: str = "GET",
    value: object | None = None,
    retry_unmatched: bool = False,
    attempts: int = 30,
) -> tuple[int, object, int]:
    last: object = None
    for attempt in range(1, attempts + 1):
        try:
            status, body = call_once(base, path, method=method, value=value)
            last = {"status": status, "body": body}
            if accepted(status, body):
                return status, body, attempt
            if status not in TRANSIENT and not retry_unmatched:
                raise AssertionError(canonical(last).strip())
        except (RuntimeError, urllib.error.URLError, TimeoutError) as error:
            last = {"error": repr(error)}
        if attempt < attempts:
            time.sleep(1)
    raise AssertionError(f"readback retries exhausted: {canonical(last).strip()}")


def is_obj(value: object) -> bool:
    return isinstance(value, dict)


def selection(proof_id: str, request_id: str, expected: str, next_digest: str) -> dict[str, object]:
    return {
        "schema": "adrs322.semanticBundleSelectionRequest/1",
        "request_id": request_id,
        "proof_id": proof_id,
        "expected_bundle_digest": expected,
        "next_bundle_digest": next_digest,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("proof_id")
    parser.add_argument("event_digest")
    parser.add_argument("bundle_v1_digest")
    parser.add_argument("bundle_v2_digest")
    parser.add_argument("expected_app_version")
    parser.add_argument("run_suffix")
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    retries: dict[str, int] = {}

    status, meta, n = until(
        args.base_url,
        "/api/meta",
        lambda code, body: code == 200 and is_obj(body) and body.get("app_version") == args.expected_app_version and body.get("proof_id") == args.proof_id,
        retry_unmatched=True,
    )
    retries["meta"] = n
    assert meta["event_digest"] == args.event_digest
    assert meta["admitted_bundle_digests"] == [args.bundle_v1_digest, args.bundle_v2_digest]

    status, evidence, n = until(args.base_url, "/api/evolution/evidence", lambda c, b: c == 200 and is_obj(b) and b.get("status") == "PASS", retry_unmatched=True)
    retries["initial_evidence"] = n
    assert evidence["event_object_digest"] == args.event_digest
    event_before = evidence["event_object_digest"]
    current = evidence.get("current_bundle_digest")

    if current is None:
        request = selection(args.proof_id, f"init-v1-{args.run_suffix}", "none", args.bundle_v1_digest)
        status, init, n = until(args.base_url, "/api/evolution/select", lambda c, b: is_obj(b) and ((c == 201 and b.get("duplicate") is False) or (c == 200 and b.get("duplicate") is True)), method="POST", value=request)
        retries["initialize_v1"] = n
    elif current == args.bundle_v2_digest:
        request = selection(args.proof_id, f"reconcile-v1-{args.run_suffix}", args.bundle_v2_digest, args.bundle_v1_digest)
        status, init, n = until(args.base_url, "/api/evolution/select", lambda c, b: is_obj(b) and ((c == 201 and b.get("duplicate") is False) or (c == 200 and b.get("duplicate") is True)), method="POST", value=request)
        retries["reconcile_v1"] = n
    else:
        assert current == args.bundle_v1_digest

    status, v1, n = until(
        args.base_url,
        "/api/evolution/surface",
        lambda c, b: c == 200 and is_obj(b) and b.get("semantic_bundle_digest") == args.bundle_v1_digest and b.get("app_version") == args.expected_app_version,
        retry_unmatched=True,
    )
    retries["surface_v1"] = n
    assert v1["event_object_digest"] == event_before
    assert len(v1["permitted_actions"]) == 1

    v2_request_id = f"select-v2-{args.run_suffix}"
    v2_request = selection(args.proof_id, v2_request_id, args.bundle_v1_digest, args.bundle_v2_digest)
    status, selected_v2, n = until(
        args.base_url,
        "/api/evolution/select",
        lambda c, b: is_obj(b) and ((c == 201 and b.get("current_bundle_digest") == args.bundle_v2_digest) or (c == 200 and b.get("duplicate") is True and b.get("current_bundle_digest") == args.bundle_v2_digest)),
        method="POST",
        value=v2_request,
    )
    retries["select_v2"] = n

    status, v2, n = until(
        args.base_url,
        "/api/evolution/surface",
        lambda c, b: c == 200 and is_obj(b) and b.get("semantic_bundle_digest") == args.bundle_v2_digest,
        retry_unmatched=True,
    )
    retries["surface_v2"] = n
    assert v2["event_object_digest"] == event_before
    assert v2["state_digest"] == v1["state_digest"]
    assert v2["surface_digest"] != v1["surface_digest"]
    assert len(v2["permitted_actions"]) == 2
    assert v2["app_version"] == v1["app_version"] == args.expected_app_version

    exact_path = f"/api/evolution/surface?{urllib.parse.urlencode({'bundle_digest': args.bundle_v1_digest})}"
    status, exact_v1, n = until(args.base_url, exact_path, lambda c, b: c == 200 and is_obj(b) and b.get("surface_digest") == v1["surface_digest"], retry_unmatched=True)
    retries["exact_v1_replay"] = n
    assert exact_v1["selection_mode"] == "exact"

    unknown = f"sha256:{'f' * 64}"
    status, unknown_result, n = until(
        args.base_url,
        f"/api/evolution/surface?{urllib.parse.urlencode({'bundle_digest': unknown})}",
        lambda c, b: c == 400 and is_obj(b) and b.get("code") == "UNADMITTED_BUNDLE",
    )
    retries["unknown_bundle"] = n

    stale = selection(args.proof_id, f"stale-{args.run_suffix}", args.bundle_v1_digest, args.bundle_v1_digest)
    status, stale_result, n = until(args.base_url, "/api/evolution/select", lambda c, b: c == 409 and is_obj(b) and b.get("code") == "STALE_EXPECTED_CURRENT", method="POST", value=stale)
    retries["stale_writer"] = n

    status, duplicate, n = until(args.base_url, "/api/evolution/select", lambda c, b: c == 200 and is_obj(b) and b.get("duplicate") is True, method="POST", value=v2_request)
    retries["duplicate_v2"] = n

    rollback_request = selection(args.proof_id, f"rollback-v1-{args.run_suffix}", args.bundle_v2_digest, args.bundle_v1_digest)
    status, rollback, n = until(
        args.base_url,
        "/api/evolution/select",
        lambda c, b: is_obj(b) and ((c == 201 and b.get("current_bundle_digest") == args.bundle_v1_digest) or (c == 200 and b.get("duplicate") is True and b.get("current_bundle_digest") == args.bundle_v1_digest)),
        method="POST",
        value=rollback_request,
    )
    retries["rollback_v1"] = n

    status, rolled, n = until(args.base_url, "/api/evolution/surface", lambda c, b: c == 200 and is_obj(b) and b.get("surface_digest") == v1["surface_digest"], retry_unmatched=True)
    retries["rollback_surface"] = n
    assert rolled["app_version"] == args.expected_app_version

    status, final_evidence, n = until(args.base_url, "/api/evolution/evidence", lambda c, b: c == 200 and is_obj(b) and b.get("current_bundle_digest") == args.bundle_v1_digest, retry_unmatched=True)
    retries["final_evidence"] = n
    assert final_evidence["event_object_digest"] == event_before == args.event_digest
    assert final_evidence["immutable_event_objects"] == 1
    assert final_evidence["immutable_bundle_objects"] == 2
    assert final_evidence["selection_pointer_objects"] == 1
    assert final_evidence["relationship_current_state_objects"] == 0

    receipt = {
        "schema": "ops.semanticBundleEvolutionRemoteHttpProof/1",
        "status": "PASS",
        "claim_ceiling": "BOUNDED_PROVIDER_PROOF",
        "authority": False,
        "base_url": args.base_url,
        "proof_id": args.proof_id,
        "app_version": args.expected_app_version,
        "kernel_id": v1["kernel_id"],
        "event_digest_before": event_before,
        "event_digest_after": final_evidence["event_object_digest"],
        "bundle_v1_digest": args.bundle_v1_digest,
        "bundle_v2_digest": args.bundle_v2_digest,
        "surface_v1_digest": v1["surface_digest"],
        "surface_v2_digest": v2["surface_digest"],
        "exact_v1_replay_digest": exact_v1["surface_digest"],
        "rollback_surface_digest": rolled["surface_digest"],
        "state_digest_equal_across_bundles": v1["state_digest"] == v2["state_digest"],
        "worker_version_stable": v1["app_version"] == v2["app_version"] == rolled["app_version"],
        "unknown_bundle_rejected": True,
        "stale_writer_rejected": True,
        "duplicate_selection_idempotent": True,
        "relationship_current_state_objects": 0,
        "retry_attempts": retries,
        "accepted_meaning_authority": False,
        "production_cutover": False,
    }
    args.output.write_text(canonical(receipt), encoding="utf-8")
    print(canonical(receipt), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
