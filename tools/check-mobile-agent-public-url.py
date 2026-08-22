#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
DEPLOYMENT_HOST = re.compile(r"^[a-z0-9-]+\.stg-mobile-agent\.pages\.dev$")
ALLOWED_PRESETS = {"graph/1", "map/1", "seq/1"}
INTERACTIONS = {
    "graph/1": "drag→undo→redo",
    "map/1": "zoom",
    "seq/1": "edit→undo",
}


class ReceiptError(ValueError):
    pass


def need(condition: bool, code: str) -> None:
    if not condition:
        raise ReceiptError(code)


def _url(value: str, *, stable: bool) -> tuple[str, str]:
    parts = urlsplit(value)
    need(parts.scheme == "https", "url-scheme")
    need(parts.username is None and parts.password is None, "url-userinfo")
    need(parts.query == "", "url-query")
    need(parts.path.rstrip("/") == "/app", "url-path")
    need(parts.fragment.startswith("smap=") and len(parts.fragment) > 16, "url-smap")
    if stable:
        need(parts.netloc == "stg-mobile-agent.pages.dev", "stable-host")
    else:
        need(DEPLOYMENT_HOST.fullmatch(parts.netloc) is not None, "deployment-host")
        need(parts.netloc != "stg-mobile-agent.pages.dev", "deployment-not-stable")
    return parts.netloc, parts.fragment


def validate(contract: dict[str, Any], receipt: dict[str, Any], candidate_sha: str) -> dict[str, Any]:
    need(SHA40.fullmatch(candidate_sha) is not None, "candidate-sha")
    need(contract.get("schema") == "ops.mobileAgentPublicUrlContract/1", "contract-schema")
    need(contract.get("repository") == "roccho-dev/ops", "contract-repository")
    need(contract.get("acceptedRef") == "accepted/mobile-agent-public-url", "accepted-ref")
    need(contract.get("requiredCheck") == "Mobile Agent public URL required / gate", "required-check")
    need(contract.get("stableOrigin") == "https://stg-mobile-agent.pages.dev", "stable-origin")
    need(set(contract.get("allowedPresets", [])) == ALLOWED_PRESETS, "allowed-presets")
    reporting = contract.get("reporting", {})
    need(reporting.get("receiptOnly") is True, "receipt-only")
    need(reporting.get("missingReceiptMeansZeroUrls") is True, "missing-zero")

    need(receipt.get("schema") == "ops.mobileAgentPublicUrlReceipt/1", "receipt-schema")
    need(receipt.get("status") == "PASS", "receipt-status")
    need(receipt.get("authority") is False, "receipt-authority")
    need(receipt.get("repository") == contract["repository"], "receipt-repository")
    need(receipt.get("candidateSha") == candidate_sha, "receipt-candidate")

    carrier = receipt.get("carrier", {})
    need(isinstance(carrier.get("tag"), str) and carrier["tag"] != "" and "latest" not in carrier["tag"].lower(), "carrier-tag")
    need(SHA256.fullmatch(str(carrier.get("sha256", ""))) is not None, "carrier-sha")

    provider = receipt.get("provider", {})
    need(provider.get("kind") == "cloudflare-pages", "provider-kind")
    need(provider.get("project") == "stg-mobile-agent", "provider-project")
    need(provider.get("stableBase") == "https://stg-mobile-agent.pages.dev/", "provider-stable")
    deployment_base = str(provider.get("deploymentBase", ""))
    deployment_parts = urlsplit(deployment_base)
    need(deployment_parts.scheme == "https" and deployment_parts.path in ("", "/"), "provider-deployment-base")
    need(DEPLOYMENT_HOST.fullmatch(deployment_parts.netloc) is not None, "provider-deployment-host")

    app = receipt.get("app", {})
    need(isinstance(app.get("bytes"), int) and app["bytes"] > 0, "app-bytes")
    need(SHA256.fullmatch(str(app.get("sha256", ""))) is not None, "app-sha")
    need(app.get("stableReadback") == "PASS", "stable-readback")
    need(app.get("immutableReadback") == "PASS", "immutable-readback")

    cases = receipt.get("cases")
    need(isinstance(cases, list) and len(cases) >= 1, "cases")
    seen: set[str] = set()
    normalized_cases: list[dict[str, Any]] = []
    for case in cases:
        preset = case.get("preset")
        need(preset in ALLOWED_PRESETS, "case-preset")
        need(preset not in seen, "case-duplicate")
        seen.add(preset)
        need(case.get("runtimePattern") == preset, "runtime-pattern")
        need(case.get("maxGraph") is True, "maxgraph")
        need(case.get("roundTripExact") is True, "roundtrip")
        need(case.get("interaction") == INTERACTIONS[preset], "interaction")
        need(case.get("browserErrors") == 0, "browser-errors")
        need(case.get("failedResponses") == 0, "failed-responses")
        _, stable_fragment = _url(str(case.get("stableUrl", "")), stable=True)
        _, immutable_fragment = _url(str(case.get("immutableUrl", "")), stable=False)
        need(stable_fragment == immutable_fragment, "fragment-identity")
        normalized_cases.append({
            "preset": preset,
            "stableUrl": case["stableUrl"],
            "immutableUrl": case["immutableUrl"],
            "runtimePattern": preset,
            "maxGraph": True,
            "interaction": INTERACTIONS[preset],
            "browserErrors": 0,
            "failedResponses": 0,
            "roundTripExact": True,
        })

    proof = receipt.get("proof", {})
    need(proof.get("stableChrome") == "PASS", "stable-chrome")
    need(proof.get("immutableChrome") == "PASS", "immutable-chrome")
    need(isinstance(proof.get("runId"), int) and proof["runId"] > 0, "run-id")
    need(SHA256.fullmatch(str(proof.get("artifactDigest", ""))) is not None, "artifact-digest")

    return {
        "schema": "ops.mobileAgentPublicUrlAcceptedReceipt/1",
        "status": "PASS",
        "authority": False,
        "repository": contract["repository"],
        "candidateSha": candidate_sha,
        "acceptedRef": contract["acceptedRef"],
        "carrier": copy.deepcopy(carrier),
        "provider": copy.deepcopy(provider),
        "app": copy.deepcopy(app),
        "cases": normalized_cases,
        "proof": copy.deepcopy(proof),
    }


