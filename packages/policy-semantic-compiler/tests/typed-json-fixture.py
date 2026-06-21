#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_root(root: Path) -> None:
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    write_json(root / "schemas/sample.schema.json", {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["kind", "items"],
        "additionalProperties": False,
        "properties": {
            "kind": {"const": "sample.v1"},
            "status": {"enum": ["active", "retired"]},
            "items": {"type": "array", "minItems": 1, "items": {"type": "string", "pattern": "^item\\."}},
        },
        "not": {"anyOf": [{"required": ["legacy"]}]},
        "anyOf": [{"required": ["items"]}],
    })
    write_json(root / "policy-router.v1.json", {
        "kind": "policy.router.v1",
        "defaultRead": ["AGENTS.md"],
        "taskRoutes": [{"routeId": "r1", "read": ["kernel/"], "forbidden": ["transport approval"], "outputs": ["claim.v1"]}],
        "forbiddenSourceRoots": [".agents/"],
    })
    role = {"kind": "role.profile.v1", "roleProfileId": "role.policyOwner", "roleId": "role.policyOwner", "status": "active", "kernelRef": "kernel/", "modules": ["module.gate-policy-core"], "ownerRoleRef": "role.rootCoordinator"}
    write_json(root / "role-profiles/policy-owner.json", role)
    write_json(root / "role-profiles/index.v1.json", {"kind": "role.profile.index.v1", "items": [{"roleProfileId": "role.policyOwner", "roleId": "role.policyOwner", "path": "role-profiles/policy-owner.json", "modules": ["module.gate-policy-core"], "sha256": sha256(root / "role-profiles/policy-owner.json")}]})
    write_json(root / "role-exit-graph.v1.json", {"kind": "role.exitGraph.v1", "edges": [{"exit": "policy-conflict", "ownerRoleRef": "role.policyOwner", "ttl": "PT30M"}]})
    write_json(root / "protocols/board-test.v1/protocol.envelope.json", {"kind": "protocol.envelope.v1", "regions": {"Lifecycle": {"states": ["draft"], "terminalStates": ["done"]}}, "commands": {"governance.promote": {"kind": "cmd", "guards": ["actor_authorized"], "effects": ["canonicalize", "write-log"], "emits": ["board.event.recorded"], "region": "Lifecycle", "topologyAction": "governance.promote", "canonicalStateEffect": "accepted", "risk": "high", "requiresApproval": True}}})
    write_json(root / "protocols/board-test.v1/workflow.mmds.json", {"kind": "workflow.layout.v1", "nodes": [{"id": "n1", "x": 1, "y": 2}]})
    write_json(root / "kernel/authority-index.v1.json", {"kind": "authority.index.v1", "normative": ["schemas/*.schema.json"], "rawEvidence": ["records/raw/*.jsonl"], "generated": ["projections/**"], "mustNotUseAsAuthority": ["reports/**"]})
    write_json(root / "kernel/index.v1.json", {"kind": "kernel.index.v1", "items": [{"path": "kernel/authority-index.v1.json", "sha256": sha256(root / "kernel/authority-index.v1.json")}]})


def run(root: Path, out: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    if out.exists():
        shutil.rmtree(out)
    return subprocess.run(["policy-semantic-compiler", "extract-typed-json", "--policy-root", str(root), "--out-dir", str(out), *extra], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    work = Path(sys.argv[1])
    root = work / "typed-json-root"
    build_root(root)
    ok_out = work / "typed-json-ok"
    proc = run(root, ok_out)
    require(proc.returncode == 0, proc.stdout + proc.stderr)
    manifest = json.loads((ok_out / "manifest.json").read_text(encoding="utf-8"))
    require(manifest["ok"] is True, "manifest not ok")
    require(manifest["cutoverReady"] is False, "cutover changed")
    require(manifest["policyDeletionApproved"] is False, "deletion approved")
    gates = load_jsonl(ok_out / "typed-gates.jsonl")
    require(all(row["status"] == "pass" for row in gates), "gate not pass")
    nodes = load_jsonl(ok_out / "typed-semantic-nodes.jsonl")
    node_kinds = {row["nodeKind"] for row in nodes}
    for kind in ["schema.required", "schema.const", "schema.enum", "schema.pattern", "schema.min-items", "schema.additional-properties", "schema.not-required", "schema.anyof-branch", "router.forbidden-source-root", "role.index-sha256-lock", "role.owner-role", "role.module-binding", "protocol.guard", "protocol.effect", "protocol.emitted-event", "protocol.region", "protocol.topology-action", "protocol.canonical-state-effect", "protocol.risk", "protocol.requires-approval", "projection.layout"]:
        require(kind in node_kinds, f"missing node kind {kind}")
    spans = load_jsonl(ok_out / "typed-source-spans.jsonl")
    require(all("jsonPointer" in row["sourceTrace"] for row in spans), "missing jsonPointer")
    span_pointers = {row["sourceTrace"]["jsonPointer"] for row in spans}
    require("/anyOf/0/required/0" in span_pointers, "bad anyOf required pointer")
    require("/not/anyOf/0/required/0" in span_pointers, "bad not.anyOf required pointer")
    negative = load_jsonl(ok_out / "deletion-negative-controls.jsonl")
    require(any(row["inputClaim"] == "policy.git may be deleted" for row in negative), "missing deletion negative control")
    for violation in ["role-index-sha-mismatch", "drop-protocol-guard", "drop-protocol-effect", "duplicate-protocol-effect-drop-first", "drop-protocol-emit", "drop-schema-required", "drop-router-forbidden-root", "drop-role-owner", "drop-role-module", "layout-as-authority", "inject-deletion-approval"]:
        bad_out = work / f"typed-json-{violation}"
        bad = run(root, bad_out, "--inject-violation", violation)
        require(bad.returncode != 0, f"violation unexpectedly passed: {violation}")
    print(json.dumps({"ok": True, "root": str(root), "out": str(ok_out)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
