#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path


TEXT_SUFFIXES = {
    ".md",
    ".json",
    ".jsonl",
    ".txt",
    ".yaml",
    ".yml",
    ".toml",
    ".nix",
    ".mjs",
    ".js",
}

SKIP_PARTS = {".git", "node_modules", "dist", "build", ".direnv"}

EDGE_RULES = [
    ("deny", ["must not", "do not", "forbidden", "deny", "not allowed", "cannot", "shall not"]),
    ("obligation", ["must", "shall", "required", "requires", "require ", "need to", "needs to"]),
    ("activation", ["when ", "if ", "only when", "after ", "before ", "until "]),
    ("consumer", ["consumer", "role", "agent", "gen0", "gen1", "gen2", "chatgpt", "claude", "codex"]),
    ("authority", ["authority", "canonical", "ssot", "source of truth", "not canonical"]),
    ("replacement", ["replace", "replacement", "retire", "deprecate", "supersede", "migration"]),
    ("evidence", ["proof", "evidence", "verify", "test", "readback", "pass", "block"]),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_PARTS for part in rel.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def read_text(path: Path) -> str:
    data = path.read_bytes()
    return data.decode("utf-8", errors="replace")


def classify_line(line: str):
    lower = line.lower()
    out = []
    for kind, needles in EDGE_RULES:
        if any(needle in lower for needle in needles):
            out.append(kind)
    return out


def node_kind(rel: str) -> str:
    if rel.startswith("projections/"):
        return "projection"
    if rel.startswith("compat/") or rel.startswith("legacy/"):
        return "legacy"
    if rel.startswith("issues/"):
        return "issue-record"
    if rel.startswith("docs/"):
        return "doc"
    if rel.startswith("packages/"):
        return "package"
    if rel.endswith(".jsonl"):
        return "ledger"
    if rel.endswith(".json"):
        return "json"
    return "source"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy-root", required=True)
    parser.add_argument("--policy-ref", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    root = Path(args.policy_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    nodes = []
    edges = []
    consumer_refs = []
    untyped = []
    prose_only = []

    for path in iter_files(root):
        rel = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines()
        node_id = "source:" + sha256_bytes(rel.encode("utf-8"))[:16]
        node = {
            "type": "policy.sourceNode.v1",
            "id": node_id,
            "policyRef": args.policy_ref,
            "path": rel,
            "kind": node_kind(rel),
            "sha256": sha256_bytes(raw),
            "bytes": len(raw),
            "lineCount": len(lines),
        }
        nodes.append(node)

        file_edge_count = 0
        for line_no, line in enumerate(lines, start=1):
            kinds = classify_line(line)
            if not kinds:
                continue
            excerpt = line.strip()
            if not excerpt:
                continue
            for kind in kinds:
                edge = {
                    "type": "policy.semanticEdge.v1",
                    "id": f"edge:{sha256_bytes((rel + ':' + str(line_no) + ':' + kind + ':' + excerpt).encode('utf-8'))[:20]}",
                    "policyRef": args.policy_ref,
                    "sourceNode": node_id,
                    "sourcePath": rel,
                    "line": line_no,
                    "edgeKind": kind,
                    "sourceSpan": {"startLine": line_no, "endLine": line_no},
                    "text": excerpt[:500],
                    "trace": f"{rel}:{line_no}",
                    "extraction": "heuristic-keyword-baseline",
                }
                edges.append(edge)
                file_edge_count += 1

            lower = line.lower()
            if "policy.git" in lower or "policy repo" in lower or "policy/" in lower:
                consumer_refs.append({
                    "type": "policy.consumerRef.v1",
                    "policyRef": args.policy_ref,
                    "sourcePath": rel,
                    "line": line_no,
                    "text": excerpt[:500],
                })

        if file_edge_count == 0:
            untyped.append({
                "path": rel,
                "kind": node["kind"],
                "lineCount": len(lines),
                "reason": "no heuristic semantic edge extracted",
            })
        elif path.suffix.lower() == ".md" and file_edge_count < max(1, len(lines) // 80):
            prose_only.append({
                "path": rel,
                "kind": node["kind"],
                "lineCount": len(lines),
                "edgeCount": file_edge_count,
                "reason": "low edge density for prose document",
            })

    required_edge_kinds = {kind for kind, _ in EDGE_RULES}
    observed_edge_kinds = {edge["edgeKind"] for edge in edges}
    missing_edge_kinds = sorted(required_edge_kinds - observed_edge_kinds)

    coverage = {
        "type": "policy.graphCoverage.v1",
        "policyRef": args.policy_ref,
        "sourceNodeCount": len(nodes),
        "semanticEdgeCount": len(edges),
        "filesWithEdges": len(nodes) - len(untyped),
        "filesWithoutEdges": len(untyped),
        "coverageRatio": 0 if not nodes else round((len(nodes) - len(untyped)) / len(nodes), 4),
        "edgeKindsObserved": sorted(observed_edge_kinds),
        "edgeKindsMissing": missing_edge_kinds,
        "lowDensityProseFiles": len(prose_only),
        "consumerRefCount": len(consumer_refs),
    }

    gates = {
        "type": "policy.deletionReadinessGates.v1",
        "policyRef": args.policy_ref,
        "decision": "BLOCK",
        "gates": [
            {
                "name": "all-source-files-have-semantic-edges",
                "status": "PASS" if not untyped else "BLOCK",
                "actual": len(untyped),
                "expected": 0,
            },
            {
                "name": "all-required-edge-kinds-observed",
                "status": "PASS" if not missing_edge_kinds else "BLOCK",
                "actual": missing_edge_kinds,
                "expected": [],
            },
            {
                "name": "low-density-prose-reviewed",
                "status": "PASS" if not prose_only else "BLOCK",
                "actual": len(prose_only),
                "expected": 0,
            },
            {
                "name": "active-policy-repo-consumer-refs-eliminated",
                "status": "PASS" if not consumer_refs else "BLOCK",
                "actual": len(consumer_refs),
                "expected": 0,
            },
            {
                "name": "heuristic-extraction-not-final-authority",
                "status": "BLOCK",
                "actual": "heuristic-keyword-baseline",
                "expected": "accepted typed semantic graph compiler",
            },
        ],
        "notDeletionReady": True,
    }

    def write_jsonl(name: str, rows):
        with (out_dir / name).open("w", encoding="utf-8", newline="\n") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    write_jsonl("policy_source_nodes.jsonl", nodes)
    write_jsonl("policy_semantic_edges.jsonl", edges)
    write_jsonl("policy_consumer_refs.jsonl", consumer_refs)
    write_jsonl("policy_untyped_sources.jsonl", untyped)
    write_jsonl("policy_low_density_prose.jsonl", prose_only)
    (out_dir / "policy_deletion_readiness_gates.json").write_text(
        json.dumps(gates, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (out_dir / "policy_graph_coverage.json").write_text(
        json.dumps(coverage, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    counter_lines = [
        "# Policy semantic graph counterexamples",
        "",
        f"- policyRef: `{args.policy_ref}`",
        f"- decision: `{gates['decision']}`",
        "",
        "## Counterexample classes",
        "",
        f"- Untyped source files: {len(untyped)}",
        f"- Low-density prose files: {len(prose_only)}",
        f"- Active policy repo consumer references: {len(consumer_refs)}",
        "- Extractor class: heuristic baseline, not accepted typed compiler",
        "",
        "## First untyped files",
        "",
    ]
    for item in untyped[:50]:
        counter_lines.append(f"- `{item['path']}`: {item['reason']}")
    counter_lines.extend(["", "## First active consumer refs", ""])
    for item in consumer_refs[:50]:
        counter_lines.append(f"- `{item['sourcePath']}:{item['line']}`: {item['text'][:160]}")
    (out_dir / "counterexamples.md").write_text("\n".join(counter_lines) + "\n", encoding="utf-8")

    report = [
        "# Policy semantic graph coverage",
        "",
        f"- policyRef: `{args.policy_ref}`",
        f"- sourceNodeCount: {coverage['sourceNodeCount']}",
        f"- semanticEdgeCount: {coverage['semanticEdgeCount']}",
        f"- coverageRatio: {coverage['coverageRatio']}",
        f"- filesWithoutEdges: {coverage['filesWithoutEdges']}",
        f"- lowDensityProseFiles: {coverage['lowDensityProseFiles']}",
        f"- consumerRefCount: {coverage['consumerRefCount']}",
        f"- deletionReadiness: `{gates['decision']}`",
        "",
        "This is a baseline graph extraction. It is evidence for the next",
        "migration step, not proof that `policy.git` can be deleted.",
    ]
    (out_dir / "policy_graph_coverage.md").write_text("\n".join(report) + "\n", encoding="utf-8")

    manifest_rows = []
    for file_path in sorted(out_dir.iterdir()):
        if file_path.is_file():
            data = file_path.read_bytes()
            manifest_rows.append({
                "path": file_path.name,
                "sha256": sha256_bytes(data),
                "bytes": len(data),
            })
    (out_dir / "manifest.json").write_text(
        json.dumps({
            "type": "policy.semanticGraphBaselineManifest.v1",
            "policyRef": args.policy_ref,
            "files": manifest_rows,
            "decision": gates["decision"],
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(json.dumps({
        "outDir": str(out_dir),
        "policyRef": args.policy_ref,
        "sourceNodeCount": len(nodes),
        "semanticEdgeCount": len(edges),
        "decision": gates["decision"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
