#!/usr/bin/env python3
"""Generate and validate ops handoff directories.

The tool is intentionally local-only. It does not call CDP, upload Project
Source files, fetch artifacts, merge, push, or approve work.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


THREAD_FUNCTIONS = ("impl-work", "impl-review", "merge-work", "merge-review")

WORK_ROLE_BY_FUNCTION = {
    "impl-work": "role.implWorker",
    "impl-review": "role.implReviewer",
    "merge-work": "role.mergeExecutor",
    "merge-review": "role.mergeReviewer",
}

FORBIDDEN_BY_FUNCTION = {
    "impl-work": [
        "do not self-review implementation work",
        "do not issue impl-review-pass or merge-review-pass",
        "do not perform merge-work, merge-review, canonical merge, push, or cleanup",
        "do not treat transport/readback as approval",
    ],
    "impl-review": [
        "do not edit or create the implementation candidate being reviewed",
        "do not perform merge-work, merge-review, canonical merge, push, or cleanup",
        "do not approve generic review-pass prose; require explicit impl-review-pass or reject/blocker",
        "do not treat transport/readback as approval",
    ],
    "merge-work": [
        "do not issue merge-review-pass",
        "do not perform canonical merge, push, or cleanup",
        "do not change the reviewed implementation outside the merge target scope",
        "do not treat transport/readback as approval",
    ],
    "merge-review": [
        "do not create or edit the merge candidate being reviewed",
        "do not localize, push, cleanup, or close the workflow",
        "do not accept generic review-pass prose; require explicit merge-review-pass or reject/blocker",
        "do not treat transport/readback as approval",
    ],
}

EXPECTED_BY_FUNCTION = {
    "impl-work": [
        "implementation artifact or patch",
        "diff summary",
        "gate log",
        "RUN_REPORT.md",
        "residual risks",
        "completion claim candidate",
    ],
    "impl-review": [
        "first non-empty line verdict: impl-review-pass, impl-review-reject, or blocker",
        "review report",
        "evidence table",
        "residual risks",
    ],
    "merge-work": [
        "merge candidate or merge handoff bundle",
        "base/candidate/merge target refs",
        "gate log",
        "RUN_REPORT.md",
        "residual risks",
    ],
    "merge-review": [
        "first non-empty line verdict: merge-review-pass, merge-review-reject, or blocker",
        "merge review report",
        "rollback or stop conditions",
        "evidence table",
    ],
}


class HandoffError(Exception):
    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HandoffError("invalid-json", f"{label} is not valid JSON: {path}: {exc}") from exc


def require_file(path_text: str | None, label: str) -> Path:
    if not path_text:
        raise HandoffError("missing-required-input", f"missing required input: {label}")
    path = Path(path_text)
    if not path.is_file():
        raise HandoffError("missing-required-input", f"required input does not exist: {label}: {path}")
    return path


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def copy_file(src: Path, dst: Path) -> dict[str, Any]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return {
        "sourcePath": str(src),
        "relativePath": str(dst),
        "sha256": sha256_file(src),
        "bytes": src.stat().st_size,
    }


def extract_role_ids(role_catalog: Path) -> list[str]:
    text = role_catalog.read_text(encoding="utf-8", errors="replace")
    return sorted(set(re.findall(r"`(role\.[A-Za-z0-9_.-]+|actor\.chatgpt\.project(?:\.[A-Za-z0-9_\[\].-]+)?)`", text)))


def normalize_roster(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and isinstance(value.get("threads"), list):
        threads = value["threads"]
    elif isinstance(value, list):
        threads = value
    else:
        raise HandoffError("invalid-thread-roster", "thread roster must be an array or object with threads[]")

    by_function: dict[str, dict[str, Any]] = {}
    for row in threads:
        if not isinstance(row, dict):
            raise HandoffError("invalid-thread-roster", "thread roster entries must be objects")
        fn = str(row.get("threadFunction", ""))
        if fn not in THREAD_FUNCTIONS:
            raise HandoffError("invalid-thread-roster", f"invalid threadFunction: {fn}")
        if fn in by_function:
            raise HandoffError("invalid-thread-roster", f"duplicate threadFunction: {fn}")
        actor_id = row.get("actorId")
        parent = row.get("parentActor")
        if not actor_id or not parent:
            raise HandoffError("invalid-thread-roster", f"{fn} needs actorId and parentActor")
        normalized = dict(row)
        normalized.setdefault("roleId", "role.chatgpt.thread")
        normalized.setdefault("workRoleId", WORK_ROLE_BY_FUNCTION[fn])
        normalized.setdefault("scope", {})
        by_function[fn] = normalized

    missing = [fn for fn in THREAD_FUNCTIONS if fn not in by_function]
    if missing:
        raise HandoffError("invalid-thread-roster", f"missing threadFunction entries: {', '.join(missing)}")
    return [by_function[fn] for fn in THREAD_FUNCTIONS]


def rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root))


def readback_checklist(thread: dict[str, Any], manifest: dict[str, Any]) -> str:
    fn = thread["threadFunction"]
    files = [
        "HANDOFF_MANIFEST.json",
        "REQUEST.md",
        "COMMON/role-catalog.ref.json",
        "COMMON/organization-topology.a2ui.jsonl",
        "COMMON/source-manifest.json",
        "COMMON/runtime-manifest.json",
        f"THREADS/{fn}/BOOTSTRAP.md",
    ]
    role_ref = manifest["sourceRefs"]["roleCatalog"]
    request_ref = manifest["sourceRefs"]["request"]
    return "\n".join([
        f"# Readback checklist: {fn}",
        "",
        "Before doing assigned work, return a short readback that includes:",
        "",
        f"- actorId: {thread['actorId']}",
        f"- roleId: {thread['roleId']}",
        f"- threadFunction: {fn}",
        f"- workRoleId: {thread['workRoleId']}",
        f"- parentActor: {thread['parentActor']}",
        f"- role catalog sha256: {role_ref['sha256']}",
        f"- request sha256: {request_ref['sha256']}",
        "- file names read:",
        *[f"  - {name}" for name in files],
        "- your goal in one sentence",
        "- forbidden actions you must obey",
        "- proposed completion criteria",
        "",
        "Do not start implementation, review, merge-work, or merge-review before parent approval of criteria.",
        "",
    ])


def bootstrap(thread: dict[str, Any], request_title: str, manifest: dict[str, Any]) -> str:
    fn = thread["threadFunction"]
    forbidden = "\n".join(f"- {item}" for item in FORBIDDEN_BY_FUNCTION[fn])
    expected = "\n".join(f"- {item}" for item in EXPECTED_BY_FUNCTION[fn])
    scope = json.dumps(thread.get("scope", {}), indent=2, sort_keys=True)
    return f"""# Bootstrap: {fn}

