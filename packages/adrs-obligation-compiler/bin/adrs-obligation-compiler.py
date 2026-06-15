#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import pathlib
import tempfile
from typing import Any, Iterable

DEFAULT_PACKAGE = "adrs-feat-build-destructive-readiness-gate"

ROOT_REL = {
    "raws": pathlib.Path("adrs-main/records/raw/adr.v1.jsonl"),
    "readiness_policy": pathlib.Path("adrs-main/records/control/feat-readiness-policy.v1.jsonl"),
    "readiness_usecases": pathlib.Path("adrs-main/records/control/feat-readiness-usecase.v1.jsonl"),
    "package_contracts": pathlib.Path("governance-records-main/records/specs/package-contract.v1.jsonl"),
    "projection_digests": pathlib.Path("governance-records-main/records/specs/projection-digest.v1.jsonl"),
    "dependency_edges": pathlib.Path("governance-records-main/records/specs/dependency-edge.v1.jsonl"),
    "feat_inputs": pathlib.Path("governance-records-main/generated/feat-inputs.v1.jsonl"),
    "destructives": pathlib.Path("adrs-main/records/promoted/destructive-case.v1.jsonl"),
    "coverage": pathlib.Path("governance-records-main/records/feat/destructive-coverage.v1.jsonl"),
    "build_evidence": pathlib.Path("governance-records-main/records/feat/build-evidence.v1.jsonl"),
    "readiness_decisions": pathlib.Path("governance-records-main/records/feat/readiness-decision.v1.jsonl"),
    "relations": pathlib.Path("adrs-main/records/relations/adr-promotion.v1.jsonl"),
}


def fail(message: str) -> None:
    raise SystemExit(f"adrs-obligation-compiler:error:{message}")


def canonical_bytes(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha_obj(obj: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(obj)).hexdigest()


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            fail(f"duplicate-json-key:{key}")
        out[key] = value
    return out


def _strict_text_bytes(path: pathlib.Path, *, jsonl: bool) -> str:
    if not path.exists():
        fail(f"missing-file:{path}")
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        fail(f"bom-forbidden:{path}")
    if b"\r" in data:
        fail(f"crlf-or-cr-forbidden:{path}")
    if b"\x00" in data:
        fail(f"nul-forbidden:{path}")
    if jsonl and data and not data.endswith(b"\n"):
        fail(f"jsonl-missing-final-newline:{path}")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        fail(f"invalid-utf8:{path}:{exc}")


def read_jsonl(path: pathlib.Path) -> list[dict[str, Any]]:
    text = _strict_text_bytes(path, jsonl=True)
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(text.split("\n"), 1):
        if line == "":
            if line_no == len(text.split("\n")):
                continue
            fail(f"blank-jsonl-line:{path}:{line_no}")
        if line.rstrip(" \t") != line:
            fail(f"trailing-whitespace:{path}:{line_no}")
        if not line.strip():
            fail(f"blank-jsonl-line:{path}:{line_no}")
        if line.lstrip().startswith("#"):
            fail(f"comment-jsonl-line:{path}:{line_no}")
        try:
            obj = json.loads(line, object_pairs_hook=reject_duplicate_keys)
        except SystemExit:
            raise
        except Exception as exc:
            fail(f"invalid-jsonl:{path}:{line_no}:{exc}")
        if not isinstance(obj, dict):
            fail(f"jsonl-row-not-object:{path}:{line_no}")
        rows.append(obj)
    return rows


def read_json(path: pathlib.Path) -> Any:
    text = _strict_text_bytes(path, jsonl=False)
    try:
        return json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"invalid-json:{path}:{exc}")


