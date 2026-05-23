#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path


def node_id(value):
    text = re.sub(r"[^A-Za-z0-9_]", "_", str(value).strip())
    if not text:
        text = "node"
    if text[0].isdigit():
        text = f"n_{text}"
    return text


def esc(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def label_lines(item):
    lines = [item.get("label") or item.get("id")]
    for key in ("path", "status", "responsibility"):
        if item.get(key):
            lines.append(item[key])
    for value in item.get("forbidden", []):
        lines.append(f"forbidden: {value}")
    return "<br/>".join(esc(line) for line in lines if line)


def render_item(item, indent=1):
    pad = "  " * indent
    item_kind = item.get("kind")
    children = item.get("children")
    ident = node_id(item.get("id") or item.get("label"))
    label = esc(item.get("label") or item.get("id") or ident)

    if item_kind == "group" or children is not None:
        lines = [f'{pad}subgraph {ident}["{label}"]']
        for child in children or []:
            lines.extend(render_item(child, indent + 1))
        lines.append(f"{pad}end")
        return lines

    return [f'{pad}{ident}["{label_lines(item)}"]']


def render_edge(edge):
    left = node_id(edge["from"])
    right = node_id(edge["to"])
    label = edge.get("label")
    style = edge.get("style", "solid")
    if style in ("dotted", "later", "future"):
        if label:
            return f'  {left} -. "{esc(label)}" .-> {right}'
        return f"  {left} -.-> {right}"
    if label:
        return f'  {left} -->|"{esc(label)}"| {right}'
    return f"  {left} --> {right}"


def render_mermaid(inventory):
    direction = inventory.get("direction", "TD")
    lines = [f"flowchart {direction}"]
    title = inventory.get("title")
    if title:
        lines.append(f"  %% {title}")

    for group in inventory.get("groups", []):
        lines.extend(render_item(group))

    for item in inventory.get("nodes", []):
        lines.extend(render_item(item))

    edges = inventory.get("edges", [])
    if edges:
        lines.append("")
    for edge in edges:
        lines.append(render_edge(edge))

    return "\n".join(lines) + "\n"


def iter_items(items):
    for item in items:
        yield item
        for child in iter_items(item.get("children", [])):
            yield child


def validate_inventory(inventory):
    errors = []
    if not isinstance(inventory, dict):
        return ["inventory must be a JSON object"]

    groups = inventory.get("groups", [])
    nodes = inventory.get("nodes", [])
    edges = inventory.get("edges", [])

    if not isinstance(groups, list):
        errors.append("groups must be a list when present")
        groups = []
    if not isinstance(nodes, list):
        errors.append("nodes must be a list when present")
        nodes = []
    if not isinstance(edges, list):
        errors.append("edges must be a list when present")
        edges = []

    raw_ids = {}
    generated_ids = {}
    for item in list(iter_items(groups)) + list(iter_items(nodes)):
        if not isinstance(item, dict):
            errors.append("each group/node item must be an object")
            continue
        raw_id = item.get("id") or item.get("label")
        if not raw_id:
            errors.append("each group/node item must have id or label")
            continue
        generated = node_id(raw_id)
        if raw_id in raw_ids:
            errors.append(f"duplicate id: {raw_id}")
        raw_ids[raw_id] = item
        if generated in generated_ids and generated_ids[generated] != raw_id:
            errors.append(f"node id collision after normalization: {generated_ids[generated]} / {raw_id}")
        generated_ids[generated] = raw_id

    for edge in edges:
        if not isinstance(edge, dict):
            errors.append("each edge must be an object")
            continue
        if "from" not in edge or "to" not in edge:
            errors.append("each edge must have from and to")
            continue
        for field in ("from", "to"):
            value = edge[field]
            if value not in raw_ids and node_id(value) not in generated_ids:
                errors.append(f"edge {field} references unknown node: {value}")

    return errors


def copy_viewer(viewer_src, out_dir):
    if not viewer_src:
        return
    src = Path(viewer_src)
    if src.exists():
        shutil.copyfile(src, out_dir / "index.html")


def main():
    parser = argparse.ArgumentParser(
        description="Render package architecture inventory JSON to Mermaid .mmd and a static viewer dist."
    )
    parser.add_argument("inventory_pos", nargs="?", help="inventory JSON path")
    parser.add_argument("--inventory", help="inventory JSON path")
    parser.add_argument("--out-dir", default="dist", help="output directory")
    parser.add_argument("--name", default="latest", help="map name under dist/maps")
    parser.add_argument("--stdout", action="store_true", help="print Mermaid only")
    parser.add_argument("--validate-only", action="store_true", help="validate inventory and exit")
    parser.add_argument(
        "--viewer",
        default=os.environ.get("PACKAGE_ARCHITECTURE_MAP_VIEWER", ""),
        help="viewer/index.html to copy into dist",
    )
    args = parser.parse_args()

    inventory_path = args.inventory or args.inventory_pos
    if not inventory_path:
        parser.error("inventory JSON path is required")

    with open(inventory_path, "r", encoding="utf-8") as handle:
        inventory = json.load(handle)

    errors = validate_inventory(inventory)
    if args.validate_only:
        result = {
            "kind": "packageArchitectureMap.validation.v1",
            "ok": not errors,
            "errors": errors,
            "source": str(Path(inventory_path)),
        }
        stream = sys.stdout if not errors else sys.stderr
        print(json.dumps(result, sort_keys=True), file=stream)
        raise SystemExit(0 if not errors else 2)
    if errors:
        print(
            json.dumps(
                {
                    "kind": "packageArchitectureMap.validation.v1",
                    "ok": False,
                    "errors": errors,
                    "source": str(Path(inventory_path)),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        raise SystemExit(2)

    mermaid = render_mermaid(inventory)
    if args.stdout:
        print(mermaid, end="")
        return

    out_dir = Path(args.out_dir)
    maps_dir = out_dir / "maps"
    maps_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "latest.mmd").write_text(mermaid, encoding="utf-8")
    (maps_dir / f"{args.name}.mmd").write_text(mermaid, encoding="utf-8")
    copy_viewer(args.viewer, out_dir)

    manifest = {
        "kind": "packageArchitectureMap.result.v1",
        "source": str(Path(inventory_path)),
        "latest": str(out_dir / "latest.mmd"),
        "named": str(maps_dir / f"{args.name}.mmd"),
        "viewer": str(out_dir / "index.html") if (out_dir / "index.html").exists() else None,
        "authority": "inventory-json",
        "generatedIsAuthority": False,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()
