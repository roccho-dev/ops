from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ADR_ID = "adr-20260604-adr-specs-promotion-kernel"
PACKAGE_ID = "adr-specs-promotion-kernel"
SPEC_ID = "spec.packages.adr-specs-promotion-kernel.v1"
OPS_PACKAGE = "ops-adr-specs-promotion"
ACCEPTED_AUTHORITY = "governance-records-main/records/specs/package-contract.v1.jsonl"
FEAT_INPUT_PATH = "governance-records-main/generated/feat-inputs/adr-specs-promotion-kernel.json"
LEGACY_IMPLEMENT_VIEW = "/".join(("spec", "implements.json"))
PASS_CLASSIFICATION = "adr-specs-promotion-kernel-pass"
FAIL_CLASSIFICATION = "adr-specs-promotion-kernel-fail"
ISSUE_LIFECYCLE_FIELDS_FORBIDDEN_IN_ADR = {
    "issueId",
    "recordId",
    "recordType",
    "owner",
    "blocker",
    "handoff",
    "closure",
    "closeCriteria",
    "requiredEvidence",
    "supersedes",
    "allowedPaths",
    "forbiddenActions",
}


def diagnostic(path: Path | str, code: str, message: str, line: int | None = None) -> dict[str, Any]:
    return {"path": str(path), "line": line, "code": code, "message": message}


def read_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    if not path.exists():
        return rows, [diagnostic(path, "missing-file", "required JSONL file is missing")]
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            diagnostics.append(diagnostic(path, "invalid-json", str(exc), line_no))
            continue
        if not isinstance(value, dict):
            diagnostics.append(diagnostic(path, "non-object-jsonl-row", "JSONL row must be an object", line_no))
            continue
        rows.append(value | {"_path": str(path), "_line": line_no})
    return rows, diagnostics


