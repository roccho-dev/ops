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
const SCOPE = "OPS_HOMELESS_CONVERGENCE_001";
const TARGET_SET = digest({ kind: "envs.targetSet.v1", targets: targetClasses() });
const WRAPPER = digest({ kind: "private-wrapper", targetSet: TARGET_SET });
const TARGET_METADATA_FIELDS = [
  "anonymous_readback_digest",
  "credential_reference_private_authority_only",
  "fresh_reconstruction",
  "legacy_permissive_access_state_present",
  "network_safe",
  "plaintext_initial_credential_present",
  "private_evidence_locator_digest",
];
const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const phase = (name) => ({ status: "pass", evidence_digest: digest({ phase: name }) });

const makeAuthority = (role, authorityKeyId, publicKey, scope = SCOPE) => {
  const payload = {
    kind: "ops.homeEvidenceAuthority.v1",
    authority_key_id: authorityKeyId,
    role,
    scope,
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

const unsignedEnvelope = (envelope) => {
  const payload = { ...envelope };
  delete payload.signature;
  return payload;
};

const coreEnvelope = (envelope) => {
  const payload = unsignedEnvelope(envelope);
  delete payload.authority_key_id;
  return payload;
};

const signedDigest = (envelope) => digest(unsignedEnvelope(envelope));

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

const makeRequest = (targetClass, extra) => {
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

const makeResultCore = (request) => {
  const targetClass = request.target_class;
  const payload = {
    kind: "ops.homeTargetConvergenceResult.v1",
    target_class: targetClass,
    opaque_target_id: `opaque-${targetClass}`,
    exact_ops_revision: OPS,
    exact_envs_revision: ENVS,
    exact_flakes_revision: FLAKES,
    target_set_digest: TARGET_SET,
    wrapper_digest: WRAPPER,
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
  return { ...payload, result_identity: digest(payload) };
};

const targetMetadata = (targetClass) => ({
  fresh_reconstruction: phase(`${targetClass}:fresh-reconstruction`),
  network_safe: phase(`${targetClass}:network-safe`),
  private_evidence_locator_digest: digest({ targetClass, locator: "private" }),
  anonymous_readback_digest: digest({ targetClass, readback: "anonymous" }),
  plaintext_initial_credential_present: false,
  legacy_permissive_access_state_present: false,
  credential_reference_private_authority_only: true,
});

const requestAttestationPayload = (requests) => {
  const ordered = [...requests].sort((left, right) =>
    compareStrings(left.target_class, right.target_class),
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

const primitiveAttestationPayload = () => ({
  kind: "ops.homePackagePrimitiveAttestation.v1",
  exact_flakes_revision: FLAKES,
  producer_repository: "roccho-dev/flakes",
  producer_output: "packages.x86_64-linux.codex-cli",
  primitive: {
    kind: "flakes.packagePrimitive.v1",
    id: "codex-cli",
    version: "0.144.1",
    mainProgram: "codex",
    target: "x86_64-unknown-linux-musl",
    layout: "openai.codexPackage.v1",
  },
  status: "pass",
});

const reviewPayload = (input) => ({
  status: "pass",
  evidence_digest: digest({ evidence: "independent-review" }),
  exact_ops_revision: OPS,
  exact_envs_revision: ENVS,
  exact_flakes_revision: FLAKES,
  target_set_digest: TARGET_SET,
  request_attestation_digest: signedDigest(input.requestAttestation),
  package_primitive_attestation_digest: signedDigest(input.packagePrimitiveAttestation),
  wrapper_receipt_attestation_digest: signedDigest(input.wrapperReceipt),
  target_result_attestation_digests: Object.fromEntries(
    targetClasses().map((targetClass) => [targetClass, signedDigest(input.targetResults[targetClass])]),
  ),
  source_audit_attestation_digest: signedDigest(input.sourceAudit),
});

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
    makeRequest(
      "linux-vm-system-user",
      packageChange(
        "linux-vm-system-user",
        "roccho-dev/flakes",
        FLAKES,
        "packages.x86_64-linux.codex-cli",
        "codex-cli",
      ),
    ),
    makeRequest(
      "wsl-system",
      packageChange("wsl-system", "NixOS/nixpkgs", NIXPKGS, "legacyPackages.x86_64-linux.git", "git"),
    ),
    makeRequest(
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
  const input = {
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
    packagePrimitiveAttestation: signEnvelope(
      primitiveAttestationPayload(),
      executionAuthority,
      executionKeys.privateKey,
    ),
    wrapperReceipt: signEnvelope(wrapperPayload, executionAuthority, executionKeys.privateKey),
    targetResults: Object.fromEntries(
      requests.map((request) => [
        request.target_class,
        signEnvelope(
          { ...makeResultCore(request), ...targetMetadata(request.target_class) },
          executionAuthority,
          executionKeys.privateKey,
        ),
      ]),
    ),
    sourceAudit: signEnvelope(
      {
        status: "pass",
        evidence_digest: digest({ evidence: "source-audit" }),
        desired_state_redefined_in_ops: 0,
        product_package_duplicates: 0,
        raw_secret_schema_fields: 0,
        unclassified_effects: 0,
      },
      executionAuthority,
      executionKeys.privateKey,
    ),
    executionAuthority,
    expectedExecutionAuthorityDigest: executionAuthority.authority_identity,
    reviewAuthority,
    expectedReviewAuthorityDigest: reviewAuthority.authority_identity,
    _keys: { executionKeys, reviewKeys },
  };
  input.independentReview = signEnvelope(
    reviewPayload(input),
    reviewAuthority,
    reviewKeys.privateKey,
  );
  return input;
};

const publicInputs = (input) => {
  const copy = { ...input };
  delete copy._keys;
  return copy;
};

const signExecution = (input, payload) =>
  signEnvelope(payload, input.executionAuthority, input._keys.executionKeys.privateKey);

const refreshReview = (input) => {
  input.independentReview = signEnvelope(
    reviewPayload(input),
    input.reviewAuthority,
    input._keys.reviewKeys.privateKey,
  );
};

const refreshRequestAttestation = (input) => {
  input.requestAttestation = signExecution(input, requestAttestationPayload(input.requests));
};

const resignRequest = (request) => {
  const payload = { ...request };
  delete payload.request_identity;
  request.request_identity = digest(payload);
};

const targetCore = (envelope) => {
  const payload = coreEnvelope(envelope);
  for (const field of TARGET_METADATA_FIELDS) delete payload[field];
  return payload;
};

const resignTarget = (input, targetClass, mutate) => {
  const oldEnvelope = input.targetResults[targetClass];
  const outer = coreEnvelope(oldEnvelope);
  const metadata = Object.fromEntries(TARGET_METADATA_FIELDS.map((field) => [field, outer[field]]));
  const core = targetCore(oldEnvelope);
  mutate(core, metadata);
  delete core.result_identity;
  core.result_identity = digest(core);
  input.targetResults[targetClass] = signExecution(input, { ...core, ...metadata });
};

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
assert.equal(receipt.required_package_primitive.version, "0.144.1");
assert.equal(receipt.required_target_classes_unproven, 0);
assert.equal(receipt.execution_authority_identity, valid.executionAuthority.authority_identity);
assert.equal(receipt.review_authority_identity, valid.reviewAuthority.authority_identity);
assert.equal(receipt.per_target_results.length, 3);
assert.equal(receipt.per_target_results[0].network_safe, "PASS");
assert.match(receipt.receipt_identity, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(
  buildSignedConvergenceReceipt(
    publicInputs({ ...valid, requests: [...valid.requests].reverse() }),
  ),
  receipt,
);

expectCode((input) => {
  input.expectedExecutionAuthorityDigest = digest("wrong-authority");
}, "unaccepted-authority");
expectCode((input) => {
  const wrongScope = makeAuthority(
    "execution-evidence",
    "execution-fixture-key",
    input._keys.executionKeys.publicKey,
    "WRONG_SCOPE",
  );
  input.executionAuthority = wrongScope;
  input.expectedExecutionAuthorityDigest = wrongScope.authority_identity;
}, "wrong-authority-scope");
expectCode((input) => {
  input.wrapperReceipt.status = "blocked";
}, "signature-verification-failed");
expectCode((input) => {
  input.wrapperReceipt = signEnvelope(
    coreEnvelope(input.wrapperReceipt),
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
    reviewPayload(input),
    sameKeyReview,
    input._keys.executionKeys.privateKey,
  );
}, "review-not-independent");
expectCode((input) => input.requests.pop(), "request-attestation-mismatch");
expectCode((input) => {
  input.requests.pop();
  refreshRequestAttestation(input);
  refreshReview(input);
}, "invalid-request-count");
expectCode((input) => {
  input.requests[2].target_class = "wsl-system";
  resignRequest(input.requests[2]);
  refreshRequestAttestation(input);
  refreshReview(input);
}, "duplicate-target");
expectCode((input) => {
  input.requests[0].changes[0].producer_exact_revision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  resignRequest(input.requests[0]);
  refreshRequestAttestation(input);
  refreshReview(input);
}, "stale-envs-revision");
expectCode((input) => {
  const change = input.requests[1].changes[1];
  change.producer_repository = "roccho-dev/home";
  change.resource_identity.producer_repository = change.producer_repository;
  const identityPayload = { ...change.resource_identity };
  delete identityPayload.identity;
  change.resource_identity.identity = digest(identityPayload);
  resignRequest(input.requests[1]);
  refreshRequestAttestation(input);
  refreshReview(input);
}, "home-producer-reference");
expectCode((input) => {
  const payload = coreEnvelope(input.packagePrimitiveAttestation);
  payload.primitive.id = "wrong-package";
  input.packagePrimitiveAttestation = signExecution(input, payload);
  refreshReview(input);
}, "package-primitive-binding-mismatch");
expectCode((input) => {
  resignTarget(input, "linux-vm-system-user", (_core, metadata) => {
    metadata.plaintext_initial_credential_present = true;
  });
}, "plaintext-credential-present");
expectCode((input) => {
  resignTarget(input, "wsl-system", (core) => {
    core.second_apply_change_count = 1;
  });
}, "review-binding-mismatch");
expectCode((input) => {
  resignTarget(input, "wsl-system", (core) => {
    core.second_apply_change_count = 1;
  });
  refreshReview(input);
}, "second-apply-changed");
expectCode((input) => {
  resignTarget(input, "wsl-system", (core) => {
    core.rollback.status = "fail";
  });
  refreshReview(input);
}, "phase-failed");
expectCode((input) => {
  const payload = coreEnvelope(input.sourceAudit);
  payload.desired_state_redefined_in_ops = 1;
  input.sourceAudit = signExecution(input, payload);
  refreshReview(input);
}, "source-audit-counter");
expectCode((input) => {
  const payload = coreEnvelope(input.independentReview);
  payload.status = "not-run";
  input.independentReview = signEnvelope(
    payload,
    input.reviewAuthority,
    input._keys.reviewKeys.privateKey,
  );
}, "review-not-pass");
expectCode((input) => {
  resignTarget(input, "wsl-user", (core) => {
    core.opaque_target_id = targetCore(input.targetResults["wsl-system"]).opaque_target_id;
  });
  refreshReview(input);
}, "duplicate-opaque-target");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-convergence-"));
try {
  for (const [name, value] of Object.entries({
    requests: valid.requests,
    requestAttestation: valid.requestAttestation,
    packagePrimitiveAttestation: valid.packagePrimitiveAttestation,
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
    "--package-primitive-attestation", path.join(dir, "packagePrimitiveAttestation.json"),
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
