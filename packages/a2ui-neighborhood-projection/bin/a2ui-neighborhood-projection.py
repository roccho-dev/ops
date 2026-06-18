#!/usr/bin/env python3
import argparse
import json
import sys
from collections import defaultdict


def read_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{line_no}: invalid JSON: {exc}") from exc
    return rows


def node_ref(node):
    return {
        "id": node["id"],
        "kind": node.get("kind", "node"),
        "label": node.get("label", node["id"]),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Project admitted graph JSONL into a resolved A2UI neighborhood context surface."
    )
    parser.add_argument("--raw", required=True, help="Input JSONL with namespace, role, node, edge, and current records.")
    parser.add_argument("--out", required=True, help="Output JSON file path.")
    parser.add_argument("--current", help="Override current node id.")
    args = parser.parse_args(argv)

    rows = read_jsonl(args.raw)
    namespaces = {}
    roles = {}
    nodes = {}
    edges = []
    current_id = args.current

    for row in rows:
        record_kind = row.get("recordKind", row.get("recordType", row.get("kind")))
        if record_kind == "context.namespace.v1":
            namespaces[row["symbol"]] = row
        elif record_kind == "context.roleBinding.v1":
            roles[row["roleId"]] = row
        elif record_kind == "context.node.v1":
            nodes[row["id"]] = row
        elif record_kind == "context.edge.v1":
            edges.append(row)
        elif record_kind == "context.current.v1" and not current_id:
            current_id = row["nodeId"]

    if not current_id:
        raise SystemExit("missing current node: provide --current or context.current.v1")
    if current_id not in nodes:
        raise SystemExit(f"current node is not present: {current_id}")

    current = nodes[current_id]
    namespace_symbol = current.get("namespace", "CEO")
    namespace = namespaces.get(namespace_symbol)
    if not namespace:
        raise SystemExit(f"namespace symbol is not present: {namespace_symbol}")
    role_id = namespace.get("roleId")
    role = roles.get(role_id)
    if not role:
        raise SystemExit(f"role binding is not present: {role_id}")

    incoming = defaultdict(list)
    outgoing = defaultdict(list)
    relevant_edges = []
    for edge in edges:
        if edge.get("source") in nodes and edge.get("target") in nodes:
            outgoing[edge["source"]].append(edge)
            incoming[edge["target"]].append(edge)
            if edge["source"] == current_id or edge["target"] == current_id:
                relevant_edges.append(edge)

    relation_to_bucket = {
        "governs": "up",
        "parentOf": "up",
        "requires": "down",
        "contains": "down",
        "dependsOn": "left",
        "blocks": "left",
        "enables": "right",
        "nextAction": "right",
        "sameContext": "around",
        "relatedTo": "around",
    }
    buckets = {name: [] for name in ["up", "down", "left", "right", "around"]}

    for edge in incoming[current_id]:
        bucket = relation_to_bucket.get(edge.get("kind"), "around")
        buckets[bucket].append(node_ref(nodes[edge["source"]]))
    for edge in outgoing[current_id]:
        bucket = relation_to_bucket.get(edge.get("kind"), "around")
        buckets[bucket].append(node_ref(nodes[edge["target"]]))

    surface = {
        "kind": "a2ui.context.surface.v1",
        "schemaVersion": "v1",
        "surfaceId": f"a2ui-neighborhood:{current_id}",
        "current": node_ref(current),
        "namespace": {
            "symbol": namespace_symbol,
            "modelingMutable": True,
            "resolvedRoleId": role_id,
            "caveats": [
                "c?o is a mutable namespace symbol, not a fixed executive taxonomy."
            ],
        },
        "role": {
            "roleId": role_id,
            "policies": role.get("policies", []),
        },
        "neighborhood": buckets,
        "edges": [
            {
                "source": edge["source"],
                "target": edge["target"],
                "kind": edge.get("kind", "relatedTo"),
                "evidence": edge.get("evidence", []),
            }
            for edge in relevant_edges
        ],
        "caveats": [
            "Raw JSONL is input, not authority.",
            "A2UI is a resolved context surface, not canonical graph truth.",
            "Browser graph replay is rendering/prototype behavior only.",
        ],
        "renderHints": {
            "layout": "neighborhood",
            "currentNodeEmphasis": True,
        },
        "authorityBoundary": {
            "rawIsAuthority": False,
            "browserGraphIsAuthority": False,
            "webmcpIsAuthority": False,
            "a2uiIsAuthority": False,
            "semanticAuthority": [
                "accepted ADR/policy records",
                "role = policies[]",
                "namespace mapping",
            ],
        },
        "sourceRefs": [
            {
                "repo": "ops",
                "path": args.raw,
                "role": "deterministic projection input",
            },
            {
                "repo": "policy",
                "path": "schemas/context-graph-a2ui.v1.schema.json",
                "role": "surface contract",
            },
        ],
    }

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(surface, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