def _fixture() -> tuple[dict[str, Any], dict[str, Any]]:
    contract = {
        "schema": "ops.mobileAgentPublicUrlContract/1",
        "repository": "roccho-dev/ops",
        "acceptedRef": "accepted/mobile-agent-public-url",
        "requiredCheck": "Mobile Agent public URL required / gate",
        "stableOrigin": "https://stg-mobile-agent.pages.dev",
        "allowedPresets": ["graph/1", "map/1", "seq/1"],
        "reporting": {"receiptOnly": True, "missingReceiptMeansZeroUrls": True},
    }
    fragment = "smap=" + "a" * 80
    receipt = {
        "schema": "ops.mobileAgentPublicUrlReceipt/1",
        "status": "PASS",
        "authority": False,
        "repository": "roccho-dev/ops",
        "candidateSha": "a" * 40,
        "carrier": {"tag": "mobile-agent-app-carrier-deadbeef", "sha256": "sha256:" + "b" * 64},
        "provider": {
            "kind": "cloudflare-pages",
            "project": "stg-mobile-agent",
            "stableBase": "https://stg-mobile-agent.pages.dev/",
            "deploymentBase": "https://abc123.stg-mobile-agent.pages.dev/",
        },
        "app": {
            "bytes": 2412388,
            "sha256": "sha256:" + "c" * 64,
            "stableReadback": "PASS",
            "immutableReadback": "PASS",
        },
        "cases": [{
            "preset": "seq/1",
            "stableUrl": f"https://stg-mobile-agent.pages.dev/app/#smap={'a' * 80}",
            "immutableUrl": f"https://abc123.stg-mobile-agent.pages.dev/app/#smap={'a' * 80}",
            "runtimePattern": "seq/1",
            "maxGraph": True,
            "roundTripExact": True,
            "interaction": "edit→undo",
            "browserErrors": 0,
            "failedResponses": 0,
        }],
        "proof": {
            "stableChrome": "PASS",
            "immutableChrome": "PASS",
            "runId": 123,
            "artifactDigest": "sha256:" + "d" * 64,
        },
    }
    return contract, receipt


def selftest() -> dict[str, Any]:
    contract, receipt = _fixture()
    validate(copy.deepcopy(contract), copy.deepcopy(receipt), "a" * 40)
    cases = [
        ("candidate", lambda c, r: r.update(candidateSha="f" * 40)),
        ("status", lambda c, r: r.update(status="FAIL")),
        ("latest", lambda c, r: r["carrier"].update(tag="latest")),
        ("stable-host", lambda c, r: r["cases"][0].update(stableUrl=r["cases"][0]["stableUrl"].replace("stg-mobile-agent", "other"))),
        ("no-smap", lambda c, r: r["cases"][0].update(stableUrl="https://stg-mobile-agent.pages.dev/app/")),
        ("fragment", lambda c, r: r["cases"][0].update(immutableUrl=r["cases"][0]["immutableUrl"] + "x")),
        ("preset", lambda c, r: r["cases"][0].update(preset="custom/1", runtimePattern="custom/1")),
        ("runtime", lambda c, r: r["cases"][0].update(runtimePattern="graph/1")),
        ("maxgraph", lambda c, r: r["cases"][0].update(maxGraph=False)),
        ("interaction", lambda c, r: r["cases"][0].update(interaction="screenshot")),
        ("browser-error", lambda c, r: r["cases"][0].update(browserErrors=1)),
        ("failed-response", lambda c, r: r["cases"][0].update(failedResponses=1)),
        ("stable-readback", lambda c, r: r["app"].update(stableReadback="UNKNOWN")),
        ("chrome", lambda c, r: r["proof"].update(stableChrome="UNKNOWN")),
        ("duplicate", lambda c, r: r["cases"].append(copy.deepcopy(r["cases"][0]))),
    ]
    rejected = []
    for name, mutate in cases:
        c, r = copy.deepcopy(contract), copy.deepcopy(receipt)
        mutate(c, r)
        try:
            validate(c, r, "a" * 40)
        except ReceiptError as exc:
            rejected.append({"case": name, "status": "rejected", "reason": str(exc)})
        else:
            raise ReceiptError(f"destructive-case-passed:{name}")
    return {
        "schema": "ops.mobileAgentPublicUrlSelftest/1",
        "status": "PASS",
        "positiveCases": 1,
        "destructiveCases": len(rejected),
        "cases": rejected,
        "authority": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "selftest"])
    parser.add_argument("--contract", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--candidate-sha")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    if args.command == "selftest":
        report = selftest()
    else:
        need(args.contract is not None, "contract-arg")
        need(args.receipt is not None, "receipt-arg")
        need(args.candidate_sha is not None, "candidate-arg")
        report = validate(
            json.loads(args.contract.read_text(encoding="utf-8")),
            json.loads(args.receipt.read_text(encoding="utf-8")),
            args.candidate_sha,
        )
    text = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
