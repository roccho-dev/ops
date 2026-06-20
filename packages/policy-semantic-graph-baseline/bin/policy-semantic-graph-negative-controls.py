#!/usr/bin/env python3
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


EDGE_LINES = {
    "deny": "Do not claim deletion approval.",
    "obligation": "Required boundary preservation applies.",
    "activation": "If policy is external, the run blocks.",
    "consumer": "Gen2 ChatGPT is a consumer reviewer.",
    "authority": "SSOT is the canonical authority.",
    "replacement": "Replacement supersedes the old repo.",
    "evidence": "Evidence verifies the result.",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_jsonl(path: Path):
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def make_fixture(root: Path, omitted_kind: str | None = None, consumer_ref: bool = False, empty_file: bool = False) -> None:
    root.mkdir(parents=True, exist_ok=True)
    if empty_file:
        (root / "policy.md").write_text("This line intentionally has no semantic trigger.\n", encoding="utf-8")
        return
    lines = []
    for kind, line in EDGE_LINES.items():
        if kind != omitted_kind:
            lines.append(line)
    if consumer_ref:
        lines.append("Runtime mentions policy.git as an active consumer reference.")
    (root / "policy.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_generator(generator: Path, fixture: Path, out_dir: Path, policy_ref: str) -> dict:
    cmd = [
        sys.executable,
        str(generator),
        "--policy-root",
        str(fixture),
        "--policy-ref",
        policy_ref,
        "--out-dir",
        str(out_dir),
    ]
    proc = subprocess.run(cmd, text=True, capture_output=True, check=False)
    return {
        "command": cmd,
        "exitCode": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def gate_by_name(gates: dict, name: str) -> dict:
    for gate in gates["gates"]:
        if gate["name"] == name:
            return gate
    raise KeyError(name)


def validate_source_hashes(source_root: Path, nodes: list[dict]) -> list[str]:
    failures = []
    for node in nodes:
        path = source_root / node["path"]
        if not path.exists():
            failures.append(f"missing source file {node['path']}")
            continue
        actual = sha256_bytes(path.read_bytes())
        if actual != node["sha256"]:
            failures.append(f"stale source node {node['path']}")
    return failures


def validate_edge_spans(edges: list[dict]) -> list[str]:
    return [edge["id"] for edge in edges if not edge.get("sourceSpan")]


def control_result(name: str, passed: bool, details: dict) -> dict:
    return {
        "name": name,
        "passed": passed,
        "details": details,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generator", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--policy-ref", default="negative-control-fixture")
    args = parser.parse_args()

    generator = Path(args.generator).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    with tempfile.TemporaryDirectory(prefix="policy-negative-controls-") as tmp:
        tmp_root = Path(tmp)

        for omitted in ["deny", "obligation", "activation"]:
            fixture = tmp_root / f"missing-{omitted}"
            generated = tmp_root / f"out-missing-{omitted}"
            make_fixture(fixture, omitted_kind=omitted)
            run = run_generator(generator, fixture, generated, args.policy_ref)
            gates = load_json(generated / "policy_deletion_readiness_gates.json")
            edge_gate = gate_by_name(gates, "all-required-edge-kinds-observed")
            results.append(control_result(
                f"missing-{omitted}-edge",
                run["exitCode"] == 0 and edge_gate["status"] == "BLOCK" and omitted in edge_gate["actual"],
                {"run": run, "gate": edge_gate},
            ))

        fixture = tmp_root / "empty-source"
        generated = tmp_root / "out-empty-source"
        make_fixture(fixture, empty_file=True)
        run = run_generator(generator, fixture, generated, args.policy_ref)
        gates = load_json(generated / "policy_deletion_readiness_gates.json")
        source_gate = gate_by_name(gates, "all-source-files-have-semantic-edges")
        results.append(control_result(
            "source-file-with-no-edges",
            run["exitCode"] == 0 and source_gate["status"] == "BLOCK" and source_gate["actual"] == 1,
            {"run": run, "gate": source_gate},
        ))

        fixture = tmp_root / "consumer-ref"
        generated = tmp_root / "out-consumer-ref"
        make_fixture(fixture, consumer_ref=True)
        run = run_generator(generator, fixture, generated, args.policy_ref)
        gates = load_json(generated / "policy_deletion_readiness_gates.json")
        consumer_gate = gate_by_name(gates, "active-policy-repo-consumer-refs-eliminated")
        consumer_index = load_json(generated / "policy_consumer_refs.index.json")
        results.append(control_result(
            "active-consumer-ref-blocks",
            run["exitCode"] == 0 and consumer_gate["status"] == "BLOCK" and consumer_index["rowCount"] >= 1,
            {"run": run, "gate": consumer_gate, "consumerIndex": consumer_index},
        ))

        fixture = tmp_root / "all-edges"
        generated = tmp_root / "out-all-edges"
        make_fixture(fixture)
        run = run_generator(generator, fixture, generated, args.policy_ref)
        nodes = load_jsonl(generated / "policy_source_nodes.jsonl")
        edges = load_jsonl(generated / "policy_semantic_edges.jsonl")
        results.append(control_result(
            "source-node-hashes-validate",
            run["exitCode"] == 0 and not validate_source_hashes(fixture, nodes),
            {"run": run, "sourceNodeCount": len(nodes)},
        ))
        tampered_nodes = [dict(row) for row in nodes]
        tampered_nodes[0]["sha256"] = "0" * 64
        results.append(control_result(
            "stale-source-node-detected",
            bool(validate_source_hashes(fixture, tampered_nodes)),
            {"failureCount": len(validate_source_hashes(fixture, tampered_nodes))},
        ))
        results.append(control_result(
            "edge-source-spans-validate",
            run["exitCode"] == 0 and not validate_edge_spans(edges),
            {"run": run, "semanticEdgeCount": len(edges)},
        ))
        tampered_edges = [dict(row) for row in edges]
        tampered_edges[0].pop("sourceSpan", None)
        results.append(control_result(
            "removed-source-span-detected",
            bool(validate_edge_spans(tampered_edges)),
            {"failureCount": len(validate_edge_spans(tampered_edges))},
        ))

    passed = sum(1 for item in results if item["passed"])
    payload = {
        "type": "policy.negativeControlResults.v1",
        "policyRef": args.policy_ref,
        "decision": "PASS" if passed == len(results) else "BLOCK",
        "passed": passed,
        "total": len(results),
        "controls": results,
        "runtime": {
            "python": sys.version,
            "platform": platform.platform(),
            "generator": str(generator),
        },
    }
    write_json(out_dir / "policy_negative_control_results.json", payload)
    receipt = {
        "type": "policy.independentRerunReceipt.v1",
        "policyRef": args.policy_ref,
        "verifier": "policy-semantic-graph-negative-controls.py",
        "exitCode": 0 if payload["decision"] == "PASS" else 1,
        "resultPath": "policy_negative_control_results.json",
        "resultSha256": sha256_bytes((out_dir / "policy_negative_control_results.json").read_bytes()),
        "runtime": payload["runtime"],
    }
    write_json(out_dir / "policy_independent_rerun_receipt.json", receipt)
    print(json.dumps({"decision": payload["decision"], "passed": passed, "total": len(results)}, sort_keys=True))
    return 0 if payload["decision"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
