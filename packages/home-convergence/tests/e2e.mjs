import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { digest, targetClasses } from "../lib/home-convergence.mjs";
import { buildSignedConvergenceReceipt } from "../lib/signed-convergence.mjs";

const OPS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ENVS = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FLAKES = "cccccccccccccccccccccccccccccccccccccccc";
const NIXPKGS = "dddddddddddddddddddddddddddddddddddddddd";
const TARGET_SET = digest({ kind: "envs.targetSet.v1", targets: targetClasses() });
const WRAPPER = digest({ kind: "private-wrapper", targetSet: TARGET_SET });
const phase = (name) => ({ status: "pass", evidence_digest: digest({ phase: name }) });

const makeAuthority = (role, authorityKeyId, publicKey) => {
  const payload = {
    kind: "ops.homeEvidenceAuthority.v1",
    authority_key_id: authorityKeyId,
    role,
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }),
  };
  return { ...payload, authority_identity: digest(payload) };
};

const signEnvelope = (payload, authority, privateKey) => {
  const unsigned = { ...payload, authority_key_id: authority.authority_key_id };
  return {
    ...unsigned,
    signature: crypto
      .sign(null, Buffer.from(digest(unsigned), "utf8"), privateKey)
      .toString("base64"),
  };
};

const stripEnvelope = (envelope) => {
  const payload = { ...envelope };
  delete payload.authority_key_id;
  delete payload.signature;
  return payload;
};

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

const requestAttestationPayload = (requests) => {
  const ordered = [...requests].sort((left, right) =>
    left.target_class.localeCompare(right.target_class),
  );
  return {
    kind: "ops.homeRequestAttestation.v1",
    exact_envs_revision: ENVS,
    exact_flakes_revision: FLAKES,
    target_set_digest: TARGET_SET,
    request_identities: ordered.map((item) => item.request_identity),
    requests_digest: digest(ordered),
    status: "pass",
  };
};

const makeInputs = () => {
  const executionKeys = crypto.generateKeyPairSync("ed25519");
  const reviewKeys = crypto.generateKeyPairSync("ed25519");
  const executionAuthority = makeAuthority(
    "execution-evidence",
    "execution-fixture-key",
    executionKeys.publicKey,
  );
  const reviewAuthority = makeAuthority(
    "independent-review",
    "review-fixture-key",
    reviewKeys.publicKey,
  );
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
  wrapperPayload.receipt_identity = digest(wrapperPayload);
  const sourceAuditPayload = {
    status: "pass",
    evidence_digest: digest({ evidence: "source-audit" }),
    desired_state_redefined_in_ops: 0,
    product_package_duplicates: 0,
    raw_secret_schema_fields: 0,
    unclassified_effects: 0,
  };
  const reviewPayload = {
    status: "pass",
    evidence_digest: digest({ evidence: "independent-review" }),
  };
  const targetResults = Object.fromEntries(
    requests.map((req) => [
      req.target_class,
      signEnvelope(resultFor(req), executionAuthority, executionKeys.privateKey),
    ]),
  );
  return {
    exactOpsRevision: OPS,
    exactEnvsRevision: ENVS,
    exactFlakesRevision: FLAKES,
    targetSetDigest: TARGET_SET,
    requests,
    requestAttestation: signEnvelope(
      requestAttestationPayload(requests),
      executionAuthority,
      executionKeys.privateKey,
    ),
    wrapperReceipt: signEnvelope(wrapperPayload, executionAuthority, executionKeys.privateKey),
    targetResults,
    sourceAudit: signEnvelope(sourceAuditPayload, executionAuthority, executionKeys.privateKey),
    independentReview: signEnvelope(reviewPayload, reviewAuthority, reviewKeys.privateKey),
    executionAuthority,
    expectedExecutionAuthorityDigest: executionAuthority.authority_identity,
    reviewAuthority,
    expectedReviewAuthorityDigest: reviewAuthority.authority_identity,
    _keys: { executionKeys, reviewKeys },
  };
};

const publicInputs = (input) => {
  const copy = { ...input };
  delete copy._keys;
  return copy;
};

