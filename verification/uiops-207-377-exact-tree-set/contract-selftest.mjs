#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATE_ID,
  INPUT_SCHEMA,
  RECEIPT_BASENAME,
  RECEIPT_SCHEMA,
  assertExternalFreshWorkRoot,
  parseCli,
  validateGateInput,
} from "./contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha = (digit) => digit.repeat(40);
const digest = (digit) => `sha256:${digit.repeat(64)}`;
const valid = {
  schema: INPUT_SCHEMA,
  gate: GATE_ID,
  mobileAgent: {
    repository: "roccho-dev/mobile-agent",
    head: sha("1"),
    tree: sha("2"),
    checkIdentity: "mobile-agent/check@1",
  },
  ops: {
    repository: "roccho-dev/ops",
    pr: 378,
    base: sha("3"),
    head: sha("4"),
    tree: sha("5"),
    checkIdentity: "ops/nix-check/run/job/attempt@head",
    consumerReceiptDigest: digest("6"),
    policyAppContract: "ops-policy-app/1",
  },
  ui: {
    repository: "roccho-dev/ui",
    pr: 211,
    base: sha("7"),
    head: sha("8"),
    tree: sha("9"),
    artifactDigest: digest("a"),
    checkIdentity: "ui/publication/run/job/attempt@head",
    corePortContract: "semantic-map-editor-core-port/1",
    adapterContract: "semantic-map-maxgraph-adapter/1",
  },
  verifiers: {
    gate: {
      repository: "roccho-dev/ops",
      head: sha("4"),
      path: "verification/uiops-207-377-exact-tree-set/verify.mjs",
      blob: sha("b"),
    },
    presentationSharedVisual: {
      repository: "roccho-dev/ops",
      head: sha("4"),
      path: "verification/presentation-shared-visual/verify.mjs",
      blob: sha("c"),
    },
  },
};

assert.deepEqual(validateGateInput(structuredClone(valid)), valid);
assert.throws(() => validateGateInput({ ...valid, gate: "other/1" }), /gate id mismatch/u);
assert.throws(() => validateGateInput({
  ...valid,
  mobileAgent: { ...valid.mobileAgent, shadow: true },
}), /mobileAgent fields changed/u);
assert.throws(() => validateGateInput({ ...valid, ui: { ...valid.ui, artifactDigest: "bad" } }), /sha256 digest/u);
assert.throws(() => validateGateInput({ ...valid, ops: { ...valid.ops, pr: 0 } }), /positive integer/u);
assert.throws(() => validateGateInput({ ...valid, verifiers: { gate: valid.verifiers.gate } }), /fields changed/u);

const cli = parseCli([
  "--input", "/tmp/input.json",
  "--mobile-agent-root", "/tmp/mobile-agent",
  "--ops-receipt", "/tmp/ops-receipt.json",
  "--ops-root", "/tmp/ops",
  "--ui-artifact", "/tmp/ui-artifact.tar",
  "--ui-root", "/tmp/ui",
  "--work-root", "/tmp/uiops-gate-work",
]);
assert.equal(cli.input, "/tmp/input.json");
assert.equal(cli.workRoot, "/tmp/uiops-gate-work");
assert.throws(() => parseCli([]), /missing CLI option/u);
assert.throws(() => parseCli(["--input", "/tmp/input.json", "--unknown", "x"]), /unknown CLI option/u);
assert.throws(() => parseCli([
  "--input", "/tmp/a", "--input", "/tmp/b",
  "--mobile-agent-root", "/tmp/m", "--ops-receipt", "/tmp/r",
  "--ops-root", "/tmp/o", "--ui-artifact", "/tmp/a", "--ui-root", "/tmp/u", "--work-root", "/tmp/w",
]), /duplicate CLI option/u);
assert.throws(() => assertExternalFreshWorkRoot("/tmp/ops/work", { ops: "/tmp/ops" }), /outside ops repository/u);
assert.doesNotThrow(() => assertExternalFreshWorkRoot("/tmp/work", { ops: "/tmp/ops", ui: "/tmp/ui" }));

const gateSource = readFileSync(join(here, "verify.mjs"), "utf8");
assert.match(gateSource, /gate runner must execute from the exact OPS checkout/u);
assert.match(gateSource, /executed gate runner bytes differ from the exact OPS blob/u);
assert.match(gateSource, /repository identity changed during proof/u);
assert.match(gateSource, /receiptSha256/u);
for (const source of [
  join(here, "verify.mjs"),
  join(here, "..", "presentation-shared-visual", "verify.mjs"),
]) {
  const text = readFileSync(source, "utf8");
  assert.doesNotMatch(text, /\brmSync\b|rm\s+-rf|recursive\s*:\s*true/u, `${source} contains recursive cleanup`);
}

process.stdout.write(`${JSON.stringify({
  kind: "uiops.exactTreeSetContractSelftest.v1",
  gate: GATE_ID,
  inputSchema: INPUT_SCHEMA,
  receiptSchema: RECEIPT_SCHEMA,
  receiptBasename: RECEIPT_BASENAME,
  status: "PASS",
})}\n`);
