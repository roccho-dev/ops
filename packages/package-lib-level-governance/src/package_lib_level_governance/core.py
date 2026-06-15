from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from typing import Any, Iterable

GOVERNANCE_ROLES = {"contract", "check", "aggregate", "evidence", "wrapper"}
TARGET_OK = {
    "MEETS_TARGET_LIB_LEVEL",
    "ADAPTER_OK_AS_EXTENSION",
    "PLANNED_GOOD_CONTRACT",
    "GOVERNANCE_PACKAGE_OK_OR_NOT_TARGET",
}
DEBT_CLASSIFICATIONS = {
    "PARTIAL_LIB_LEVEL",
    "ADAPTER_NEEDS_EXAMPLE_USECASE",
    "NO_EXPLICIT_LIB_LEVEL_CONTRACT",
    "LEGACY_NO_EXPLICIT_LIB_LEVEL",
    "PLANNED_NEEDS_EVIDENCE",
}
ORDER = {
    "LEGACY_NO_EXPLICIT_LIB_LEVEL": 0,
    "NO_EXPLICIT_LIB_LEVEL_CONTRACT": 1,
    "PLANNED_NEEDS_EVIDENCE": 1,
    "ADAPTER_NEEDS_EXAMPLE_USECASE": 2,
    "PARTIAL_LIB_LEVEL": 3,
    "PLANNED_GOOD_CONTRACT": 4,
    "ADAPTER_OK_AS_EXTENSION": 5,
    "GOVERNANCE_PACKAGE_OK_OR_NOT_TARGET": 5,
    "MEETS_TARGET_LIB_LEVEL": 6,
}

CORE_TERMS = {
    "core",
    "domain",
    "kernel",
    "pure",
    "library",
    "lib",
    "model",
    "rule",
    "invariant",
}
PORT_TERMS = {
    "port",
    "interface",
    "contract",
    "api",
    "boundary",
    "schema",
    "publicinterface",
}
ADAPTER_TERMS = {
    "adapter",
    "cli",
    "browser",
    "http",
    "server",
    "runtime",
    "surface",
    "viewer",
    "mcp",
    "gateway",
    "transport",
    "provider",
    "integration",
}
EXAMPLE_TERMS = {
    "example",
    "examples",
    "usecase",
    "usecases",
    "e2e",
    "fixture",
    "fixtures",
    "poc",
    "demo",
    "destructive",
    "scenario",
    "casebook",
    "regression",
    "oracle",
}
GOVERNANCE_TERMS = {
    "governance",
    "policy",
    "gate",
    "guard",
    "check",
    "ledger",
    "specsless",
    "records",
    "projection",
    "proof",
    "evidence",
    "adr",
}
AUTHORITY_LEAK_TERMS = {
    "generated artifact as authority",
    "example as authority",
    "canonical state",
    "second truth",
    "domain authority",
    "business rule",
}


def _strings(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, bool) or isinstance(value, int) or isinstance(value, float):
        return [str(value)]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_strings(item))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for key, item in value.items():
            out.append(str(key))
            out.extend(_strings(item))
        return out
    return [str(value)]


def _compact_text(*values: Any) -> str:
    return "\n".join(_strings(list(values))).lower().replace("_", "-")


def _has_any(text: str, terms: set[str]) -> bool:
    normalized = text.replace("_", "-").lower()
    for term in terms:
        t = term.lower().replace("_", "-")
        if t in normalized:
            return True
    return False


def _has_token(text: str, token: str) -> bool:
    return token.lower().replace("_", "-") in text.replace("_", "-").lower()


@dataclass(frozen=True)
class Classification:
    packageId: str
    status: str
    expectedLevel: str
    classification: str
    disposition: str
    severity: str
    coreEvidence: bool
    portEvidence: bool
    adapterEvidence: bool
    exampleUsecaseE2eEvidence: bool
    governanceGateEvidence: bool
    adapterAuthorityRisk: bool
    reason: str
    requiredNext: str

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["kind"] = "governance.packageLibLevelBaseline.v1"
        row["policyId"] = "package-lib-level-governance.v1"
        return row