def write_json(path: pathlib.Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def id_of(row: dict[str, Any]) -> str:
    for key in ("recordId", "id", "adrId", "caseId", "usecaseId", "coverageId", "packageId", "projectionDigest", "relationId"):
        value = row.get(key)
        if value:
            return str(value)
    return hashlib.sha256(canonical_bytes(row)).hexdigest()


def digest_rows(rows: Iterable[dict[str, Any]]) -> str:
    ordered = sorted((copy.deepcopy(r) for r in rows), key=lambda r: (str(r.get("kind", "")), id_of(r), canonical_bytes(r)))
    return sha_obj(ordered)




def projection_payload(package: dict[str, Any], edges: list[dict[str, Any]]) -> dict[str, Any]:
    definition = package.get("definition") or {}
    return {
        "packageId": package.get("packageId"),
        "specId": package.get("specId"),
        "status": package.get("status"),
        "successorRepoId": definition.get("successorRepoId"),
        "repoSourceUri": definition.get("repoSourceUri"),
        "officialOutput": definition.get("officialOutput"),
        "requiredOutputs": definition.get("requiredOutputs") or [],
        "requiredChecks": definition.get("requiredChecks") or [],
        "requiredCheckPackages": definition.get("requiredCheckPackages") or [],
        "requiredCommands": definition.get("requiredCommands") or [],
        "allowedPaths": definition.get("allowedPaths") or [],
        "forbiddenPaths": definition.get("forbiddenPaths") or [],
        "runtimeRequirements": definition.get("runtimeRequirements"),
        "preflightRequiredTools": definition.get("preflightRequiredTools") or [],
        "dependencyLock": edges,
        "recordDigest": package.get("recordDigest"),
    }

def derive_feat_inputs(root: pathlib.Path, packages: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_edge: dict[str, list[dict[str, Any]]] = {}
    for edge in edges:
        by_edge.setdefault(str(edge.get("fromPackageId")), []).append(edge)
    rows: list[dict[str, Any]] = []
    for package in packages:
        definition = package.get("definition") or {}
        projection_digest = sha_obj(projection_payload(package, by_edge.get(str(package.get("packageId")), [])))
        rows.append({
            "kind": "feat.input.v1",
            "packageId": package.get("packageId"),
            "status": "ready" if package.get("status") == "accepted" else "planned-blocked",
            "projectionDigest": projection_digest.removeprefix("sha256:"),
            "rawAdrDirectAuthority": False,
            "sourceAuthority": "governance-records-main/records/specs/package-contract.v1.jsonl",
            "environmentBuildDefinition": {
                "officialOutput": definition.get("officialOutput"),
                "requiredOutputs": definition.get("requiredOutputs") or [],
                "requiredChecks": definition.get("requiredChecks") or [],
                "requiredCommands": definition.get("requiredCommands") or [],
                "runtimeRequirements": definition.get("runtimeRequirements"),
                "preflightRequiredTools": definition.get("preflightRequiredTools") or [],
            },
            "repoOperation": {
                "allowedPaths": definition.get("allowedPaths") or [],
                "forbiddenPaths": definition.get("forbiddenPaths") or [],
            },
        })
    return rows

def load_index(root: pathlib.Path) -> dict[str, list[dict[str, Any]]]:
    data: dict[str, list[dict[str, Any]]] = {}
    for name, rel in ROOT_REL.items():
        path = root / rel
        if name == "feat_inputs" and not path.exists():
            generated_dir = root / "governance-records-main/generated"
            if generated_dir.exists():
                fail(f"generated-dir-present-without-feat-inputs:{generated_dir}")
            packages = data.get("package_contracts") or read_jsonl(root / ROOT_REL["package_contracts"])
            edges = data.get("dependency_edges") or read_jsonl(root / ROOT_REL["dependency_edges"])
            data[name] = derive_feat_inputs(root, packages, edges)
        else:
            data[name] = read_jsonl(path)
    return data


def by_package(rows: list[dict[str, Any]], package_id: str) -> list[dict[str, Any]]:
    return [r for r in rows if r.get("packageId") == package_id or r.get("definition", {}).get("packageId") == package_id]


def single_by_package(rows: list[dict[str, Any]], package_id: str, label: str) -> dict[str, Any]:
    matches = by_package(rows, package_id)
    if not matches:
        fail(f"missing-{label}:{package_id}")
    if len(matches) > 1:
        fail(f"duplicate-{label}:{package_id}")
    return matches[0]


def cases_for_package(rows: list[dict[str, Any]], package_id: str) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        packages = row.get("featPackageIds") or []
        if package_id in packages or row.get("packageId") == package_id:
            out.append(row)
    return out


def related_relations(rows: list[dict[str, Any]], ids: set[str]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        from_id = str((row.get("from") or {}).get("id", ""))
        to_id = str((row.get("to") or {}).get("id", ""))
        if from_id in ids or to_id in ids:
            out.append(row)
    return out


def is_blocking_case(row: dict[str, Any]) -> bool:
    if row.get("blocking") is True:
        return True
    if row.get("severity") in {"fatal-if-promoted", "blocking", "fatal"}:
        return True
    if str(row.get("promotionImpact", "")).startswith("blocked"):
        return True
    return False


def compile_obligation(root: pathlib.Path, package_id: str) -> dict[str, Any]:
    data = load_index(root)
    feat = single_by_package(data["feat_inputs"], package_id, "feat-input")
    package = single_by_package(data["package_contracts"], package_id, "package-contract")
    projection = single_by_package(data["projection_digests"], package_id, "projection-digest")
    if feat.get("rawAdrDirectAuthority") is not False:
        fail(f"raw-adr-direct-authority:{package_id}")
    projection_digest = feat.get("projectionDigest")
    if not projection_digest:
        fail(f"missing-projectionDigest:{package_id}")
    if projection.get("projectionDigest") != projection_digest:
        fail(f"projectionDigest-mismatch:{package_id}")

    cases = cases_for_package(data["destructives"], package_id)
    blocking_cases = [c for c in cases if is_blocking_case(c)]
    coverage = [r for r in data["coverage"] if r.get("packageId") == package_id]
    coverage_by_case = {str(r.get("caseId")): r for r in coverage}
    build_evidence = by_package(data["build_evidence"], package_id)
    decisions = by_package(data["readiness_decisions"], package_id)

    missing_coverage: list[str] = []
    stale_coverage: list[str] = []
    not_pass: list[str] = []
    missing_oracle: list[str] = []
    for case in blocking_cases:
        case_id = str(case.get("caseId"))
        cov = coverage_by_case.get(case_id)
        # Conflict resolution: preferred final mode is oracle.requiredCheck on the destructive row.
        # The uploaded readiness proposal already uses destructive-coverage rows instead. During the transition,
        # a coverage row tied to the same projection digest, with pass status and evidenceRef, satisfies the same
        # obligation. feat-specific proposals should gradually move the oracle into the disruptive row itself.
        has_inline_oracle = bool(((case.get("oracle") or {}).get("requiredCheck")))
        has_coverage_oracle = bool(cov and cov.get("status") == "pass" and cov.get("projectionDigest") == projection_digest and cov.get("evidenceRef"))
        if not cov:
            missing_coverage.append(case_id)
        else:
            if cov.get("projectionDigest") != projection_digest:
                stale_coverage.append(case_id)
            if cov.get("status") != "pass":
                not_pass.append(case_id)
        if not (has_inline_oracle or has_coverage_oracle):
            missing_oracle.append(case_id)
    if missing_coverage:
        fail("missing-destructive-coverage:" + ",".join(missing_coverage[:20]))
    if stale_coverage:
        fail("stale-destructive-coverage:" + ",".join(stale_coverage[:20]))
    if not_pass:
        fail("destructive-case-not-pass:" + ",".join(not_pass[:20]))
    if missing_oracle:
        fail("missing-disruptive-oracle-or-coverage-evidence:" + ",".join(missing_oracle[:20]))
    if not build_evidence:
        fail(f"missing-build-evidence:{package_id}")

    adr_ids = {str(c.get("adrId")) for c in cases if c.get("adrId")}
    case_ids = {str(c.get("caseId")) for c in cases if c.get("caseId")}
    usecase_ids = {str(c.get("generatedFromUsecaseId")) for c in cases if c.get("generatedFromUsecaseId")}
    raw_rows = [r for r in data["raws"] if str(r.get("adrId") or r.get("id")) in adr_ids]
    usecase_rows = [r for r in data["readiness_usecases"] if str(r.get("usecaseId")) in usecase_ids or str(r.get("adrId")) in adr_ids]
    policy_rows = data["readiness_policy"]
    relation_rows = related_relations(data["relations"], adr_ids | case_ids | usecase_ids)

    feat_for_digest = copy.deepcopy(feat)
    feat_for_digest.pop("adrObligation", None)
    source_set = {
        "kind": "adrs.obligationSourceSet.v1",
        "logicalLedgerMapping": {
            "raws": str(ROOT_REL["raws"]),
            "adrs": [str(ROOT_REL["readiness_policy"]), str(ROOT_REL["readiness_usecases"]), str(ROOT_REL["package_contracts"])],
            "frozenBuild": [str(ROOT_REL["feat_inputs"]), str(ROOT_REL["projection_digests"]), str(ROOT_REL["build_evidence"])],
            "disruptives": [str(ROOT_REL["destructives"]), str(ROOT_REL["coverage"])],
            "relations": str(ROOT_REL["relations"]),
        },
        "rawsDigest": digest_rows(raw_rows),
        "adrsDigest": digest_rows(policy_rows + usecase_rows + [package]),
        "frozenBuildDigest": digest_rows([feat_for_digest, projection] + build_evidence + decisions),
        "disruptivesDigest": digest_rows(cases + coverage),
        "relationsDigest": digest_rows(relation_rows),
        "buildEvidenceDigest": digest_rows(build_evidence + decisions),
    }
    source_set["sourceSetDigest"] = sha_obj({k: v for k, v in source_set.items() if k != "sourceSetDigest"})

    obligation = {
        "kind": "feat.obligation.v1",
        "schemaVersion": "v1",
        "packageId": package_id,
        "specId": feat.get("specId") or package.get("specId"),
        "status": feat.get("status"),
        "projectionDigest": projection_digest,
        "rawAdrDirectAuthority": False,
        "authorityBoundary": {
            "raws": "evidence-only",
            "acceptedAdrs": "obligation input, not implementation proof",
            "frozenBuild": "environment obligation, not implementation proof",
            "disruptives": "negative oracle obligation; pass evidence required",
            "governanceNix": "projection adapter only",
            "proveFeat": "implementation verifier",
            "compaction": "read model only, never canonical ledger authority",
        },
        "sourceSet": source_set,
        "buildEnvironment": feat.get("environmentBuildDefinition") or {},
        "repoOperation": feat.get("repoOperation") or {},
        "blockingDisruptiveCases": [
            {
                "caseId": c.get("caseId"),
                "adrId": c.get("adrId"),
                "title": c.get("title"),
                "generatedFromUsecaseId": c.get("generatedFromUsecaseId"),
                "evidenceMode": "inline-oracle-or-coverage-row",
                "coverageId": (coverage_by_case.get(str(c.get("caseId"))) or {}).get("coverageId"),
            }
            for c in blocking_cases
        ],
        "requiredEvidence": {
            "implementedObligationDigest": "must equal obligationDigest",
            "caseEvidence": "one pass row per blocking disruptive case",
            "requiredCheckOutputs": "preferred final mode; coverage-row evidence accepted for this readiness transition",
        },
    }
    obligation["obligationDigest"] = sha_obj({k: v for k, v in obligation.items() if k != "obligationDigest"})
    return obligation


def verify_implementation(root: pathlib.Path, package_id: str, implemented_path: pathlib.Path) -> dict[str, Any]:
    obligation = compile_obligation(root, package_id)
    implemented = read_json(implemented_path)
    if implemented.get("packageId") != package_id:
        fail(f"implemented-package-mismatch:{implemented.get('packageId')}!={package_id}")
    if implemented.get("implementedObligationDigest") != obligation["obligationDigest"]:
        fail(f"stale-implemented-obligation-digest:expected={obligation['obligationDigest']}:actual={implemented.get('implementedObligationDigest')}")
    evidence_rows = implemented.get("caseEvidence") or []
    evidence_by_case = {str(r.get("caseId")): r for r in evidence_rows}
    missing: list[str] = []
    not_pass: list[str] = []
    for case in obligation["blockingDisruptiveCases"]:
        case_id = str(case.get("caseId"))
        ev = evidence_by_case.get(case_id)
        if not ev:
            missing.append(case_id)
            continue
        if ev.get("status") != "pass":
            not_pass.append(case_id)
        if not (ev.get("check") or ev.get("evidenceRef")):
            fail(f"case-evidence-lacks-check-or-evidenceRef:{case_id}")
    if missing:
        fail("missing-case-evidence:" + ",".join(missing[:20]))
    if not_pass:
        fail("case-evidence-not-pass:" + ",".join(not_pass[:20]))
    return {
        "ok": True,
        "packageId": package_id,
        "obligationDigest": obligation["obligationDigest"],
        "caseEvidenceRows": len(evidence_rows),
        "blockingDisruptiveCases": len(obligation["blockingDisruptiveCases"]),
    }


def self_test(root: pathlib.Path, package_id: str) -> dict[str, Any]:
    obligation = compile_obligation(root, package_id)
    case_evidence = [
        {"caseId": c["caseId"], "status": "pass", "evidenceRef": f"coverage:{c.get('coverageId') or c['caseId']}"}
        for c in obligation["blockingDisruptiveCases"]
    ]
    with tempfile.TemporaryDirectory() as td:
        base = pathlib.Path(td)
        good = base / "good.json"
        stale = base / "stale.json"
        missing = base / "missing.json"
        write_json(good, {"kind": "feat.implementedObligation.v1", "packageId": package_id, "implementedObligationDigest": obligation["obligationDigest"], "caseEvidence": case_evidence})
        write_json(stale, {"kind": "feat.implementedObligation.v1", "packageId": package_id, "implementedObligationDigest": "sha256:stale", "caseEvidence": case_evidence})
        write_json(missing, {"kind": "feat.implementedObligation.v1", "packageId": package_id, "implementedObligationDigest": obligation["obligationDigest"], "caseEvidence": case_evidence[:-1]})
        good_result = verify_implementation(root, package_id, good)
        failures: list[dict[str, str]] = []
        for label, path in [("stale-implemented-obligation-digest", stale), ("missing-case-evidence", missing)]:
            try:
                verify_implementation(root, package_id, path)
            except SystemExit as exc:
                msg = str(exc)
                if "adrs-obligation-compiler:error:" not in msg:
                    fail(f"negative-fixture-wrong-error:{label}:{msg}")
                failures.append({"fixture": label, "status": "expected-fail", "message": msg})
            else:
                fail(f"negative-fixture-unexpected-pass:{label}")
    return {
        "ok": True,
        "packageId": package_id,
        "obligationDigest": obligation["obligationDigest"],
        "blockingDisruptiveCases": len(obligation["blockingDisruptiveCases"]),
        "goodVerify": good_result,
        "negativeFixtures": failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile and verify adrs -> feat obligation digests.")
    parser.add_argument("command", choices=["compile", "verify", "self-test"])
    parser.add_argument("--root", default=".")
    parser.add_argument("--package", default=DEFAULT_PACKAGE)
    parser.add_argument("--implemented", default=None)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    root = pathlib.Path(args.root).resolve()
    if args.command == "compile":
        result = compile_obligation(root, args.package)
    elif args.command == "verify":
        if not args.implemented:
            fail("missing---implemented")
        result = verify_implementation(root, args.package, pathlib.Path(args.implemented))
    else:
        result = self_test(root, args.package)

    if args.out:
        write_json(pathlib.Path(args.out), result)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
