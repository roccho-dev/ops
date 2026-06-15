#!/usr/bin/env node
// Render package architecture inventory JSON to Mermaid .mmd and a static viewer dist.
//
// Node ESM port of package-architecture-map.py (stdlib only, behavior-identical).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

process.on("unhandledRejection", (e) => {
  console.error(e);
  process.exit(1);
});

// Python str.strip() removes leading/trailing whitespace.
function pyStrip(s) {
  return s.replace(/^\s+/u, "").replace(/\s+$/u, "");
}

// Python json.dumps(obj, sort_keys=True) with default separators (", ", ": ").
// Inputs here are strings/bools/null/ints/arrays/objects (ASCII content).
function pyJson(value, sortKeys, indent) {
  return ser(value, sortKeys, indent, 0);
}

function jsonString(s) {
  // Python json default (ensure_ascii=True) escapes non-ASCII as \uXXXX.
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code < 0x7f) out += ch;
    else {
      // ensure_ascii: emit \uXXXX (surrogate pairs for astral).
      if (code > 0xffff) {
        const c = code - 0x10000;
        const hi = 0xd800 + (c >> 10);
        const lo = 0xdc00 + (c & 0x3ff);
        out += "\\u" + hi.toString(16).padStart(4, "0") + "\\u" + lo.toString(16).padStart(4, "0");
      } else {
        out += "\\u" + code.toString(16).padStart(4, "0");
      }
    }
  }
  return out + '"';
}

function ser(value, sortKeys, indent, depth) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return jsonString(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent) {
      const pad = " ".repeat(indent * (depth + 1));
      const closePad = " ".repeat(indent * depth);
      const items = value.map((v) => pad + ser(v, sortKeys, indent, depth + 1));
      return "[\n" + items.join(",\n") + "\n" + closePad + "]";
    }
    return "[" + value.map((v) => ser(v, sortKeys, indent, depth + 1)).join(", ") + "]";
  }
  // object
  let keys = Object.keys(value);
  if (sortKeys) keys = keys.sort();
  if (keys.length === 0) return "{}";
  if (indent) {
    const pad = " ".repeat(indent * (depth + 1));
    const closePad = " ".repeat(indent * depth);
    const items = keys.map((k) => pad + jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1));
    return "{\n" + items.join(",\n") + "\n" + closePad + "}";
  }
  const items = keys.map((k) => jsonString(k) + ": " + ser(value[k], sortKeys, indent, depth + 1));
  return "{" + items.join(", ") + "}";
}

function get(obj, key) {
  if (obj === null || typeof obj !== "object") return undefined;
  return obj[key];
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function nodeId(value) {
  let text = pyStrip(String(value)).replace(/[^A-Za-z0-9_]/g, "_");
  if (!text) {
    text = "node";
  }
  if (isDigit(text[0])) {
    text = `n_${text}`;
  }
  return text;
}

function esc(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function labelLines(item) {
  const lines = [get(item, "label") || get(item, "id")];
  for (const key of ["path", "status", "responsibility"]) {
    if (get(item, key)) lines.push(item[key]);
  }
  for (const value of get(item, "forbidden") || []) {
    lines.push(`forbidden: ${value}`);
  }
  return lines.filter((line) => line).map((line) => esc(line)).join("<br/>");
}

function renderItem(item, indent = 1) {
  const pad = "  ".repeat(indent);
  const itemKind = get(item, "kind");
  const children = get(item, "children");
  const ident = nodeId(get(item, "id") || get(item, "label"));
  const label = esc(get(item, "label") || get(item, "id") || ident);

  if (itemKind === "group" || (children !== undefined && children !== null)) {
    const lines = [`${pad}subgraph ${ident}["${label}"]`];
    for (const child of children || []) {
      lines.push(...renderItem(child, indent + 1));
    }
    lines.push(`${pad}end`);
    return lines;
  }

  return [`${pad}${ident}["${labelLines(item)}"]`];
}

function renderEdge(edge) {
  const left = nodeId(edge["from"]);
  const right = nodeId(edge["to"]);
  const label = get(edge, "label");
  const style = edge.style !== undefined ? edge.style : "solid";
  if (style === "dotted" || style === "later" || style === "future") {
    if (label) return `  ${left} -. "${esc(label)}" .-> ${right}`;
    return `  ${left} -.-> ${right}`;
  }
  if (label) return `  ${left} -->|"${esc(label)}"| ${right}`;
  return `  ${left} --> ${right}`;
}

function renderMermaid(inventory) {
  const direction = inventory.direction !== undefined ? inventory.direction : "TD";
  const lines = [`flowchart ${direction}`];
  const title = get(inventory, "title");
  if (title) lines.push(`  %% ${title}`);

  for (const group of get(inventory, "groups") || []) {
    lines.push(...renderItem(group));
  }
  for (const item of get(inventory, "nodes") || []) {
    lines.push(...renderItem(item));
  }

  const edges = get(inventory, "edges") || [];
  if (edges.length) lines.push("");
  for (const edge of edges) lines.push(renderEdge(edge));

  return lines.join("\n") + "\n";
}

function* iterItems(items) {
  for (const item of items) {
    yield item;
    yield* iterItems(get(item, "children") || []);
  }
}

function validateInventory(inventory) {
  const errors = [];
  if (inventory === null || typeof inventory !== "object" || Array.isArray(inventory)) {
    return ["inventory must be a JSON object"];
  }

  let groups = inventory.groups !== undefined ? inventory.groups : [];
  let nodes = inventory.nodes !== undefined ? inventory.nodes : [];
  let edges = inventory.edges !== undefined ? inventory.edges : [];

  if (!Array.isArray(groups)) {
    errors.push("groups must be a list when present");
    groups = [];
  }
  if (!Array.isArray(nodes)) {
    errors.push("nodes must be a list when present");
    nodes = [];
  }
  if (!Array.isArray(edges)) {
    errors.push("edges must be a list when present");
    edges = [];
  }

  const rawIds = new Map();
  const generatedIds = new Map();
  const allItems = [...iterItems(groups), ...iterItems(nodes)];
  for (const item of allItems) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push("each group/node item must be an object");
      continue;
    }
    const rawId = get(item, "id") || get(item, "label");
    if (!rawId) {
      errors.push("each group/node item must have id or label");
      continue;
    }
    const generated = nodeId(rawId);
    if (rawIds.has(rawId)) {
      errors.push(`duplicate id: ${rawId}`);
    }
    rawIds.set(rawId, item);
    if (generatedIds.has(generated) && generatedIds.get(generated) !== rawId) {
      errors.push(`node id collision after normalization: ${generatedIds.get(generated)} / ${rawId}`);
    }
    generatedIds.set(generated, rawId);
  }

  for (const edge of edges) {
    if (edge === null || typeof edge !== "object" || Array.isArray(edge)) {
      errors.push("each edge must be an object");
      continue;
    }
    if (!("from" in edge) || !("to" in edge)) {
      errors.push("each edge must have from and to");
      continue;
    }
    for (const field of ["from", "to"]) {
      const value = edge[field];
      if (!rawIds.has(value) && !generatedIds.has(nodeId(value))) {
        errors.push(`edge ${field} references unknown node: ${value}`);
      }
    }
  }

  return errors;
}