def classify_package(record: dict[str, Any]) -> Classification:
    package_id = record.get("packageId") or record.get("definition", {}).get("packageId") or record.get("definition", {}).get("package") or "<unknown>"
    definition = record.get("definition", {}) if isinstance(record.get("definition"), dict) else {}
    status = record.get("status") or definition.get("status") or record.get("lifecycle") or "unknown"
    role = definition.get("packageRole") or "implementation"
    repo_category = str(definition.get("repoCategory") or "")
    artifact_kind = str(definition.get("artifactKind") or "")
    evidence_value = {
        "packageId": package_id,
        "responsibility": definition.get("responsibility"),
        "mission": definition.get("mission"),
        "provides": definition.get("provides"),
        "requires": definition.get("requires"),
        "publicInterface": definition.get("publicInterface"),
        "packageContents": definition.get("packageContents"),
        "allowedPaths": definition.get("allowedPaths"),
        "forbiddenPaths": definition.get("forbiddenPaths"),
        "architecturePolicy": definition.get("architecturePolicy"),
        "adapterBoundary": definition.get("adapterBoundary"),
        "adapterPlacementPolicy": definition.get("adapterPlacementPolicy"),
        "libLevelPolicy": definition.get("libLevelPolicy"),
        "sourceLayout": definition.get("sourceLayout"),
        "activationCriteria": definition.get("activationCriteria"),
        "blockedWhen": definition.get("blockedWhen"),
        "requiredChecks": definition.get("requiredChecks"),
        "requiredCommands": definition.get("requiredCommands"),
        "dependencyUse": definition.get("dependencyUse"),
    }
    evidence_value = {key: value for key, value in evidence_value.items() if value not in (None, [], {})}
    package_text = _compact_text(evidence_value)
    name_text = package_id.lower().replace("_", "-")

    core = _has_any(package_text, CORE_TERMS) or _has_token(name_text, "core") or _has_token(name_text, "lib")
    port = _has_any(package_text, PORT_TERMS) or _has_token(name_text, "port") or bool(definition.get("publicInterface"))
    adapter = _has_any(package_text, ADAPTER_TERMS)
    example = _has_any(package_text, EXAMPLE_TERMS)
    governance_name = _has_any(name_text, GOVERNANCE_TERMS)
    governance = role in GOVERNANCE_ROLES or governance_name or repo_category in {"spec", "spec-package-contract", "ops-check"}
    gate = _has_token(package_text, "port-adapter-library-governance") or _has_token(package_text, "functional-core-governance-gate") or _has_token(package_text, "core-boundary-lint") or _has_token(package_text, "package-lib-level-governance")
    adapter_authority_risk = adapter and any(term in package_text for term in AUTHORITY_LEAK_TERMS)

    if status == "deprecated" or role == "deprecated-implementation":
        expected = "deprecated-decision-needed"
        classification = "GOVERNANCE_PACKAGE_OK_OR_NOT_TARGET"
        disposition = "deprecated-not-active-product-lib"
        severity = "info"
        reason = "qjs-dependent or otherwise deprecated implementation; retained only for migration/delete decision tracking."
        required_next = "Record Node.js migration or deletion decision before reactivation; do not treat deprecated implementation as final green."
    elif governance and not (adapter and "adapter" in name_text and role == "implementation"):
        expected = "governance-or-check"
        classification = "GOVERNANCE_PACKAGE_OK_OR_NOT_TARGET"
        disposition = "target-or-not-product-lib"
        severity = "info"
        reason = "governance/check/contract package; product lib-level is not the primary target."
        required_next = "Keep governance package-backed and do not let examples/generated output become authority."
    elif adapter:
        expected = "adapter-extension"
        if example and not adapter_authority_risk:
            classification = "ADAPTER_OK_AS_EXTENSION"
            disposition = "target"
            severity = "info"
            reason = "adapter evidence is present and example/usecase/e2e/destructive evidence exists."
            required_next = "Keep adapter non-authoritative; bind examples/usecases/e2e to the port contract."
        else:
            classification = "ADAPTER_NEEDS_EXAMPLE_USECASE"
            disposition = "accepted-baseline-debt"
            severity = "warning"
            reason = "adapter-like package lacks explicit example/usecase/e2e evidence or has possible authority leakage."
            required_next = "Add examples/usecases/e2e/destructive fixtures and state adapter as extension/glue only."
    elif core or port:
        expected = "core-port-lib"
        if core and port:
            classification = "MEETS_TARGET_LIB_LEVEL"
            disposition = "target"
            severity = "info"
            reason = "core and port/lib/public-interface evidence are both present."
            required_next = "Preserve dependency direction: core/port must not depend on runtime adapter."
        else:
            classification = "PARTIAL_LIB_LEVEL"
            disposition = "accepted-baseline-debt"
            severity = "warning"
            missing = "port" if core and not port else "core"
            reason = f"lib-like package has partial evidence; missing explicit {missing} side."
            required_next = "Declare core + port + public contract and contract tests in the package contract."
    elif status == "planned":
        expected = "planned-unknown"
        # planned packages can be useful contracts, but must say what future boundary they will own.
        if bool(definition.get("publicInterface")) or bool(definition.get("activationCriteria")):
            classification = "PLANNED_GOOD_CONTRACT"
            disposition = "target"
            severity = "info"
            reason = "planned package has public interface or activation criteria."
            required_next = "Keep planned package blocked until boundary evidence exists."
        else:
            classification = "PLANNED_NEEDS_EVIDENCE"
            disposition = "accepted-baseline-debt"
            severity = "warning"
            reason = "planned package lacks explicit lib/adapter/governance level evidence."
            required_next = "Add activation criteria and expected lib/core-port or adapter-extension level."
    else:
        expected = "unspecified"
        classification = "NO_EXPLICIT_LIB_LEVEL_CONTRACT"
        disposition = "accepted-baseline-debt"
        severity = "warning"
        reason = "package contract does not expose enough core/port/adapter/governance level evidence."
        required_next = "Declare expected lib level and either core+port authority or adapter example/usecase placement."

    return Classification(
        packageId=str(package_id),
        status=str(status),
        expectedLevel=expected,
        classification=classification,
        disposition=disposition,
        severity=severity,
        coreEvidence=bool(core),
        portEvidence=bool(port),
        adapterEvidence=bool(adapter),
        exampleUsecaseE2eEvidence=bool(example),
        governanceGateEvidence=bool(gate),
        adapterAuthorityRisk=bool(adapter_authority_risk),
        reason=reason,
        requiredNext=required_next,
    )


