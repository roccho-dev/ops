import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildConvergenceReceipt, digest, targetClasses } from "../lib/home-convergence.mjs";

const OPS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ENVS = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FLAKES = "cccccccccccccccccccccccccccccccccccccccc";
const NIXPKGS = "dddddddddddddddddddddddddddddddddddddddd";
const TARGET_SET = digest({ kind: "envs.targetSet.v1", targets: targetClasses() });
const WRAPPER = digest({ kind: "private-wrapper", targetSet: TARGET_SET });
const phase = (name) => ({ status: "pass", evidence_digest: digest({ phase: name }) });

const externalIdentity = (packageId, repository, revision, output) => {
  const payload = {
    kind: "envs.externalPackageIdentity.v1",
    package_id: packageId,
    producer_repository: repository,
    producer_exact_revision: revision,
    producer_output: output,
  };
  return { ...payload, identity: digest(payload) };
};

const projectionChange = (targetClass) => ({
  action: "ensure-present",
  architecture: "x86_64",
  binding_id: `${targetClass}.projection`,
  binding_kind: "target-projection",
  changed: true,
  dependency_ids: [],
  dependency_order: 0,
  ensure: "present",
  platform: "linux",
  producer_exact_revision: ENVS,
  producer_output: `modules.${targetClass}`,
  producer_repository: "roccho-dev/envs",
  resource_identity: {
    kind: "envs.targetProjectionIdentity.v1",
    identity: digest({ targetClass, projection: true }),
  },
  scope: targetClass === "wsl-user" ? "user" : "os",
  target_class: targetClass,
});

const packageChange = (targetClass, repository, revision, output, packageId) => ({
  action: "ensure-present",
  architecture: "x86_64",
  binding_id: `${targetClass}.package.${packageId}`,
  binding_kind: "package",
  binding_proof: "exact-external-output",
  changed: true,
  dependency_ids: [`${targetClass}.projection`],
  dependency_order: 1,
  ensure: "present",
  platform: "linux",
  producer_exact_revision: revision,
  producer_output: output,
  producer_repository: repository,
  resource_identity: externalIdentity(packageId, repository, revision, output),
  scope: "user",
  target_class: targetClass,
});

const request = (targetClass, extra) => {
  const changes = [projectionChange(targetClass), extra];
  const payload = {
    kind: "envs.opsRequestedState.v1",
    desired_state_id: `home-retirement.${targetClass}.v1`,
    desired_state_digest: digest({ targetClass, desired: true }),
    projection_identity: digest({ targetClass, projection: true }),
    plan_digest: digest({ targetClass, plan: true }),
    target_class: targetClass,
    platform: "linux",
    architecture: "x86_64",
    requested_state_receipt_schema: "envs.requestedStateReceipt.v1",
    changes,
    change_count: changes.length,
  };
  return { ...payload, request_identity: digest(payload) };
};

const resultFor = (req) => {
  const targetClass = req.target_class;
  const payload = {
    kind: "ops.homeTargetConvergenceResult.v1",
    target_class: targetClass,
    opaque_target_id: `opaque-${targetClass}`,
    exact_ops_revision: OPS,
    exact_envs_revision: ENVS,
    exact_flakes_revision: FLAKES,
    target_set_digest: TARGET_SET,
    wrapper_digest: WRAPPER,
    pre_effect_plan_digest: req.plan_digest,
    request_identity: req.request_identity,
    prepare: phase(`${targetClass}:prepare`),
    apply: phase(`${targetClass}:apply`),
    native_observe: phase(`${targetClass}:observe`),
    expected_state_match: phase(`${targetClass}:match`),
    second_apply: phase(`${targetClass}:second-apply`),
    second_apply_change_count: 0,
    failure_observed: phase(`${targetClass}:failure`),
    rollback: phase(`${targetClass}:rollback`),
    post_rollback_observe: phase(`${targetClass}:post-rollback-observe`),
    post_rollback_safe_state_match: phase(`${targetClass}:safe-state`),
    home_reference_count: 0,
    ambient_path_dependency_count: 0,
    raw_secret_output_count: 0,
    unclassified_effect_count: 0,
  };
  return { ...payload, result_identity: digest(payload) };
};

const makeInputs = () => {
  const requests = [
    request(
      "linux-vm-system-user",
      packageChange(
        "linux-vm-system-user",
        "roccho-dev/flakes",
        FLAKES,
        "packages.x86_64-linux.codex-cli",
        "codex-cli",
      ),
    ),
    request(
      "wsl-system",
      packageChange("wsl-system", "NixOS/nixpkgs", NIXPKGS, "legacyPackages.x86_64-linux.git", "git"),
    ),
    request(
      "wsl-user",
      packageChange("wsl-user", "NixOS/nixpkgs", NIXPKGS, "legacyPackages.x86_64-linux.git", "git"),
    ),
  ];
  const wrapperPayload = {
    kind: "ops.homePrivateWrapperReceipt.v1",
    exact_envs_revision: ENVS,
    exact_flakes_revision: FLAKES,
    target_set_digest: TARGET_SET,
    targets: targetClasses(),
    wrapper_digest: WRAPPER,
    private_evidence_digest: digest({ evidence: "private-wrapper" }),
    status: "pass",
  };
  return {
    exactOpsRevision: OPS,
    exactEnvsRevision: ENVS,
    exactFlakesRevision: FLAKES,
    targetSetDigest: TARGET_SET,
    requests,
    wrapperReceipt: { ...wrapperPayload, receipt_identity: digest(wrapperPayload) },
    targetResults: Object.fromEntries(requests.map((req) => [req.target_class, resultFor(req)])),
    sourceAudit: {
      status: "pass",
      evidence_digest: digest({ evidence: "source-audit" }),
      desired_state_redefined_in_ops: 0,
      product_package_duplicates: 0,
      raw_secret_schema_fields: 0,
      unclassified_effects: 0,
    },
    independentReview: {
      status: "pass",
      evidence_digest: digest({ evidence: "independent-review" }),
    },
  };
};

