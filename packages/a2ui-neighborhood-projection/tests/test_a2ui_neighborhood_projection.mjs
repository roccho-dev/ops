import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "a2ui-neighborhood-projection-"));
const sample = join(dir, "sample.raw.jsonl");
const out = join(dir, "surface.json");

writeFileSync(sample, [
  { recordKind: "context.namespace.v1", symbol: "CEO", roleId: "role.cxo.base", modelingMutable: true },
  { recordKind: "context.roleBinding.v1", roleId: "role.cxo.base", policies: ["policy.selector.cxo-adr-intake", "policy.selector.role-resolution"] },
  { recordKind: "context.current.v1", nodeId: "purpose:company-sale" },
  { recordKind: "context.node.v1", id: "purpose:company-sale", kind: "purpose", label: "Company sale", namespace: "CEO" },
  { recordKind: "context.node.v1", id: "policy:role-resolution", kind: "policy", label: "Role resolution" },
  { recordKind: "context.node.v1", id: "evidence:valuation-story", kind: "evidence", label: "Valuation story" },
  { recordKind: "context.node.v1", id: "blocker:missing-context-package", kind: "blocker", label: "Missing context package" },
  { recordKind: "context.node.v1", id: "action:emit-a2ui-neighborhood", kind: "nextAction", label: "Emit A2UI neighborhood" },
  { recordKind: "context.node.v1", id: "role:cfo", kind: "role", label: "CFO" },
  { recordKind: "context.edge.v1", source: "policy:role-resolution", target: "purpose:company-sale", kind: "governs" },
  { recordKind: "context.edge.v1", source: "purpose:company-sale", target: "evidence:valuation-story", kind: "requires" },
  { recordKind: "context.edge.v1", source: "blocker:missing-context-package", target: "purpose:company-sale", kind: "blocks" },
  { recordKind: "context.edge.v1", source: "purpose:company-sale", target: "action:emit-a2ui-neighborhood", kind: "nextAction" },
  { recordKind: "context.edge.v1", source: "purpose:company-sale", target: "role:cfo", kind: "sameContext" },
].map((row) => JSON.stringify(row)).join("\n") + "\n");

execFileSync("a2ui-neighborhood-projection", ["--raw", sample, "--out", out], {
  stdio: "inherit",
});

const surface = JSON.parse(readFileSync(out, "utf8"));

assert.equal(surface.kind, "a2ui.context.surface.v1");
assert.equal(surface.current.id, "purpose:company-sale");
assert.equal(surface.namespace.symbol, "CEO");
assert.equal(surface.namespace.modelingMutable, true);
assert.equal(surface.role.roleId, "role.cxo.base");
assert.ok(surface.role.policies.includes("policy.selector.role-resolution"));
assert.equal(surface.neighborhood.up.length, 1);
assert.equal(surface.neighborhood.down.length, 1);
assert.equal(surface.neighborhood.left.length, 1);
assert.equal(surface.neighborhood.right.length, 1);
assert.equal(surface.neighborhood.around.length, 1);
assert.equal(surface.authorityBoundary.rawIsAuthority, false);
assert.equal(surface.authorityBoundary.browserGraphIsAuthority, false);
assert.equal(surface.authorityBoundary.webmcpIsAuthority, false);
assert.equal(surface.authorityBoundary.a2uiIsAuthority, false);

console.log(JSON.stringify({
  ok: true,
  kind: surface.kind,
  current: surface.current.id,
  role: surface.role.roleId,
  up: surface.neighborhood.up.length,
  down: surface.neighborhood.down.length,
  left: surface.neighborhood.left.length,
  right: surface.neighborhood.right.length,
  around: surface.neighborhood.around.length,
}));
