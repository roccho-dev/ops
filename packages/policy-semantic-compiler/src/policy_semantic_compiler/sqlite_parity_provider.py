from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .sqlite_parity_contract import read_jsonl_loose, write_jsonl


def _run(command: list[str], allowed: set[int] = {0}) -> None:
    proc = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode not in allowed:
        raise RuntimeError(
            f"provider fixture command failed ({proc.returncode}): {' '.join(command)}\n"
            f"stdout={proc.stdout[-2000:]}\nstderr={proc.stderr[-2000:]}"
        )


def _copy_jsonl_files(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for path in source.glob("*.jsonl"):
        shutil.copy2(path, target / path.name)


def _first(path: Path) -> dict[str, Any]:
    rows = read_jsonl_loose(path)
    if not rows:
        raise RuntimeError(f"provider fixture output is empty: {path}")
    return rows[0]


def build_provider_fixtures(
    compiler: str,
    candidate_fixture: Path,
    work_root: Path,
    policy_rev: str,
) -> dict[str, Path]:
    """Build current review-provider records through the production CLI.

    The incomplete fixture contains all non-authoritative provider work records but
    no accepted review/discussion results. The accepted-results fixture adds the
    exact accepted result shapes expected by the current Python post-gate reducer.
    """

    root = work_root / "provider-fixtures"
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True)

    review_out = root / "candidate-review"
    _run(
        [
            compiler,
            "review-adrs-projection-duckdb",
            "--adrs-records-dir",
            str(candidate_fixture),
            "--policy-rev",
            policy_rev,
            "--out-dir",
            str(review_out),
        ],
        allowed={1},
    )
    missing = review_out / "missing-accepted-span-dispositions.jsonl"
    if not missing.exists():
        raise RuntimeError("candidate provider fixture did not produce missing span evidence")

    batches = root / "batches"
    _run(
        [
            compiler,
            "materialize-source-span-review-batches",
            "--missing-span-dispositions",
            str(missing),
            "--policy-rev",
            policy_rev,
            "--batch-size",
            "1",
            "--out-dir",
            str(batches),
        ]
    )

    assignments = root / "assignments"
    _run(
        [
            compiler,
            "assign-source-span-review-batches",
            "--batches",
            str(batches / "source-span-disposition-review-batches.jsonl"),
            "--reviewers",
            "reviewer-a,reviewer-b",
            "--out-dir",
            str(assignments),
        ]
    )

    packets = root / "packets"
    _run(
        [
            compiler,
            "materialize-source-span-review-packets",
            "--source-spans",
            str(candidate_fixture / "policy.sourceSpan.v1.jsonl"),
            "--batches",
            str(batches / "policy.sourceSpanDispositionReviewBatch.v1.jsonl"),
            "--policy-rev",
            policy_rev,
            "--out-dir",
            str(packets),
        ]
    )

    work_orders = root / "work-orders"
    _run(
        [
            compiler,
            "materialize-source-span-review-work-orders",
            "--assignments",
            str(assignments / "policy.sourceSpanDispositionReviewAssignment.v1.jsonl"),
            "--review-packets",
            str(packets / "policy.sourceSpanDispositionReviewPacket.v1.jsonl"),
            "--policy-rev",
            policy_rev,
            "--out-dir",
            str(work_orders),
        ]
    )

    result_templates = root / "result-templates"
    _run(
        [
            compiler,
            "materialize-source-span-review-result-templates",
            "--work-orders",
            str(work_orders / "policy.sourceSpanDispositionReviewerWorkOrder.v1.jsonl"),
            "--policy-rev",
            policy_rev,
            "--out-dir",
            str(result_templates),
        ]
    )

    discussion_templates = root / "discussion-templates"
    _run(
        [
            compiler,
            "materialize-source-span-direct-cross-discussion-templates",
            "--required-discussions",
            str(assignments / "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1.jsonl"),
            "--review-result-templates",
            str(result_templates / "policy.sourceSpanDispositionReviewResultTemplate.v1.jsonl"),
            "--policy-rev",
            policy_rev,
            "--out-dir",
            str(discussion_templates),
        ]
    )

    incomplete = root / "provider-workflow-incomplete"
    _copy_jsonl_files(candidate_fixture, incomplete)
    generated = [
        batches / "policy.sourceSpanDispositionReviewBatch.v1.jsonl",
        assignments / "policy.sourceSpanDispositionReviewAssignment.v1.jsonl",
        assignments / "policy.sourceSpanDispositionDirectCrossDiscussionRequired.v1.jsonl",
        packets / "policy.sourceSpanDispositionReviewPacket.v1.jsonl",
        work_orders / "policy.sourceSpanDispositionReviewerWorkOrder.v1.jsonl",
        result_templates / "policy.sourceSpanDispositionReviewResultTemplate.v1.jsonl",
        discussion_templates / "policy.sourceSpanDispositionDirectCrossDiscussionTemplate.v1.jsonl",
    ]
    for path in generated:
        if not path.exists():
            raise RuntimeError(f"provider fixture output is missing: {path}")
        shutil.copy2(path, incomplete / path.name)

    accepted = root / "provider-workflow-accepted-results"
    shutil.copytree(incomplete, accepted)
    assignment_rows = read_jsonl_loose(
        accepted / "policy.sourceSpanDispositionReviewAssignment.v1.jsonl"
    )
    packet = _first(accepted / "policy.sourceSpanDispositionReviewPacket.v1.jsonl")
    if len(assignment_rows) < 2:
        raise RuntimeError("provider fixture requires two reviewer assignments")

    results: list[dict[str, Any]] = []
    for index, assignment in enumerate(assignment_rows, start=1):
        results.append(
            {
                "id": f"parity-review-result-{index}",
                "kind": "policy.sourceSpanDispositionReviewResult.v1",
                "batchId": assignment["batchId"],
                "reviewerId": assignment["reviewerId"],
                "policyRev": policy_rev,
                "packetId": packet["id"],
                "packetRead": True,
                "sourceSpanIds": assignment["sourceSpanIds"],
                "disposition": "represented",
                "rationale": "parity fixture reviewer accepted the generated projection-only packet",
                "noRemainingObjections": True,
                "accepted": True,
                "status": "accepted",
                "fixtureOnly": False,
                "generatedIsAuthority": False,
                "policyDeletionApproved": False,
            }
        )
    write_jsonl(accepted / "policy.sourceSpanDispositionReviewResult.v1.jsonl", results)

    batch_id = str(assignment_rows[0]["batchId"])
    reviewer_ids = sorted(str(row["reviewerId"]) for row in assignment_rows)
    discussion = {
        "id": "parity-direct-cross-discussion-accepted",
        "kind": "policy.sourceSpanDispositionDirectCrossDiscussion.v1",
        "batchId": batch_id,
        "policyRev": policy_rev,
        "reviewResultIds": [row["id"] for row in results],
        "peerRepliesReadByReviewerIds": reviewer_ids,
        "rationale": "parity fixture reviewers read peer results and recorded no remaining objections",
        "accepted": True,
        "status": "accepted",
        "sameRevision": True,
        "peerRepliesRead": True,
        "noRemainingObjections": True,
        "fixtureOnly": False,
        "generatedIsAuthority": False,
        "policyDeletionApproved": False,
    }
    write_jsonl(
        accepted / "policy.sourceSpanDispositionDirectCrossDiscussion.v1.jsonl",
        [discussion],
    )

    manifest = {
        "kind": "ops.sqliteParityProviderFixtures.v1",
        "policyRev": policy_rev,
        "fixtures": {
            "provider-workflow-incomplete": str(incomplete),
            "provider-workflow-accepted-results": str(accepted),
        },
        "generatedIsAuthority": False,
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    return {
        "provider-workflow-incomplete": incomplete,
        "provider-workflow-accepted-results": accepted,
    }