const resign = (value, identityField) => {
  const payload = { ...value };
  delete payload[identityField];
  value[identityField] = digest(payload);
};

const expectCode = (mutate, code) => {
  const input = makeInputs();
  mutate(input);
  assert.throws(
    () => buildConvergenceReceipt(input),
    (error) => error?.code === code,
    `expected ${code}`,
  );
};

const valid = makeInputs();
const receipt = buildConvergenceReceipt(valid);
assert.equal(receipt.kind, "OPS_HOMELESS_CONVERGENCE_001");
assert.equal(receipt.verdict, "PASS");
assert.equal(receipt.required_target_classes_unproven, 0);
assert.equal(receipt.per_target_results.length, 3);
assert.match(receipt.receipt_identity, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(buildConvergenceReceipt({ ...valid, requests: [...valid.requests].reverse() }), receipt);

expectCode((input) => input.requests.pop(), "invalid-request-count");
expectCode((input) => {
  input.requests[2].target_class = "wsl-system";
  resign(input.requests[2], "request_identity");
}, "duplicate-target");
expectCode((input) => {
  input.requests[0].changes[0].producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  resign(input.requests[0], "request_identity");
}, "stale-envs-revision");
expectCode((input) => {
  const change = input.requests[0].changes[1];
  change.producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  change.resource_identity.producer_exact_revision = change.producer_exact_revision;
  resign(change.resource_identity, "identity");
  resign(input.requests[0], "request_identity");
}, "stale-flakes-revision");
expectCode((input) => {
  const change = input.requests[1].changes[1];
  change.producer_repository = "roccho-dev/home";
  change.resource_identity.producer_repository = change.producer_repository;
  resign(change.resource_identity, "identity");
  resign(input.requests[1], "request_identity");
}, "home-producer-reference");
expectCode((input) => {
  input.requests[0].request_identity = digest("wrong-request");
}, "request-digest-mismatch");
expectCode((input) => {
  input.requests[0].changes[0].unexpected = true;
  resign(input.requests[0], "request_identity");
}, "invalid-fields");
expectCode((input) => {
  input.wrapperReceipt.status = "blocked";
  resign(input.wrapperReceipt, "receipt_identity");
}, "wrapper-not-pass");
expectCode((input) => {
  input.wrapperReceipt.target_set_digest = digest("wrong-target-set");
  resign(input.wrapperReceipt, "receipt_identity");
}, "target-set-mismatch");
expectCode((input) => {
  const result = input.targetResults["wsl-system"];
  result.second_apply_change_count = 1;
  resign(result, "result_identity");
}, "second-apply-changed");
expectCode((input) => {
  const result = input.targetResults["wsl-system"];
  result.rollback.status = "fail";
  resign(result, "result_identity");
}, "phase-failed");
expectCode((input) => {
  const result = input.targetResults["wsl-user"];
  result.home_reference_count = 1;
  resign(result, "result_identity");
}, "home-reference-present");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.ambient_path_dependency_count = 1;
  resign(result, "result_identity");
}, "ambient-path-dependency");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.raw_secret_output_count = 1;
  resign(result, "result_identity");
}, "raw-secret-output");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.unclassified_effect_count = 1;
  resign(result, "result_identity");
}, "unclassified-effect");
expectCode((input) => {
  input.sourceAudit.desired_state_redefined_in_ops = 1;
}, "source-audit-counter");
expectCode((input) => {
  input.independentReview.status = "not-run";
}, "review-not-pass");
expectCode((input) => {
  input.targetResults["wsl-user"].opaque_target_id = input.targetResults["wsl-system"].opaque_target_id;
  resign(input.targetResults["wsl-user"], "result_identity");
}, "duplicate-opaque-target");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-convergence-"));
try {
  for (const [name, value] of Object.entries({
    requests: valid.requests,
    wrapper: valid.wrapperReceipt,
    results: valid.targetResults,
    audit: valid.sourceAudit,
    review: valid.independentReview,
  })) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));
  }
  const run = spawnSync("home-convergence", [
    "--requests", path.join(dir, "requests.json"),
    "--wrapper", path.join(dir, "wrapper.json"),
    "--results", path.join(dir, "results.json"),
    "--source-audit", path.join(dir, "audit.json"),
    "--review", path.join(dir, "review.json"),
    "--ops-revision", OPS,
    "--envs-revision", ENVS,
    "--flakes-revision", FLAKES,
    "--target-set-digest", TARGET_SET,
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).receipt_identity, receipt.receipt_identity);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("home convergence contract and destructive fixtures: PASS");