def classify_records(records: Iterable[dict[str, Any]]) -> list[Classification]:
    return [classify_package(record) for record in records]


def read_jsonl_text(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception as exc:  # pragma: no cover - adapter normally formats path context
            raise ValueError(f"JSONL parse failed at line {line_no}: {exc}") from exc
        if isinstance(row, dict):
            rows.append(row)
        else:
            raise ValueError(f"JSONL row {line_no} is not an object")
    return rows


def summarize(classifications: Iterable[Classification]) -> dict[str, Any]:
    rows = list(classifications)
    by_class: dict[str, int] = {}
    by_expected: dict[str, int] = {}
    for row in rows:
        by_class[row.classification] = by_class.get(row.classification, 0) + 1
        by_expected[row.expectedLevel] = by_expected.get(row.expectedLevel, 0) + 1
    debt = [r for r in rows if r.classification in DEBT_CLASSIFICATIONS]
    target = [r for r in rows if r.classification in TARGET_OK]
    return {
        "kind": "packageLibLevelGovernance.summary.v1",
        "policyId": "package-lib-level-governance.v1",
        "packageCount": len(rows),
        "targetOrNotProductLibCount": len(target),
        "baselineDebtCount": len(debt),
        "byClassification": dict(sorted(by_class.items())),
        "byExpectedLevel": dict(sorted(by_expected.items())),
    }


def compare_with_baseline(current: list[Classification], baseline_rows: list[dict[str, Any]], *, mode: str) -> dict[str, Any]:
    current_by_pkg = {row.packageId: row for row in current}
    baseline_by_pkg = {str(row.get("packageId")): row for row in baseline_rows if row.get("packageId")}
    missing_baseline = sorted(set(current_by_pkg) - set(baseline_by_pkg))
    stale_baseline = sorted(set(baseline_by_pkg) - set(current_by_pkg))
    regressions: list[dict[str, Any]] = []
    for package_id in sorted(set(current_by_pkg) & set(baseline_by_pkg)):
        cur = current_by_pkg[package_id]
        base_class = str(baseline_by_pkg[package_id].get("classification"))
        if ORDER.get(cur.classification, -1) < ORDER.get(base_class, -1):
            regressions.append({
                "packageId": package_id,
                "baseline": base_class,
                "current": cur.classification,
                "reason": "current classification is below baseline classification",
            })
    final_debt = [row.to_row() for row in current if row.classification in DEBT_CLASSIFICATIONS]
    errors: list[dict[str, Any]] = []
    if missing_baseline:
        errors.append({"kind": "missing-baseline", "packageIds": missing_baseline})
    if stale_baseline:
        errors.append({"kind": "stale-baseline", "packageIds": stale_baseline})
    if regressions:
        errors.append({"kind": "classification-regression", "regressions": regressions})
    if mode == "final" and final_debt:
        errors.append({"kind": "baseline-debt-present-in-final", "count": len(final_debt), "packageIds": [r["packageId"] for r in final_debt[:30]]})
    return {
        "kind": "packageLibLevelGovernance.baselineComparison.v1",
        "mode": mode,
        "ok": not errors,
        "errors": errors,
        "missingBaseline": missing_baseline,
        "staleBaseline": stale_baseline,
        "regressions": regressions,
        "finalDebtCount": len(final_debt),
    }
