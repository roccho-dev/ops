import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "lib"))

from ops_thread_fsm.core import classify as core_classify
from ops_thread_fsm.plan import evaluate_plan_value
from ops_thread_fsm.state_model import PLAN_ACCEPTED, canonical_state_kind


def _complete_payload(**overrides):
    payload = {
        "planComplete": True,
        "localBaseEvidenceValid": True,
        "successConditionsPresent": True,
        "failureConditionsPresent": True,
        "gatesPresent": True,
        "reportableEvidencePresent": True,
        "worktreeBranchAbsent": True,
        "noMerge": True,
        "noPush": True,
        "noOverwrite": True,
        "preAuthorized": True,
        "localBaseEvidence": "local base abc123 from git merge-base readback",
        "baseEvidence": "base origin/main abc123",
        "upstreamEvidence": "upstream origin/main def456",
        "headEvidence": "candidate head 56977c1",
        "worktreeEvidence": "worktree /tmp/wt is isolated",
        "branchEvidence": "branch task/ops-fsm-safe-continue-20260509",
        "successConditionsEvidence": "success requires impl-review acceptance",
        "failureConditionsEvidence": "failure if merge/push/overwrite is requested",
        "gatesEvidence": "run pytest for ops-thread-fsm",
        "reportableEvidence": "report changed files and gate results",
    }
    payload.update(overrides)
    return payload


def test_plan_accepted_is_canonical_for_legacy_state_kind_alias():
    assert canonical_state_kind("accepted" + "-plan") == PLAN_ACCEPTED
    result = core_classify(state_kind="accepted" + "-plan")
    assert result["classification"] == "plan-accepted"
    assert result["stateKind"] == "plan-accepted"


def test_safe_auto_continue_requires_concrete_evidence_not_only_booleans():
    payload = _complete_payload(localBaseEvidence=True)
    result = evaluate_plan_value(payload)
    assert result["classification"] == "insufficient-plan"
    assert "localBase" in result["missingEvidence"]


def test_safe_auto_continue_accepts_only_with_all_concrete_evidence():
    result = evaluate_plan_value(_complete_payload())
    assert result["classification"] == "plan-accepted"
    assert result["stateKind"] == "plan-accepted"
    assert result["autoContinue"] is True
    assert "localBase" in result["evidence"]
    assert "reportableEvidence" in result["evidence"]


def test_false_blocker_requires_readback_evidence():
    result = evaluate_plan_value(
        {
            "readbackDisprovesBlocker": True,
            "blockerClaim": "review claimed worktree evidence is absent",
        }
    )
    assert result["classification"] == "insufficient-plan"
    assert "readbackEvidence" in result["missingEvidence"]


def test_false_blocker_emits_readback_evidence_when_present():
    result = evaluate_plan_value(
        {
            "readbackDisprovesBlocker": True,
            "blockerClaim": "review claimed worktree evidence is absent",
            "readbackEvidence": "review readback line shows worktree evidence is present",
        }
    )
    assert result["classification"] == "false-blocker"
    assert "readbackEvidence" in result["evidence"]


def test_destructive_scope_takes_precedence_over_false_blocker():
    result = evaluate_plan_value(
        {
            "readbackDisprovesBlocker": True,
            "blockerClaim": "review claimed worktree evidence is absent",
            "readbackEvidence": "review readback line shows worktree evidence is present",
            "mergeRequested": True,
            "noMerge": False,
        }
    )
    assert result["classification"] == "escalation-needed"
    assert result["nextStateKind"] == "escalation-needed"


if __name__ == "__main__":
    for name, value in sorted(globals().items()):
        if name.startswith("test_"):
            value()
