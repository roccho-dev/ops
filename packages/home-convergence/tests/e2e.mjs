import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildConvergenceReceipt,
  digest,
  targetClasses,
} from "../lib/home-convergence.mjs";

const OPS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ENVS = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FLAKES = "cccccccccccccccccccccccccccccccccccccccc";
const NIXPKGS = "dddddddddddddddddddddddddddddddddddddddd";
const TARGET_SET = digest({ kind: "envs.targetSet.v1", targets: targetClasses() });
const WRAPPER_DIGEST = digest({ kind: "private-wrapper", targetSet: TARGET_SET });

const clone = (value) => structuredClone(value);
const phase = (name) => ({ status: "pass", evidence_digest: digest({ phase: name }) });

const externalIdentity = ({ packageId, repository, revision, output }) => {
  const payload = {
    kind: "envs.externalPackageIdentity.v1",
    package_id: packageId,
    producer_repository: repository,
    producer_exact_revision: revision,
    producer_output: output,
  };
  return { ...payload, identity: digest(payload) };
};

const projectionChange = (targetClass, index = 0) => ({
  kind: undefined,
  action: "ensure-present",
  architecture: "x86_64",
  binding_id: `${targetClass}.projection.${index}`,
  binding_kind: "target-projection",
  changed: true,
  dependency_ids: [],
  dependency_order: index,
  ensure: "present",
  platform: "linux",
  producer_exact_revision: ENVS,
  producer_output: `modules.${targetClass}`,
  producer_repository: "roccho-dev/envs",
  resource_identity: {
    kind: "envs.targetProjectionIdentity.v1",
    identity: digest({ targetClass, index }),
  },
  scope: targetClass === "wsl-user" ? "user" : "os",
  target_class: targetClass,
});

const packageChange = (targetClass, index = 1) => ({
  action: "ensure-present",
  architecture: "x86_64",
  binding_id: `${targetClass}.package.codex-cli`,
  binding_kind: "package",
  binding_proof: "exact-external-output",
  changed: true,
  dependency_ids: [`${targetClass}.projection.0`],
  dependency_order: index,
  ensure: "present",
  platform: "linux",
  producer_exact_revision: FLAKES,
  producer_output: "packages.x86_64-linux.codex-cli",
  producer_repository: "roccho-dev/flakes",
  resource_identity: externalIdentity({
    packageId: "codex-cli",
    repository: "roccho-dev/flakes",
    revision: FLAKES,
    output: "packages.x86_64-linux.codex-cli",
  }),
  scope: "user",
  target_class: targetClass,
});

const nixpkgsChange = (targetClass, index = 1) => ({
  action: "ensure-present",
  architecture: "x86_64",
  binding_id: `${targetClass}.package.git`,
  binding_kind: "package",
  binding_proof: "exact-external-output",
  changed: true,
  dependency_ids: [`${targetClass}.projection.0`],
  dependency_order: index,
  ensure: "present",
  platform: "linux",
  producer_exact_revision: NIXPKGS,
  producer_output: "legacyPackages.x86_64-linux.git",
  producer_repository: "NixOS/nixpkgs",
  resource_identity: externalIdentity({
    packageId: "git",
    repository: "NixOS/nixpkgs",
    revision: NIXPKGS,
    output: "legacyPackages.x86_64-linux.git",
  }),
  scope: targetClass === "wsl-user" ? "user" : "os",
  target_class: targetClass,
});

const makeRequest = (targetClass, changes) => {
  const payload = {
    kind: "envs.opsRequestedState.v1",
    desired_state_id: `home-retirement.${targetClass}.v1`,
    desired_state_digest: digest({ targetClass, type: "desired" }),
    projection_identity: digest({ targetClass, type: "projection" }),
    plan_digest: digest({ targetClass, type: "plan" }),
    target_class: targetClass,
    platform: "linux",
    architecture: "x86_64",
    requested_state_receipt_schema: "envs.requestedStateReceipt.v1",
    changes,
    change_count: changes.length,
  };
  return { ...payload, request_identity: digest(payload) };
};

