from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from ops_adr_specs_promotion.core import audit_workspace

THIS = Path(__file__).resolve().parent
STATIC_FIXTURE = THIS / "fixtures" / "workspace"


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")


def create_fixture() -> Path:
    workspace = Path(tempfile.mkdtemp(prefix="ops-adr-specs-promotion-fixture-")) / "workspace"
    write_json(
        workspace / "adrs-main/records/raw/adr.v1.jsonl",
        {
            "id": "adr-20260604-adr-specs-promotion-kernel",
            "kind": "adr.raw.v1",
            "authorityBoundary": "ADR is rationale input only. Accepted package contract authority lives in governance-records-main.",
        },
    )
    write_json(
        workspace / "governance-records-main/records/specs/package-contract.v1.jsonl",
        {
            "kind": "governance.packageContract.v1",
            "lifecycle": "accepted",
            "packageId": "adr-specs-promotion-kernel",
            "status": "accepted",
            "definition": {
                "authority": {
                    "acceptedDefinition": "governance-records-main/records/specs/package-contract.v1.jsonl",
                    "issueRole": "lifecycle-only; never accepted definition authority",
                    "rawAdrRole": "rationale-only; never direct repo operation authority",
                },
                "implementationPackageName": "ops-adr-specs-promotion",
                "placementContract": {
                    "mustMatchGovernanceRecordsContract": {
                        "acceptedDefinition": "governance-records-main/records/specs/package-contract.v1.jsonl",
                        "featInput": "governance-records-main/generated/feat-inputs/adr-specs-promotion-kernel.json",
                        "owningRepo": "ops",
                        "package": "ops-adr-specs-promotion",
                    },
                },
                "repoCategory": "feat",
                "repoId": "ops",
                "requiredChecks": ["checks.<system>.ops-adr-specs-promotion"],
                "requiredOutputs": ["packages.<system>.ops-adr-specs-promotion"],
                "specId": "spec.packages.adr-specs-promotion-kernel.v1",
            },
        },
    )
    write_json(
        workspace / "governance-records-main/generated/feat-inputs/adr-specs-promotion-kernel.json",
        {
            "kind": "feat.input.v1",
            "packageId": "adr-specs-promotion-kernel",
            "rawAdrDirectAuthority": False,
            "sourceAuthority": "governance-records-main/records/specs/package-contract.v1.jsonl",
            "environmentBuildDefinition": {
                "repoId": "ops",
                "requiredChecks": ["checks.<system>.ops-adr-specs-promotion"],
                "requiredOutputs": ["packages.<system>.ops-adr-specs-promotion"],
            },
            "repoOperation": {
                "allowedPaths": ["../ops-main/packages/ops-adr-specs-promotion/"],
                "targetRepoId": "ops",
            },
        },
    )
    return workspace


FIXTURE = STATIC_FIXTURE if STATIC_FIXTURE.exists() else create_fixture()


def copy_fixture() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="ops-adr-specs-promotion-"))
    shutil.copytree(FIXTURE, tmp / "workspace")
    return tmp / "workspace"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


def test_positive_fixture_passes() -> None:
    report = audit_workspace(FIXTURE)
    assert report["ok"], report
    assert report["classification"] == "adr-specs-promotion-kernel-pass"


def test_adr_cannot_carry_issue_lifecycle_fields() -> None:
    workspace = copy_fixture()
    path = workspace / "adrs-main/records/raw/adr.v1.jsonl"
    rows = read_jsonl(path)
    rows[0]["issueId"] = "bad-shadow-issue"
    write_jsonl(path, rows)
    report = audit_workspace(workspace)
    assert not report["ok"]
    assert any(d["code"] == "adr-contains-issue-lifecycle-field" for d in report["diagnostics"])


def test_package_contract_governance_records_binding_is_required() -> None:
    workspace = copy_fixture()
    path = workspace / "governance-records-main/records/specs/package-contract.v1.jsonl"
    rows = read_jsonl(path)
    rows[0]["definition"]["placementContract"].pop("mustMatchGovernanceRecordsContract")
    write_jsonl(path, rows)
    report = audit_workspace(workspace)
    assert not report["ok"]
    assert any(d["code"] == "missing-governance-records-binding" for d in report["diagnostics"])


def test_feat_input_ops_implementation_binding_is_required() -> None:
    workspace = copy_fixture()
    path = workspace / "governance-records-main/generated/feat-inputs/adr-specs-promotion-kernel.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["environmentBuildDefinition"]["requiredOutputs"] = []
    path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
    report = audit_workspace(workspace)
    assert not report["ok"]
    assert any(d["code"] == "missing-feat-output-binding" for d in report["diagnostics"])


def test_feat_input_must_not_require_generated_implements_json() -> None:
    workspace = copy_fixture()
    path = workspace / "governance-records-main/generated/feat-inputs/adr-specs-promotion-kernel.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["repoOperation"]["allowedPaths"].append("../ops-main/" + "/".join(("spec", "implements.json")))
    path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
    report = audit_workspace(workspace)
    assert not report["ok"]
    assert any(d["code"] == "legacy-implements-reference" for d in report["diagnostics"])


if __name__ == "__main__":
    test_positive_fixture_passes()
    test_adr_cannot_carry_issue_lifecycle_fields()
    test_package_contract_governance_records_binding_is_required()
    test_feat_input_ops_implementation_binding_is_required()
    test_feat_input_must_not_require_generated_implements_json()
    print("ops-adr-specs-promotion-tests-pass")
