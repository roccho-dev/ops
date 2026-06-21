#!/usr/bin/env python3
from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def md_escape(value) -> str:
    return str(value if value is not None else "").replace("|", "\\|").replace("\n", " ")


def rule_path_for(row: dict, index: int) -> str:
    stem = row.get("nativeId") or row.get("signalId") or f"rule-{index}"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", str(stem)).strip("-").lower() or f"rule-{index}"
    return f"rules/{safe}.md"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--policy-input-ref", required=True)
    args = parser.parse_args()

    root = Path(args.evidence_dir)
    rows = read_jsonl(root / "legacy_policy_obligation_table.jsonl")
    gates = read_jsonl(root / "deletion_readiness_gates.jsonl")
    projected = read_json(root / "projected_policy_entry_manifest.json")
    readiness = read_json(root / "deletion_readiness_manifest.json")
    projected_rules = projected.get("outputs", {}).get("rules", [])
    projected_rule_set = set(projected_rules)

    table = [
        "| # | id | scope | modal | polarity | text |",
        "|---:|---|---|---|---|---|",
    ]
    for index, row in enumerate(rows, start=1):
        table.append(
            "| {index} | `{native}` | `{scope}` | `{modal}` | `{polarity}` | {text} |".format(
                index=index,
                native=md_escape(row.get("nativeId")),
                scope=md_escape(row.get("scope")),
                modal=md_escape(row.get("modal")),
                polarity=md_escape(row.get("polarity")),
                text=md_escape(row.get("text")),
            )
        )
    (root / "legacy_policy_obligation_table.md").write_text("\n".join(table) + "\n", encoding="utf-8")

    projection_checks = []
    for index, row in enumerate(rows, start=1):
        expected_path = rule_path_for(row, index)
        projection_checks.append(
            {
                "type": "policy.retirement.legacyObligationProjectionCheck.v1",
                "index": index,
                "nativeId": row.get("nativeId"),
                "scope": row.get("scope"),
                "modal": row.get("modal"),
                "polarity": row.get("polarity"),
                "expectedProjectedRule": expected_path,
                "projectedRulePresent": expected_path in projected_rule_set,
                "status": "pass" if expected_path in projected_rule_set else "fail",
            }
        )
    (root / "legacy_policy_obligation_projection_verification.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in projection_checks),
        encoding="utf-8",
    )

    counts = collections.Counter((row.get("modal"), row.get("polarity")) for row in rows)
    deletion_gate = next((gate for gate in gates if gate.get("gate_id") == "deletion-approved"), None)
    non_deletion_gates = [gate for gate in gates if gate.get("gate_id") != "deletion-approved"]
    summary = {
        "type": "policy.retirement.withoutDeletionProofSummary.v1",
        "policyInputRef": args.policy_input_ref,
        "legacyObligationCount": len(rows),
        "legacyObligationCounts": {
            f"{modal}:{polarity}": count for (modal, polarity), count in sorted(counts.items())
        },
        "projectionAcceptedSource": projected.get("accepted"),
        "projectionFixtureOnly": projected.get("fixtureOnly"),
        "projectionGeneratedIsAuthority": projected.get("generatedIsAuthority"),
        "projectionCutoverReady": projected.get("cutoverReady"),
        "projectionPolicyDeletionApproved": projected.get("policyDeletionApproved"),
        "activeRuntimeReferenceCount": readiness.get("activeRuntimeReferenceCount"),
        "policyAbsentConsumersPass": readiness.get("policyAbsentConsumersPass"),
        "consumerProofsPass": readiness.get("consumerProofsPass"),
        "projectedRuleCount": len(projected_rules),
        "uniqueProjectedRuleCount": len(projected_rule_set),
        "projectedRulesCoverLegacyObligations": len(projected_rules) == len(rows),
        "legacyObligationProjectionCheckCount": len(projection_checks),
        "legacyObligationProjectionFailures": [
            row for row in projection_checks if row.get("status") != "pass"
        ],
        "allLegacyObligationsProjected": all(row.get("status") == "pass" for row in projection_checks),
        "nonDeletionGatesPass": all(gate.get("status") == "pass" for gate in non_deletion_gates),
        "deletionApprovalGate": deletion_gate,
        "policyDeletionApproved": False,
        "cutoverReady": False,
    }
    (root / "without_deletion_proof_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0 if summary["nonDeletionGatesPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