const makeInputs = () => {
  const requests = [
    makeRequest("linux-vm-system-user", [
      projectionChange("linux-vm-system-user"),
      packageChange("linux-vm-system-user"),
    ]),
    makeRequest("wsl-system", [projectionChange("wsl-system"), nixpkgsChange("wsl-system")]),
    makeRequest("wsl-user", [projectionChange("wsl-user"), nixpkgsChange("wsl-user")]),
  ];

  const wrapperPayload = {
    kind: "ops.homePrivateWrapperReceipt.v1",
    exact_envs_revision: ENVS,
    exact_flakes_revision: FLAKES,
    target_set_digest: TARGET_SET,
    targets: targetClasses(),
    wrapper_digest: WRAPPER_DIGEST,
    private_evidence_digest: digest({ evidence: "private-wrapper" }),
    status: "pass",
  };
  const wrapperReceipt = { ...wrapperPayload, receipt_identity: digest(wrapperPayload) };

  const targetResults = Object.fromEntries(
    requests.map((request) => {
      const targetClass = request.target_class;
      const payload = {
        kind: "ops.homeTargetConvergenceResult.v1",
        target_class: targetClass,
        opaque_target_id: `opaque-${targetClass}`,
        exact_ops_revision: OPS,
        exact_envs_revision: ENVS,
        exact_flakes_revision: FLAKES,
        target_set_digest: TARGET_SET,
        wrapper_digest: WRAPPER_DIGEST,
        pre_effect_plan_digest: request.plan_digest,
        request_identity: request.request_identity,
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
      return [targetClass, { ...payload, result_identity: digest(payload) }];
    }),
  );

  return {
    exactOpsRevision: OPS,
    exactEnvsRevision: ENVS,
    exactFlakesRevision: FLAKES,
    targetSetDigest: TARGET_SET,
    requests,
    wrapperReceipt,
    targetResults,
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

const resignRequest = (request) => {
  const payload = { ...request };
  delete payload.request_identity;
  request.request_identity = digest(payload);
};

const resignWrapper = (wrapperReceipt) => {
  const payload = { ...wrapperReceipt };
  delete payload.receipt_identity;
  wrapperReceipt.receipt_identity = digest(payload);
};

const resignResult = (result) => {
  const payload = { ...result };
  delete payload.result_identity;
  result.result_identity = digest(payload);
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
assert.deepEqual(
  buildConvergenceReceipt({ ...valid, requests: [...valid.requests].reverse() }),
  receipt,
  "request order must not alter the public receipt",
);

expectCode((input) => input.requests.pop(), "invalid-request-count");
expectCode((input) => {
  input.requests[2].target_class = "wsl-system";
  resignRequest(input.requests[2]);
}, "duplicate-target");
expectCode((input) => {
  input.requests[0].changes[0].producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  resignRequest(input.requests[0]);
}, "stale-envs-revision");
expectCode((input) => {
  input.requests[0].changes[1].producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  input.requests[0].changes[1].resource_identity.producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const resource = input.requests[0].changes[1].resource_identity;
  const resourcePayload = { ...resource };
  delete resourcePayload.identity;
  resource.identity = digest(resourcePayload);
  resignRequest(input.requests[0]);
}, "stale-flakes-revision");
expectCode((input) => {
  input.requests[1].changes[1].producer_repository = "roccho-dev/home";
  input.requests[1].changes[1].resource_identity.producer_repository = "roccho-dev/home";
  const resource = input.requests[1].changes[1].resource_identity;
  const resourcePayload = { ...resource };
  delete resourcePayload.identity;
  resource.identity = digest(resourcePayload);
  resignRequest(input.requests[1]);
}, "home-producer-reference");
expectCode((input) => {
  input.requests[0].request_identity = digest("wrong-request");
}, "request-digest-mismatch");
expectCode((input) => {
  input.requests[0].changes[0].unexpected = true;
  resignRequest(input.requests[0]);
}, "invalid-fields");
expectCode((input) => {
  input.wrapperReceipt.status = "blocked";
  resignWrapper(input.wrapperReceipt);
}, "wrapper-not-pass");
expectCode((input) => {
  input.wrapperReceipt.target_set_digest = digest("wrong-target-set");
  resignWrapper(input.wrapperReceipt);
}, "target-set-mismatch");
expectCode((input) => {
  const result = input.targetResults["wsl-system"];
  result.second_apply_change_count = 1;
  resignResult(result);
}, "second-apply-changed");
expectCode((input) => {
  const result = input.targetResults["wsl-system"];
  result.rollback.status = "fail";
  resignResult(result);
}, "phase-failed");
expectCode((input) => {
  const result = input.targetResults["wsl-user"];
  result.home_reference_count = 1;
  resignResult(result);
}, "home-reference-present");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.ambient_path_dependency_count = 1;
  resignResult(result);
}, "ambient-path-dependency");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.raw_secret_output_count = 1;
  resignResult(result);
}, "raw-secret-output");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.unclassified_effect_count = 1;
  resignResult(result);
}, "unclassified-effect");
expectCode((input) => {
  input.sourceAudit.desired_state_redefined_in_ops = 1;
}, "source-audit-counter");
expectCode((input) => {
  input.independentReview.status = "not-run";
}, "review-not-pass");
expectCode((input) => {
  input.targetResults["wsl-user"].opaque_target_id = input.targetResults["wsl-system"].opaque_target_id;
  resignResult(input.targetResults["wsl-user"]);
}, "duplicate-opaque-target");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-convergence-"));
try {
  const files = {
    requests: valid.requests,
    wrapper: valid.wrapperReceipt,
    results: valid.targetResults,
    audit: valid.sourceAudit,
    review: valid.independentReview,
  };
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));
  }
  const run = spawnSync(
    "home-convergence",
    [
      "--requests", path.join(dir, "requests.json"),
      "--wrapper", path.join(dir, "wrapper.json"),
      "--results", path.join(dir, "results.json"),
      "--source-audit", path.join(dir, "audit.json"),
      "--review", path.join(dir, "review.json"),
      "--ops-revision", OPS,
      "--envs-revision", ENVS,
      "--flakes-revision", FLAKES,
      "--target-set-digest", TARGET_SET,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).receipt_identity, receipt.receipt_identity);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("home convergence contract and destructive fixtures: PASS");
