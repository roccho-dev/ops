#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path
from typing import Any

SHA = re.compile(r"^[0-9a-f]{40}$")
BOUNDARY = {
    "accepted ADRS meaning",
    "final organization admission",
    "alternative required final-green interpretation",
}


class ClaimError(ValueError):
    pass


def need(condition: bool, code: str) -> None:
    if not condition:
        raise ClaimError(code)


def validate(claim: dict[str, Any], candidate_sha: str) -> dict[str, Any]:
    need(SHA.fullmatch(candidate_sha) is not None, "candidate-sha")
    need(claim.get("kind") == "governance.selectedConsumerClaim.v1", "kind")
    need(claim.get("repository") == "roccho-dev/ops", "repository")
    need(claim.get("role") == "migration-consumer-known-mismatch", "role")
    need(claim.get("allRepositoriesEnforced") is False, "all-repositories")
    need(set(claim.get("mustNotOwn", [])) == BOUNDARY, "ownership-boundary")

    decision = claim.get("decision", {})
    need(decision.get("source") == "roccho-dev/adrs#233", "decision-source")
    need(decision.get("decisionId") == "01K0D7C3A00000000000000233", "decision-id")
    need(decision.get("releaseId") == "final-organization-ci-topology-v1.0.0", "release")
    need(decision.get("acceptedMerge") == "a8fc9e8e04d53f1d783317059e4421c8dc724d01", "accepted-merge")
    need(decision.get("contractDigest") == "8106d85404e636a9797dfb8e0a1f6343db8a7867ff904577f682e5d82ad9b314", "contract-digest")

    assertion = claim.get("assertion", {})
    need(assertion.get("assertionId") == "ops.final-ci-migration-consumer.v1", "assertion-id")
    need(assertion.get("lifecycle") == "active", "lifecycle")
    need(assertion.get("generatedMeaningFreeAdapter") is True, "adapter")
    need(assertion.get("acceptedBundleDigest") == "sha256:" + decision["contractDigest"], "bundle")
    need(assertion.get("sourceClosureDigest") == "sha256:" + decision["acceptedMerge"], "closure")

    migration = claim.get("migration", {})
    need(migration.get("knownMismatch") == {"defaultBranch": "main", "requiredCheck": "repo-governance / proof"}, "known-mismatch")
    need(migration.get("correctedState") == {"defaultBranch": "proposals", "requiredCheck": "gov-final-scope-purpose-join / gate"}, "corrected-state")
    need(migration.get("knownMismatchRejected") is True, "mismatch-rejection")

    receipt = claim.get("receiptContract", {})
    need(receipt.get("candidateShaSource") == "github.event.pull_request.head.sha || github.sha", "sha-source")
    need(receipt.get("requiredResult") == "pass", "receipt-result")
    need(receipt.get("authority") is False, "receipt-authority")

    return {
        "kind": "governance.selectedConsumerReceipt.v1",
        "status": "pass",
        "repository": claim["repository"],
        "role": claim["role"],
        "candidateSha": candidate_sha,
        "assertionId": assertion["assertionId"],
        "acceptedBundleDigest": assertion["acceptedBundleDigest"],
        "sourceClosureDigest": assertion["sourceClosureDigest"],
        "knownMismatchRejected": True,
        "authority": False,
        "allRepositoriesEnforced": False,
    }


def selftest(claim: dict[str, Any]) -> dict[str, Any]:
    validate(copy.deepcopy(claim), "a" * 40)
    cases = [
        ("sha", lambda value: None, "bad"),
        ("repository", lambda value: value.update(repository="other/repo"), "a" * 40),
        ("role", lambda value: value.update(role="positive-feature-consumer"), "a" * 40),
        ("decision", lambda value: value["decision"].update(contractDigest="0" * 64), "a" * 40),
        ("old-state", lambda value: value["migration"].update(correctedState=value["migration"]["knownMismatch"]), "a" * 40),
        ("mismatch-green", lambda value: value["migration"].update(knownMismatchRejected=False), "a" * 40),
        ("overclaim", lambda value: value.update(allRepositoriesEnforced=True), "a" * 40),
    ]
    rejected = []
    for name, mutate, sha in cases:
        candidate = copy.deepcopy(claim)
        mutate(candidate)
        try:
            validate(candidate, sha)
        except ClaimError as exc:
            rejected.append({"case": name, "status": "rejected", "reason": str(exc)})
        else:
            raise ClaimError(f"destructive case passed: {name}")
    return {"kind": "governance.selectedConsumerSelftest.v1", "status": "pass", "positiveCases": 1, "destructiveCases": len(rejected), "cases": rejected, "authority": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "selftest"])
    parser.add_argument("--claim", type=Path, required=True)
    parser.add_argument("--candidate-sha", default="a" * 40)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    claim = json.loads(args.claim.read_text(encoding="utf-8"))
    report = validate(claim, args.candidate_sha) if args.command == "check" else selftest(claim)
    text = json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