def read_json(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not path.exists():
        return {}, [diagnostic(path, "missing-file", "required JSON file is missing")]
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {}, [diagnostic(path, "invalid-json", str(exc))]
    if not isinstance(value, dict):
        return {}, [diagnostic(path, "non-object-json", "JSON file must contain an object")]
    return value, []


def find_by(records: list[dict[str, Any]], key: str, value: str) -> list[dict[str, Any]]:
    return [record for record in records if record.get(key) == value]


def has_token(values: Any, token: str) -> bool:
    if isinstance(values, list):
        return token in values
    return False


def contains_legacy_implements_path(values: Any) -> bool:
    if isinstance(values, str):
        return LEGACY_IMPLEMENT_VIEW in values
    if isinstance(values, list):
        return any(contains_legacy_implements_path(value) for value in values)
    if isinstance(values, dict):
        return any(contains_legacy_implements_path(value) for value in values.values())
    return False


def check_adr(records: list[dict[str, Any]], path: Path) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    matches = find_by(records, "id", ADR_ID) + find_by(records, "adrId", ADR_ID)
    if not matches:
        return [diagnostic(path, "missing-adr", f"ADR {ADR_ID} is required")]
    for record in matches:
        if record.get("kind") != "adr.raw.v1":
            diagnostics.append(diagnostic(path, "invalid-adr-kind", "promotion source ADR must be kind adr.raw.v1", record.get("_line")))
        forbidden = sorted(ISSUE_LIFECYCLE_FIELDS_FORBIDDEN_IN_ADR & set(record))
        if forbidden:
            diagnostics.append(diagnostic(path, "adr-contains-issue-lifecycle-field", f"ADR raw record contains issue lifecycle fields: {forbidden}", record.get("_line")))
    return diagnostics


def check_package_contract(records: list[dict[str, Any]], path: Path) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    matches = find_by(records, "packageId", PACKAGE_ID)
    if not matches:
        return [diagnostic(path, "missing-package-contract", f"accepted package contract {PACKAGE_ID} is required")]
    for record in matches:
        line = record.get("_line")
        definition = record.get("definition")
        if record.get("kind") != "governance.packageContract.v1":
            diagnostics.append(diagnostic(path, "invalid-package-contract-kind", "package contract must be governance.packageContract.v1", line))
        if record.get("lifecycle") != "accepted" or record.get("status") != "accepted":
            diagnostics.append(diagnostic(path, "package-contract-not-accepted", "package contract must be accepted", line))
        if not isinstance(definition, dict):
            diagnostics.append(diagnostic(path, "missing-package-contract-definition", "package contract must contain a definition object", line))
            continue
        if definition.get("specId") != SPEC_ID:
            diagnostics.append(diagnostic(path, "wrong-contract-spec-id", f"package contract definition must use {SPEC_ID}", line))
        if definition.get("repoId") != "ops" or definition.get("repoCategory") != "feat":
            diagnostics.append(diagnostic(path, "wrong-contract-repo-placement", "package contract must place the implementation in ops feat work", line))
        if definition.get("implementationPackageName") != OPS_PACKAGE:
            diagnostics.append(diagnostic(path, "wrong-contract-implementation-package", f"package contract must name {OPS_PACKAGE}", line))
        if not has_token(definition.get("requiredOutputs"), f"packages.<system>.{OPS_PACKAGE}"):
            diagnostics.append(diagnostic(path, "missing-contract-output-binding", f"package contract must require packages.<system>.{OPS_PACKAGE}", line))
        if not has_token(definition.get("requiredChecks"), f"checks.<system>.{OPS_PACKAGE}"):
            diagnostics.append(diagnostic(path, "missing-contract-check-binding", f"package contract must require checks.<system>.{OPS_PACKAGE}", line))

        authority = definition.get("authority", {})
        if not isinstance(authority, dict) or authority.get("acceptedDefinition") != ACCEPTED_AUTHORITY:
            diagnostics.append(diagnostic(path, "wrong-accepted-authority", f"accepted definition must be {ACCEPTED_AUTHORITY}", line))
        if isinstance(authority, dict):
            raw_role = str(authority.get("rawAdrRole", ""))
            issue_role = str(authority.get("issueRole", ""))
            if "never direct repo operation authority" not in raw_role:
                diagnostics.append(diagnostic(path, "raw-adr-authority-collapse", "raw ADR role must not be repo operation authority", line))
            if "never accepted definition authority" not in issue_role:
                diagnostics.append(diagnostic(path, "issue-authority-collapse", "issue lifecycle must not be accepted definition authority", line))

        placement = definition.get("placementContract", {})
        binding = placement.get("mustMatchGovernanceRecordsContract") if isinstance(placement, dict) else None
        if not isinstance(binding, dict):
            diagnostics.append(diagnostic(path, "missing-governance-records-binding", "placement must bind through governance-records package contract and feat input", line))
            continue
        expected = {
            "acceptedDefinition": ACCEPTED_AUTHORITY,
            "featInput": FEAT_INPUT_PATH,
            "owningRepo": "ops",
            "package": OPS_PACKAGE,
        }
        for key, value in expected.items():
            if binding.get(key) != value:
                diagnostics.append(diagnostic(path, "wrong-governance-records-binding", f"binding {key} must be {value}", line))
        if contains_legacy_implements_path(definition):
            diagnostics.append(diagnostic(path, "legacy-implements-reference", "package contract definition must not require generated implements.json", line))
    return diagnostics


def check_feat_input(data: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    if data.get("kind") != "feat.input.v1":
        diagnostics.append(diagnostic(path, "invalid-feat-input-kind", "feat input must be feat.input.v1"))
    if data.get("packageId") != PACKAGE_ID:
        diagnostics.append(diagnostic(path, "wrong-feat-input-package", f"feat input packageId must be {PACKAGE_ID}"))
    if data.get("sourceAuthority") != ACCEPTED_AUTHORITY:
        diagnostics.append(diagnostic(path, "wrong-feat-input-authority", f"feat input sourceAuthority must be {ACCEPTED_AUTHORITY}"))
    if data.get("rawAdrDirectAuthority") is not False:
        diagnostics.append(diagnostic(path, "raw-adr-direct-authority", "feat input must explicitly reject raw ADR direct authority"))

    repo_operation = data.get("repoOperation", {})
    if not isinstance(repo_operation, dict):
        diagnostics.append(diagnostic(path, "missing-repo-operation", "feat input must include repoOperation"))
    else:
        if repo_operation.get("targetRepoId") != "ops":
            diagnostics.append(diagnostic(path, "wrong-feat-target-repo", "feat input must target ops"))
        allowed_paths = repo_operation.get("allowedPaths", [])
        if f"../ops-main/packages/{OPS_PACKAGE}/" not in allowed_paths:
            diagnostics.append(diagnostic(path, "missing-feat-implementation-path", f"feat input must allow ../ops-main/packages/{OPS_PACKAGE}/"))
        if contains_legacy_implements_path(allowed_paths):
            diagnostics.append(diagnostic(path, "legacy-implements-reference", "feat input must not require generated implements.json"))

    build = data.get("environmentBuildDefinition", {})
    if not isinstance(build, dict):
        diagnostics.append(diagnostic(path, "missing-build-definition", "feat input must include environmentBuildDefinition"))
    else:
        if build.get("repoId") != "ops":
            diagnostics.append(diagnostic(path, "wrong-build-repo", "build definition must target ops"))
        if not has_token(build.get("requiredOutputs"), f"packages.<system>.{OPS_PACKAGE}"):
            diagnostics.append(diagnostic(path, "missing-feat-output-binding", f"feat input must require packages.<system>.{OPS_PACKAGE}"))
        if not has_token(build.get("requiredChecks"), f"checks.<system>.{OPS_PACKAGE}"):
            diagnostics.append(diagnostic(path, "missing-feat-check-binding", f"feat input must require checks.<system>.{OPS_PACKAGE}"))
    return diagnostics


def audit_workspace(workspace: Path | str) -> dict[str, Any]:
    root = Path(workspace)
    paths = {
        "adr": root / "adrs-main/records/raw/adr.v1.jsonl",
        "packageContract": root / ACCEPTED_AUTHORITY,
        "featInput": root / FEAT_INPUT_PATH,
    }
    diagnostics: list[dict[str, Any]] = []
    adr_rows, diags = read_jsonl(paths["adr"]); diagnostics.extend(diags)
    contract_rows, diags = read_jsonl(paths["packageContract"]); diagnostics.extend(diags)
    feat_input, diags = read_json(paths["featInput"]); diagnostics.extend(diags)
    if not diagnostics:
        diagnostics.extend(check_adr(adr_rows, paths["adr"]))
        diagnostics.extend(check_package_contract(contract_rows, paths["packageContract"]))
        diagnostics.extend(check_feat_input(feat_input, paths["featInput"]))
    ok = not diagnostics
    return {
        "ok": ok,
        "classification": PASS_CLASSIFICATION if ok else FAIL_CLASSIFICATION,
        "semanticsProfile": "adr-specs-promotion-kernel-v1",
        "workspace": str(root),
        "contractId": SPEC_ID,
        "packageId": PACKAGE_ID,
        "implementationPackage": OPS_PACKAGE,
        "diagnosticCount": len(diagnostics),
        "diagnostics": diagnostics,
        "nixCompressionClaimed": False,
        "acceptedAuthority": ACCEPTED_AUTHORITY,
        "featInput": FEAT_INPUT_PATH,
        "featPlacement": {"repoId": "ops", "package": OPS_PACKAGE},
    }
