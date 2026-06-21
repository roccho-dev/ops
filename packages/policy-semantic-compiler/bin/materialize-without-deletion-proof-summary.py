#!/usr/bin/env python3
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def md_escape(value) -> str:
    return str(value if value is not None else "").replace("|", "\\|").replace("\n", " ")


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
        "projectedRuleCount": len(projected.get("outputs", {}).get("rules", [])),
        "projectedRulesCoverLegacyObligations": len(projected.get("outputs", {}).get("rules", [])) == len(rows),
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
