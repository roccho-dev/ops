#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
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