You are a bound Project thread actor.

## Identity

- actorId: {thread['actorId']}
- roleId: {thread['roleId']}
- workRoleId: {thread['workRoleId']}
- threadFunction: {fn}
- parentActor: {thread['parentActor']}

## Request

- request title: {request_title}
- request file: REQUEST.md
- handoff manifest: HANDOFF_MANIFEST.json

## Scope

```json
{scope}
```

## Authority refs

- role catalog ref: COMMON/role-catalog.ref.json
- organization topology: COMMON/organization-topology.a2ui.jsonl
- command/request ref: COMMON/command-board.ref.json
- source manifest: COMMON/source-manifest.json
- runtime manifest: COMMON/runtime-manifest.json
- payload manifest: PAYLOAD/MANIFEST.json

These refs are inputs. They do not grant semantic approval or completion approval.

## Required first response

Read READBACK_CHECKLIST.md and return the requested short readback plus proposed
completion criteria. Do not start the assigned work until the parent approves
the criteria.

## Expected output

{expected}

## Forbidden actions

{forbidden}
- do not paste source, diff, review report, handoff body, or result artifact inline
- do not rely on conversation history when the Project Source files disagree
- do not claim complete-approved; only the direct parent can approve completion

## Handoff state

`handoff-created` is non-terminal. It only proves this input exists. Work is not
complete until the direct parent verifies evidence and appends approval.
"""


def expected_output_text(fn: str) -> str:
    title = "Expected output" if fn in ("impl-work", "merge-work") else "Review checklist"
    lines = [f"# {title}: {fn}", ""]
    lines.extend(f"- {item}" for item in EXPECTED_BY_FUNCTION[fn])
    lines.extend([
        "",
        "Always include evidence paths or artifact filenames and sha256 where available.",
        "Never treat upload, readback, or artifact visibility as semantic approval.",
        "",
    ])
    return "\n".join(lines)


def build_source_ref(path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }


def generate(args: argparse.Namespace) -> int:
    role_catalog = require_file(args.role_catalog, "role catalog")
    topology = require_file(args.topology, "organization topology")
    command_board = require_file(args.command_board, "command board or request record")
    request = require_file(args.request, "request")
    source_manifest = require_file(args.source_manifest, "source manifest")
    runtime_manifest = require_file(args.runtime_manifest, "runtime manifest")
    merge_target = require_file(args.merge_target, "merge target")
    thread_roster = require_file(args.thread_roster, "thread roster")

    source_value = load_json(source_manifest, "source manifest")
    runtime_value = load_json(runtime_manifest, "runtime manifest")
    merge_value = load_json(merge_target, "merge target")
    roster = normalize_roster(load_json(thread_roster, "thread roster"))

    out_dir = Path(args.out_dir)
    if out_dir.exists() and not args.force:
        raise HandoffError("output-exists", f"output directory already exists: {out_dir}")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    request_title = args.title or request.read_text(encoding="utf-8", errors="replace").splitlines()[0].lstrip("# ").strip() or "handoff request"
    created_at = datetime.now(timezone.utc).isoformat()

    common = out_dir / "COMMON"
    threads_dir = out_dir / "THREADS"
    payload_dir = out_dir / "PAYLOAD"
    payload_dir.mkdir(parents=True)

    common_refs = {
        "roleCatalog": build_source_ref(role_catalog),
        "organizationTopology": build_source_ref(topology),
        "commandBoard": build_source_ref(command_board),
        "request": build_source_ref(request),
        "sourceManifest": build_source_ref(source_manifest),
        "runtimeManifest": build_source_ref(runtime_manifest),
        "mergeTarget": build_source_ref(merge_target),
        "threadRoster": build_source_ref(thread_roster),
    }

    copy_file(request, out_dir / "REQUEST.md")
    copy_file(topology, common / "organization-topology.a2ui.jsonl")
    write_json(common / "role-catalog.ref.json", {
        "kind": "ops.handoff.roleCatalogRef.v1",
        "source": common_refs["roleCatalog"],
        "knownRoleIds": extract_role_ids(role_catalog),
        "note": "Role definitions remain in the role catalog. This handoff stores a reference and readable summaries only.",
    })
    write_json(common / "command-board.ref.json", {
        "kind": "ops.handoff.commandBoardRef.v1",
        "source": common_refs["commandBoard"],
    })
    write_json(common / "source-manifest.json", source_value)
    write_json(common / "runtime-manifest.json", runtime_value)
    write_json(common / "merge-target.json", merge_value)

    if args.payload_manifest:
        payload_manifest = require_file(args.payload_manifest, "payload manifest")
        payload_value = load_json(payload_manifest, "payload manifest")
        payload_ref = build_source_ref(payload_manifest)
    else:
        payload_value = {
            "kind": "ops.handoff.payloadManifest.v1",
            "payloadKind": "stub",
            "provider": "stub-provider-for-ops-handoff-core-proof",
            "sourceManifest": "COMMON/source-manifest.json",
            "runtimeManifest": "COMMON/runtime-manifest.json",
            "note": "Stub payload proves core independence from Src Pack + Offline Nix Cache.",
        }
        payload_ref = {
            "path": "generated:stub",
            "sha256": hashlib.sha256(json.dumps(payload_value, sort_keys=True).encode()).hexdigest(),
            "bytes": len(json.dumps(payload_value, sort_keys=True).encode()),
        }
    write_json(payload_dir / "MANIFEST.json", payload_value)

    handoff_id = args.handoff_id
    if not handoff_id:
        handoff_seed = "|".join([request_title, created_at, common_refs["request"]["sha256"], str(out_dir.resolve())])
        handoff_id = "handoff:" + hashlib.sha256(handoff_seed.encode("utf-8")).hexdigest()[:24]

    manifest: dict[str, Any] = {
        "kind": "ops.handoff.v1",
        "handoffId": handoff_id,
        "createdAt": created_at,
        "title": request_title,
        "state": {
            "current": "handoff-created",
            "terminal": False,
            "nextRequired": [
                "worker-readable-readback",
                "completion-criteria-proposed",
                "parent-criteria-approval",
                "thread-function-work",
            ],
        },
        "sourceRefs": common_refs,
        "payload": {
            "payloadKind": str(payload_value.get("payloadKind", "unknown")),
            "provider": str(payload_value.get("provider", "unknown")),
            "manifestPath": "PAYLOAD/MANIFEST.json",
            "source": payload_ref,
        },
        "mergeTarget": merge_value,
        "threads": [],
        "projectSource": {
            "entrypoint": "HANDOFF_MANIFEST.json",
            "inlineAllowed": ["short control", "pointer", "status", "filename", "sha256"],
            "inlineForbidden": ["source body", "diff body", "handoff body", "review report body", "artifact body"],
        },
        "approvalBoundary": {
            "transportReadbackIsApproval": False,
            "semanticApproval": False,
            "completionApproval": False,
        },
        "issues": [
            "ops/issues/001-thread-fsm-handoff-created-not-terminal.md",
            "ops/issues/002-project-transport-live-proof-hardening.md",
            "ops/issues/003-end-to-end-handoff-generator.md",
            "ops/issues/004-src-pack-offline-nix-cache-payload.md",
        ],
    }

    for thread in roster:
        fn = thread["threadFunction"]
        thread_path = threads_dir / fn
        thread_path.mkdir(parents=True)
        manifest["threads"].append({
            "actorId": thread["actorId"],
            "roleId": thread["roleId"],
            "workRoleId": thread["workRoleId"],
            "threadFunction": fn,
            "parentActor": thread["parentActor"],
            "scope": thread.get("scope", {}),
            "bootstrapPath": f"THREADS/{fn}/BOOTSTRAP.md",
            "readbackChecklistPath": f"THREADS/{fn}/READBACK_CHECKLIST.md",
        })
        write_text(thread_path / "BOOTSTRAP.md", bootstrap(thread, request_title, manifest))
        write_text(thread_path / "READBACK_CHECKLIST.md", readback_checklist(thread, manifest))
        if fn in ("impl-work", "merge-work"):
            file_name = "EXPECTED_OUTPUT.md"
        elif fn == "impl-review":
            file_name = "REVIEW_CHECKLIST.md"
        else:
            file_name = "MERGE_REVIEW_CHECKLIST.md"
        write_text(thread_path / file_name, expected_output_text(fn))

    write_json(out_dir / "HANDOFF_MANIFEST.json", manifest)

    result = {
        "ok": True,
        "status": "handoff-generated",
        "handoffDir": str(out_dir),
        "manifest": str(out_dir / "HANDOFF_MANIFEST.json"),
        "threadFunctions": list(THREAD_FUNCTIONS),
        "terminal": False,
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else f"handoff generated: {out_dir}")
    return 0


def validate(args: argparse.Namespace) -> int:
    root = Path(args.handoff_dir)
    manifest_path = root / "HANDOFF_MANIFEST.json"
    if not manifest_path.is_file():
        raise HandoffError("missing-manifest", f"missing HANDOFF_MANIFEST.json: {manifest_path}")
    manifest = load_json(manifest_path, "handoff manifest")
    errors: list[str] = []

    if manifest.get("kind") != "ops.handoff.v1":
        errors.append("manifest kind must be ops.handoff.v1")
    if manifest.get("state", {}).get("current") == "handoff-created" and manifest.get("state", {}).get("terminal") is not False:
        errors.append("handoff-created must be non-terminal")
    if manifest.get("approvalBoundary", {}).get("transportReadbackIsApproval") is not False:
        errors.append("transport/readback must not be approval")

    threads = manifest.get("threads", [])
    seen = {row.get("threadFunction") for row in threads if isinstance(row, dict)}
    for fn in THREAD_FUNCTIONS:
        if fn not in seen:
            errors.append(f"missing threadFunction in manifest: {fn}")
        tdir = root / "THREADS" / fn
        if not (tdir / "BOOTSTRAP.md").is_file():
            errors.append(f"missing bootstrap: {fn}")
        if not (tdir / "READBACK_CHECKLIST.md").is_file():
            errors.append(f"missing readback checklist: {fn}")

    for path in [
        root / "REQUEST.md",
        root / "COMMON" / "role-catalog.ref.json",
        root / "COMMON" / "organization-topology.a2ui.jsonl",
        root / "COMMON" / "command-board.ref.json",
        root / "COMMON" / "source-manifest.json",
        root / "COMMON" / "runtime-manifest.json",
        root / "PAYLOAD" / "MANIFEST.json",
    ]:
        if not path.is_file():
            errors.append(f"missing required generated file: {rel(path, root) if path.is_relative_to(root) else path}")

    role_ref = load_json(root / "COMMON" / "role-catalog.ref.json", "role catalog ref") if (root / "COMMON" / "role-catalog.ref.json").is_file() else {}
    if not role_ref.get("source", {}).get("sha256"):
        errors.append("role catalog ref must include source sha256")
    if not manifest.get("sourceRefs", {}).get("organizationTopology", {}).get("sha256"):
        errors.append("manifest must include organization topology sha256")

    role_catalog_sentinel = args.no_role_body_sentinel
    if role_catalog_sentinel:
        for bootstrap_path in (root / "THREADS").glob("*/BOOTSTRAP.md"):
            if role_catalog_sentinel in bootstrap_path.read_text(encoding="utf-8", errors="replace"):
                errors.append(f"role catalog body leaked into {rel(bootstrap_path, root)}")

    if errors:
        result = {"ok": False, "status": "handoff-invalid", "errors": errors}
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1

    result = {"ok": True, "status": "handoff-valid", "handoffDir": str(root), "threadFunctions": list(THREAD_FUNCTIONS)}
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def import_result(args: argparse.Namespace) -> int:
    if args.thread_function not in THREAD_FUNCTIONS:
        raise HandoffError("invalid-thread-function", f"invalid threadFunction: {args.thread_function}")
    artifacts = []
    for item in args.artifact or []:
        path = require_file(item, "artifact")
        artifacts.append({
            "path": str(path),
            "name": path.name,
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
        })
    run_report = require_file(args.run_report, "RUN_REPORT")
    verdict_text = ""
    verdict_source = None
    if args.verdict_file:
        verdict_file = require_file(args.verdict_file, "verdict file")
        verdict_text = verdict_file.read_text(encoding="utf-8", errors="replace")
        verdict_source = {
            "path": str(verdict_file),
            "sha256": sha256_file(verdict_file),
            "bytes": verdict_file.stat().st_size,
        }
    elif args.verdict:
        verdict_text = args.verdict
        verdict_source = {"inlineControl": True}
    else:
        raise HandoffError("missing-required-input", "missing verdict or verdict-file")

    expected_prefix = "impl-review-" if args.thread_function == "impl-review" else "merge-review-" if args.thread_function == "merge-review" else ""
    first_line = next((line.strip() for line in verdict_text.splitlines() if line.strip()), "")
    if expected_prefix and not first_line.startswith(expected_prefix):
        verdict_status = "verdict-not-gate-specific"
    else:
        verdict_status = "verdict-recorded"

    claim = {
        "kind": "ops.handoffResultClaim.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "threadFunction": args.thread_function,
        "status": "handoff-result-imported",
        "verdictStatus": verdict_status,
        "verdict": first_line,
        "verdictSource": verdict_source,
        "artifacts": artifacts,
        "runReport": {
            "path": str(run_report),
            "sha256": sha256_file(run_report),
            "bytes": run_report.stat().st_size,
        },
        "approvalBoundary": {
            "transportReadbackIsApproval": False,
            "semanticApproval": False,
            "completionApproval": False,
            "localizerApproval": False,
        },
    }
    if args.claim_path:
        claim_path = Path(args.claim_path)
        claim_path.parent.mkdir(parents=True, exist_ok=True)
        with claim_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(claim, sort_keys=True) + "\n")
    result = {
        "ok": True,
        "status": "handoff-result-imported",
        "threadFunction": args.thread_function,
        "claimPath": args.claim_path,
        "claim": claim,
        "semanticApproval": False,
        "completionApproval": False,
        "localizerApproval": False,
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else "handoff-result-imported")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ops-handoff-core")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate")
    gen.add_argument("--role-catalog")
    gen.add_argument("--topology")
    gen.add_argument("--command-board")
    gen.add_argument("--request")
    gen.add_argument("--source-manifest")
    gen.add_argument("--runtime-manifest")
    gen.add_argument("--merge-target")
    gen.add_argument("--thread-roster")
    gen.add_argument("--payload-manifest")
    gen.add_argument("--out-dir", required=True)
    gen.add_argument("--handoff-id")
    gen.add_argument("--title")
    gen.add_argument("--force", action="store_true")
    gen.add_argument("--json", action="store_true")
    gen.set_defaults(handler=generate)

    val = sub.add_parser("validate")
    val.add_argument("--handoff-dir", required=True)
    val.add_argument("--no-role-body-sentinel", default="")
    val.set_defaults(handler=validate)

    imp = sub.add_parser("import-result")
    imp.add_argument("--thread-function", required=True, choices=THREAD_FUNCTIONS)
    imp.add_argument("--artifact", action="append", default=[])
    imp.add_argument("--run-report", required=True)
    imp.add_argument("--verdict")
    imp.add_argument("--verdict-file")
    imp.add_argument("--claim-path")
    imp.add_argument("--json", action="store_true")
    imp.set_defaults(handler=import_result)

    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except HandoffError as exc:
        result = {"ok": False, "status": exc.status, "error": exc.message}
        print(json.dumps(result, indent=2, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
