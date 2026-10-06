import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { main as runtimeMain } from "../../voice-ui-target-runtime/entry.mjs";
import {
  NATIVE_DEPLOY_SETTINGS, PROJECTION_REQUIREMENTS,
  projectRequirements, validateProjectionReceipt,
} from "../../voice-ui-target-runtime/modules/input-contracts.mjs";

// This scope/target is a finite fixture, not an accepted production obligation.
const revision = "a".repeat(40);
const target = { provider: "cloudflare-workers", accountId: "a".repeat(32), workerName: "voice-ui",
  url: "https://voice-ui.fixture.workers.dev/", nativeDeploySettings: NATIVE_DEPLOY_SETTINGS };
const obligation = { id: "fixture.voice-ui-jev", obligation_digest: `sha256:${"b".repeat(64)}`, binding: "jev-api" };
const normalize = value => Array.isArray(value) ? value.map(normalize)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])])) : value;
const canonical = value => JSON.stringify(normalize(value));
const digest = value => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const rowDigest = rows => digest([...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
let checks = 0;
function check(name, fn) { fn(); checks++; process.stdout.write(`PASS ${name}\n`); }

const required = projectRequirements(target, obligation, revision);
check("R comes from actual enforced runtime values", () => {
  const c = required.rows[0].contract, spec = PROJECTION_REQUIREMENTS;
  assert.deepEqual([c.capability, c.stage, c.slot, c.target.provider, c.profile[0].operation],
    [spec.capability, spec.stage, spec.slot, spec.provider, spec.operation]);
  assert.equal(c.profile[0].grade, "real");
  assert.equal(c.profile[0].readback, true);
  assert.equal(required.rows[0].id, obligation.id);
});
check("R does not invent identity or accept a mutable revision", () => {
  assert.throws(() => projectRequirements(target, { ...obligation, id: undefined }, revision));
  assert.throws(() => projectRequirements(target, obligation, "proposals"));
  assert.throws(() => projectRequirements(target, { ...obligation, profile: [] }, revision));
});
check("R rejects another target or a credential-bearing selector", () => {
  assert.throws(() => projectRequirements({ ...target, provider: "cloudflare-pages" }, obligation, revision));
  assert.throws(() => projectRequirements(target, { ...obligation, secret_value: "CANARY" }, revision));
});
check("R refuses target identifiers with the wrong type", () => {
  assert.throws(() => projectRequirements({ ...target, accountId: 111 }, obligation, revision));
  assert.throws(() => projectRequirements({ ...target, workerName: 123 }, obligation, revision));
});
check("R is reproducible and does not change its caller's inputs", () => {
  const before = canonical({ target, obligation });
  assert.equal(canonical(required), canonical(projectRequirements(target, obligation, revision)));
  assert.equal(canonical({ target, obligation }), before);
});

const spec = PROJECTION_REQUIREMENTS;
const receipt = { kind: spec.kind, status: "PASS", envs_sha: revision, environment: spec.stage, capability: spec.capability,
  source: { kind: spec.sourceKind, ref: "ciphertexts/fixture.sops.yaml", sha256: "b".repeat(64) },
  target: { provider: spec.provider, account_id: target.accountId, worker_name: target.workerName, secret_name: spec.slot },
  projector: { workflow: ".github/workflows/fixture.yml", adapter: "adapters/fixture.py" },
  effect: { operation: spec.operation, status: "PASS" }, readback: { kind: spec.readbackKind, status: "PASS", present: true },
  workflow: { repository: "roccho-dev/envs", ref: "proposals", run_id: 1, run_attempt: 1 }, created_at: "2026-10-06T00:00:00Z" };
check("same owner values remain enforced by the existing receipt validator", () => {
  assert.equal(validateProjectionReceipt(receipt, revision), receipt);
});
for (const keys of [["kind"], ["environment"], ["capability"], ["source", "kind"],
  ["target", "provider"], ["target", "secret_name"], ["effect", "operation"], ["readback", "kind"]]) {
  check(`receipt refuses changed ${keys.join(".")}`, () => {
    const copy = structuredClone(receipt); let at = copy;
    for (const key of keys.slice(0, -1)) at = at[key];
    at[keys.at(-1)] = "different";
    assert.throws(() => validateProjectionReceipt(copy, revision));
  });
}

// This JSON is output from envs PR48's actual public projection at the recorded
// source. It is frozen test data, never a current-provider or trusted receipt.
const provided = JSON.parse(readFileSync(new URL("./fixtures/envs-pages-provision.json", import.meta.url), "utf8"));
const source = label => ({ repository: "fixture/scope", revision, path: label, digest: digest(label) });
const packet = { kind: "contractDiffInput.v1", required, provided,
  observations: { source: source("observations"), rows: [] }, receipts: { source: source("receipts"), rows: [] } };
const admission = { kind: "contractDiffAdmission.v1",
  scope: { id: "fixture.voice-ui", authority: source("authority"), epoch: "fixture-epoch", allow_empty: false, grade: "fixture", excluded_ids: [] },
  universe: [{ id: obligation.id, obligation_digest: obligation.obligation_digest, profile: required.rows[0].contract.profile }],
  inventory: {}, evidence: {} };
function admitFixture() {
  admission.inventory = Object.fromEntries(["required", "provided", "observations", "receipts"].map(k =>
    [k, { source: packet[k].source, count: packet[k].rows.length, rows_digest: rowDigest(packet[k].rows) }]));
}
const scratch = mkdtempSync(path.join(tmpdir(), "contract-diff-source-test-"));
try {
  check("ordinary runtime entry generates R without reading effect configuration", () => {
    const selected = path.join(scratch, "selected.json");
    writeFileSync(selected, JSON.stringify({ target, obligation }));
    const config = new Proxy({ opsSha: revision }, { get(value, key) {
      assert.equal(key, "opsSha", "requirement mode must not access effect configuration");
      return value[key];
    } });
    let output = "";
    const write = process.stdout.write;
    try {
      process.stdout.write = chunk => { output += chunk; return true; };
      runtimeMain(config, path.join(scratch, "no-runtime-assets"), ["--requirements", selected]);
    } finally { process.stdout.write = write; }
    assert.deepEqual(JSON.parse(output), required);
    writeFileSync(selected, JSON.stringify({ target, obligation, opsSha: "b".repeat(40) }));
    assert.throws(() => runtimeMain(config, scratch, ["--requirements", selected]));
  });
  const input = path.join(scratch, "input.json"), accepted = path.join(scratch, "admission.json");
  function run() {
    writeFileSync(input, canonical(packet)); writeFileSync(accepted, canonical(admission));
    const result = spawnSync("contract-diff", ["--input", input, "--admission", accepted], {
      cwd: scratch, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    return { ...result, value: JSON.parse(result.stdout) };
  }
  admitFixture();
  check("actual generated Workers R + envs Pages P -> target drift AND missing required evidence", () => {
    const result = run(); assert.equal(result.status, 2); assert.equal(result.value.authority, false);
    assert.equal(result.value.grade, "fixture");
    assert.deepEqual(result.value.findings.map(f => [f.kind, f.field]),
      [["EVIDENCE_MISSING", "observation"], ["CONTRACT_DRIFT", "target"]]);
    assert.equal(result.value.coverage.required, 1); assert.equal(result.value.coverage.provided, 1);
  });
  check("two fresh CLI processes produce the same bytes", () => assert.equal(run().stdout, run().stdout));
  check("changing the declaration alone does not fake real evidence", () => {
    packet.provided.rows[0].contract.target = structuredClone(required.rows[0].contract.target); admitFixture();
    const result = run(); assert.equal(result.status, 2);
    assert.deepEqual(result.value.findings.map(f => f.kind), ["EVIDENCE_MISSING"]);
  });
  check("hand-edited projection without matching acquisition is UNKNOWN", () => {
    packet.provided.rows[0].contract.stage = "prod";
    assert.equal(run().status, 4);
  });
} finally { rmSync(scratch, { recursive: true, force: true }); }
process.stdout.write(`source integration: ${checks} checks PASS; fixture authority only; live effects 0\n`);