function copyViewer(viewerSrc, outDir) {
  if (!viewerSrc) return;
  if (fs.existsSync(viewerSrc)) {
    fs.copyFileSync(viewerSrc, path.join(outDir, "index.html"));
  }
}

function main() {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        inventory: { type: "string" },
        "out-dir": { type: "string", default: "dist" },
        name: { type: "string", default: "latest" },
        stdout: { type: "boolean" },
        "validate-only": { type: "boolean" },
        viewer: { type: "string", default: process.env.PACKAGE_ARCHITECTURE_MAP_VIEWER || "" },
      },
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }

  const inventoryPos = positionals.length ? positionals[0] : undefined;
  const inventoryPath = values.inventory || inventoryPos;
  if (!inventoryPath) {
    process.stderr.write("error: inventory JSON path is required\n");
    process.exit(2);
  }

  const raw = fs.readFileSync(inventoryPath, { encoding: "utf-8" });
  const inventory = JSON.parse(raw);

  const errors = validateInventory(inventory);
  if (values["validate-only"]) {
    const result = {
      kind: "packageArchitectureMap.validation.v1",
      ok: errors.length === 0,
      errors,
      source: String(inventoryPath),
    };
    const text = pyJson(result, true) + "\n";
    if (errors.length === 0) process.stdout.write(text);
    else process.stderr.write(text);
    process.exit(errors.length === 0 ? 0 : 2);
  }
  if (errors.length) {
    process.stderr.write(
      pyJson(
        {
          kind: "packageArchitectureMap.validation.v1",
          ok: false,
          errors,
          source: String(inventoryPath),
        },
        true,
      ) + "\n",
    );
    process.exit(2);
  }

  const mermaid = renderMermaid(inventory);
  if (values.stdout) {
    process.stdout.write(mermaid);
    return;
  }

  const outDir = values["out-dir"];
  const mapsDir = path.join(outDir, "maps");
  fs.mkdirSync(mapsDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "latest.mmd"), mermaid, { encoding: "utf-8" });
  fs.writeFileSync(path.join(mapsDir, `${values.name}.mmd`), mermaid, { encoding: "utf-8" });
  copyViewer(values.viewer, outDir);

  const indexExists = fs.existsSync(path.join(outDir, "index.html"));
  const manifest = {
    kind: "packageArchitectureMap.result.v1",
    source: String(inventoryPath),
    latest: path.join(outDir, "latest.mmd"),
    named: path.join(mapsDir, `${values.name}.mmd`),
    viewer: indexExists ? path.join(outDir, "index.html") : null,
    authority: "inventory-json",
    generatedIsAuthority: false,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), pyJson(manifest, false, 2) + "\n", {
    encoding: "utf-8",
  });
  process.stdout.write(pyJson(manifest, true) + "\n");
}

main();