const resignRequest = (requestValue) => {
  const payload = { ...requestValue };
  delete payload.request_identity;
  requestValue.request_identity = digest(payload);
};

const resignRequestAttestation = (input) => {
  input.requestAttestation = signEnvelope(
    requestAttestationPayload(input.requests),
    input.executionAuthority,
    input._keys.executionKeys.privateKey,
  );
};

const resignExecutionEnvelope = (input, envelope, identityField = null) => {
  const payload = stripEnvelope(envelope);
  if (identityField !== null) {
    delete payload[identityField];
    payload[identityField] = digest(payload);
  }
  return signEnvelope(payload, input.executionAuthority, input._keys.executionKeys.privateKey);
};

const resignReviewEnvelope = (input, envelope) =>
  signEnvelope(stripEnvelope(envelope), input.reviewAuthority, input._keys.reviewKeys.privateKey);

const expectCode = (mutate, code) => {
  const input = makeInputs();
  mutate(input);
  assert.throws(
    () => buildSignedConvergenceReceipt(publicInputs(input)),
    (error) => error?.code === code,
    `expected ${code}`,
  );
};

const valid = makeInputs();
const receipt = buildSignedConvergenceReceipt(publicInputs(valid));
assert.equal(receipt.kind, "OPS_HOMELESS_CONVERGENCE_001");
assert.equal(receipt.verdict, "PASS");
assert.equal(receipt.required_target_classes_unproven, 0);
assert.equal(receipt.execution_authority_identity, valid.executionAuthority.authority_identity);
assert.equal(receipt.review_authority_identity, valid.reviewAuthority.authority_identity);
assert.equal(receipt.per_target_results.length, 3);
assert.match(receipt.receipt_identity, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(
  buildSignedConvergenceReceipt(
    publicInputs({ ...valid, requests: [...valid.requests].reverse() }),
  ),
  receipt,
  "request order must not alter the public receipt",
);

expectCode((input) => {
  input.expectedExecutionAuthorityDigest = digest("wrong-authority");
}, "unaccepted-authority");
expectCode((input) => {
  input.wrapperReceipt.status = "blocked";
}, "signature-verification-failed");
expectCode((input) => {
  const payload = stripEnvelope(input.wrapperReceipt);
  input.wrapperReceipt = signEnvelope(
    payload,
    input.executionAuthority,
    input._keys.reviewKeys.privateKey,
  );
}, "signature-verification-failed");
expectCode((input) => {
  const sameKeyReview = makeAuthority(
    "independent-review",
    "same-public-key-review",
    input._keys.executionKeys.publicKey,
  );
  input.reviewAuthority = sameKeyReview;
  input.expectedReviewAuthorityDigest = sameKeyReview.authority_identity;
  input.independentReview = signEnvelope(
    stripEnvelope(input.independentReview),
    sameKeyReview,
    input._keys.executionKeys.privateKey,
  );
}, "review-not-independent");
expectCode((input) => input.requests.pop(), "request-attestation-mismatch");
expectCode((input) => {
  input.requests.pop();
  resignRequestAttestation(input);
}, "invalid-request-count");
expectCode((input) => {
  input.requests[2].target_class = "wsl-system";
  resignRequest(input.requests[2]);
  resignRequestAttestation(input);
}, "duplicate-target");
expectCode((input) => {
  input.requests[0].changes[0].producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  resignRequest(input.requests[0]);
  resignRequestAttestation(input);
}, "stale-envs-revision");
expectCode((input) => {
  const change = input.requests[0].changes[1];
  change.producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  change.resource_identity.producer_exact_revision = change.producer_exact_revision;
  const identityPayload = { ...change.resource_identity };
  delete identityPayload.identity;
  change.resource_identity.identity = digest(identityPayload);
  resignRequest(input.requests[0]);
  resignRequestAttestation(input);
}, "stale-flakes-revision");
expectCode((input) => {
  const change = input.requests[1].changes[1];
  change.producer_repository = "roccho-dev/home";
  change.resource_identity.producer_repository = change.producer_repository;
  const identityPayload = { ...change.resource_identity };
  delete identityPayload.identity;
  change.resource_identity.identity = digest(identityPayload);
  resignRequest(input.requests[1]);
  resignRequestAttestation(input);
}, "home-producer-reference");
expectCode((input) => {
  input.requests[0].request_identity = digest("wrong-request");
  resignRequestAttestation(input);
}, "request-digest-mismatch");
expectCode((input) => {
  input.requests[0].changes[0].unexpected = true;
  resignRequest(input.requests[0]);
  resignRequestAttestation(input);
}, "invalid-fields");
expectCode((input) => {
  const payload = stripEnvelope(input.wrapperReceipt);
  payload.status = "blocked";
  input.wrapperReceipt = resignExecutionEnvelope(input, payload, "receipt_identity");
}, "wrapper-not-pass");
expectCode((input) => {
  const result = input.targetResults["wsl-system"];
  result.second_apply_change_count = 1;
  input.targetResults["wsl-system"] = resignExecutionEnvelope(input, result, "result_identity");
}, "second-apply-changed");
expectCode((input) => {
  const result = input.targetResults["wsl-system"];
  result.rollback.status = "fail";
  input.targetResults["wsl-system"] = resignExecutionEnvelope(input, result, "result_identity");
}, "phase-failed");
expectCode((input) => {
  const result = input.targetResults["wsl-user"];
  result.home_reference_count = 1;
  input.targetResults["wsl-user"] = resignExecutionEnvelope(input, result, "result_identity");
}, "home-reference-present");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.ambient_path_dependency_count = 1;
  input.targetResults["linux-vm-system-user"] = resignExecutionEnvelope(input, result, "result_identity");
}, "ambient-path-dependency");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.raw_secret_output_count = 1;
  input.targetResults["linux-vm-system-user"] = resignExecutionEnvelope(input, result, "result_identity");
}, "raw-secret-output");
expectCode((input) => {
  const result = input.targetResults["linux-vm-system-user"];
  result.unclassified_effect_count = 1;
  input.targetResults["linux-vm-system-user"] = resignExecutionEnvelope(input, result, "result_identity");
}, "unclassified-effect");
expectCode((input) => {
  input.sourceAudit.desired_state_redefined_in_ops = 1;
  input.sourceAudit = resignExecutionEnvelope(input, input.sourceAudit);
}, "source-audit-counter");
expectCode((input) => {
  input.independentReview.status = "not-run";
  input.independentReview = resignReviewEnvelope(input, input.independentReview);
}, "review-not-pass");
expectCode((input) => {
  input.targetResults["wsl-user"].opaque_target_id = input.targetResults["wsl-system"].opaque_target_id;
  input.targetResults["wsl-user"] = resignExecutionEnvelope(
    input,
    input.targetResults["wsl-user"],
    "result_identity",
  );
}, "duplicate-opaque-target");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-convergence-"));
try {
  for (const [name, value] of Object.entries({
    requests: valid.requests,
    requestAttestation: valid.requestAttestation,
    wrapper: valid.wrapperReceipt,
    results: valid.targetResults,
    audit: valid.sourceAudit,
    review: valid.independentReview,
    executionAuthority: valid.executionAuthority,
    reviewAuthority: valid.reviewAuthority,
  })) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));
  }
  const run = spawnSync("home-convergence", [
    "receipt",
    "--requests", path.join(dir, "requests.json"),
    "--request-attestation", path.join(dir, "requestAttestation.json"),
    "--wrapper", path.join(dir, "wrapper.json"),
    "--results", path.join(dir, "results.json"),
    "--source-audit", path.join(dir, "audit.json"),
    "--review", path.join(dir, "review.json"),
    "--execution-authority", path.join(dir, "executionAuthority.json"),
    "--execution-authority-digest", valid.executionAuthority.authority_identity,
    "--review-authority", path.join(dir, "reviewAuthority.json"),
    "--review-authority-digest", valid.reviewAuthority.authority_identity,
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

console.log("home convergence signed contract and destructive fixtures: PASS");
