import crypto from "node:crypto";

const TARGET_CLASSES = [
  "linux-vm-system-user",
  "wsl-system",
  "wsl-user",
];

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REVISION_RE = /^[0-9a-f]{40}$/;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const fail = (code, message, detail = {}) => {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  throw error;
};

const requireExactKeys = (value, keys, path) => {
  if (!isObject(value)) fail("invalid-object", `${path} must be an object`, { path });
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-fields", `${path} fields do not match the closed contract`, {
      path,
      expected,
      actual,
    });
  }
};

const requireString = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid-string", `${path} must be a non-empty string`, { path });
  }
};

const requireDigest = (value, path) => {
  requireString(value, path);
  if (!DIGEST_RE.test(value)) fail("invalid-digest", `${path} must be sha256:<64 lowercase hex>`, { path });
};

const requireRevision = (value, path) => {
  requireString(value, path);
  if (!REVISION_RE.test(value)) fail("invalid-revision", `${path} must be a 40-character lowercase git revision`, { path });
};

const requireBoolean = (value, path) => {
  if (typeof value !== "boolean") fail("invalid-boolean", `${path} must be boolean`, { path });
};

const requireNonNegativeInteger = (value, path) => {
  if (!Number.isInteger(value) || value < 0) {
    fail("invalid-count", `${path} must be a non-negative integer`, { path });
  }
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
};

export const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;

const validateChange = (change, index, targetClass) => {
  const path = `requests[].changes[${index}]`;
  requireExactKeys(
    change,
    [
      "action",
      "architecture",
      "binding_id",
      "binding_kind",
      "changed",
      "dependency_ids",
      "dependency_order",
      "ensure",
      "platform",
      "producer_exact_revision",
      "producer_output",
      "producer_repository",
      "resource_identity",
      "scope",
      "target_class",
    ],
    path,
  );
  if (![
    "ensure-present",
    "ensure-absent",
    "replace",
  ].includes(change.action)) fail("invalid-action", `${path}.action is not effectful`, { path });
  requireBoolean(change.changed, `${path}.changed`);
  if (!change.changed) fail("invalid-change", `${path}.changed must be true`, { path });
  requireString(change.binding_id, `${path}.binding_id`);
  requireString(change.binding_kind, `${path}.binding_kind`);
  requireString(change.platform, `${path}.platform`);
  requireString(change.architecture, `${path}.architecture`);
  requireString(change.producer_repository, `${path}.producer_repository`);
  requireRevision(change.producer_exact_revision, `${path}.producer_exact_revision`);
  requireString(change.producer_output, `${path}.producer_output`);
  requireString(change.scope, `${path}.scope`);
  requireString(change.ensure, `${path}.ensure`);
  if (!Array.isArray(change.dependency_ids)) fail("invalid-dependencies", `${path}.dependency_ids must be an array`, { path });
  change.dependency_ids.forEach((dependency, dependencyIndex) => requireString(dependency, `${path}.dependency_ids[${dependencyIndex}]`));
  requireNonNegativeInteger(change.dependency_order, `${path}.dependency_order`);
  if (!isObject(change.resource_identity)) fail("invalid-resource-identity", `${path}.resource_identity must be an object`, { path });
  if (change.target_class !== targetClass) fail("wrong-target", `${path}.target_class does not match request`, { path });
};

export const validateRequests = (requests, expectedEnvsRevision) => {
  requireRevision(expectedEnvsRevision, "expectedEnvsRevision");
  if (!Array.isArray(requests) || requests.length !== TARGET_CLASSES.length) {
    fail("invalid-request-count", `exactly ${TARGET_CLASSES.length} requests are required`);
  }

  const byTarget = new Map();
  for (const [index, request] of requests.entries()) {
    const path = `requests[${index}]`;
    requireExactKeys(
      request,
      [
        "architecture",
        "change_count",
        "changes",
        "desired_state_digest",
        "desired_state_id",
        "kind",
        "plan_digest",
        "platform",
        "projection_identity",
        "request_identity",
        "requested_state_receipt_schema",
        "target_class",
      ],
      path,
    );
    if (request.kind !== "envs.opsRequestedState.v1") fail("invalid-request-kind", `${path}.kind is invalid`, { path });
    if (!TARGET_CLASSES.includes(request.target_class)) fail("wrong-target", `${path}.target_class is not canonical`, { path });
    if (byTarget.has(request.target_class)) fail("duplicate-target", `${path}.target_class is duplicated`, { path });
    requireString(request.desired_state_id, `${path}.desired_state_id`);
    requireDigest(request.desired_state_digest, `${path}.desired_state_digest`);
    requireDigest(request.projection_identity, `${path}.projection_identity`);
    requireDigest(request.plan_digest, `${path}.plan_digest`);
    requireDigest(request.request_identity, `${path}.request_identity`);
    requireString(request.platform, `${path}.platform`);
    requireString(request.architecture, `${path}.architecture`);
    if (request.requested_state_receipt_schema !== "envs.requestedStateReceipt.v1") {
      fail("wrong-receipt-schema", `${path}.requested_state_receipt_schema is invalid`, { path });
    }
    if (!Array.isArray(request.changes)) fail("invalid-changes", `${path}.changes must be an array`, { path });
    requireNonNegativeInteger(request.change_count, `${path}.change_count`);
    if (request.change_count !== request.changes.length) fail("change-count-mismatch", `${path}.change_count does not match changes`, { path });
    request.changes.forEach((change, changeIndex) => {
      validateChange(change, changeIndex, request.target_class);
      if (change.producer_repository === "roccho-dev/envs" && change.producer_exact_revision !== expectedEnvsRevision) {
        fail("stale-envs-revision", `${path} contains a stale envs producer revision`, { path });
      }
      if (change.producer_repository === "roccho-dev/home") {
        fail("home-producer-reference", `${path} still points to home`, { path });
      }
    });
    const payload = { ...request };
    delete payload.request_identity;
    if (digest(payload) !== request.request_identity) fail("request-digest-mismatch", `${path}.request_identity is invalid`, { path });
    byTarget.set(request.target_class, request);
  }

  for (const targetClass of TARGET_CLASSES) {
    if (!byTarget.has(targetClass)) fail("missing-target", `missing request for ${targetClass}`, { targetClass });
  }
  return byTarget;
};

export const validateWrapperReceipt = (receipt, { envsRevision, flakesRevision, targetSetDigest }) => {
  requireExactKeys(
    receipt,
    [
      "exact_envs_revision",
      "exact_flakes_revision",
      "kind",
      "private_evidence_digest",
      "receipt_identity",
      "status",
      "target_set_digest",
      "targets",
      "wrapper_digest",
    ],
    "wrapperReceipt",
  );
  if (receipt.kind !== "ops.homePrivateWrapperReceipt.v1") fail("invalid-wrapper-kind", "wrapperReceipt.kind is invalid");
  requireRevision(receipt.exact_envs_revision, "wrapperReceipt.exact_envs_revision");
  requireRevision(receipt.exact_flakes_revision, "wrapperReceipt.exact_flakes_revision");
  requireDigest(receipt.target_set_digest, "wrapperReceipt.target_set_digest");
  requireDigest(receipt.wrapper_digest, "wrapperReceipt.wrapper_digest");
  requireDigest(receipt.private_evidence_digest, "wrapperReceipt.private_evidence_digest");
  requireDigest(receipt.receipt_identity, "wrapperReceipt.receipt_identity");
  if (receipt.status !== "pass") fail("wrapper-not-pass", "wrapperReceipt.status must be pass");
  if (receipt.exact_envs_revision !== envsRevision) fail("stale-envs-revision", "wrapperReceipt envs revision mismatch");
  if (receipt.exact_flakes_revision !== flakesRevision) fail("stale-flakes-revision", "wrapperReceipt flakes revision mismatch");
  if (receipt.target_set_digest !== targetSetDigest) fail("target-set-mismatch", "wrapperReceipt target set mismatch");
  if (!Array.isArray(receipt.targets) || receipt.targets.length !== TARGET_CLASSES.length) {
    fail("invalid-wrapper-targets", "wrapperReceipt must bind all canonical targets");
  }
  const targets = new Set(receipt.targets);
  if (targets.size !== TARGET_CLASSES.length || TARGET_CLASSES.some((target) => !targets.has(target))) {
    fail("invalid-wrapper-targets", "wrapperReceipt targets do not match canonical targets");
  }
  const payload = { ...receipt };
  delete payload.receipt_identity;
  if (digest(payload) !== receipt.receipt_identity) fail("wrapper-digest-mismatch", "wrapperReceipt.receipt_identity is invalid");
};

const validatePhase = (phase, path, expectedStatus) => {
  requireExactKeys(phase, ["evidence_digest", "status"], path);
  if (phase.status !== expectedStatus) fail("phase-failed", `${path}.status must be ${expectedStatus}`, { path });
  requireDigest(phase.evidence_digest, `${path}.evidence_digest`);
};

const validateTargetResult = (result, request, { envsRevision, flakesRevision, targetSetDigest, wrapperDigest }) => {
  const path = `targetResults.${request.target_class}`;
  requireExactKeys(
    result,
    [
      "ambient_path_dependency_count",
      "apply",
      "exact_envs_revision",
      "exact_flakes_revision",
      "failure_observed",
      "home_reference_count",
      "kind",
      "native_observe",
      "opaque_target_id",
      "post_rollback_observe",
      "prepare",
      "raw_secret_output_count",
      "request_identity",
      "result_identity",
      "rollback",
      "second_apply_change_count",
      "target_class",
      "target_set_digest",
      "wrapper_digest",
    ],
    path,
  );
  if (result.kind !== "ops.homeTargetConvergenceResult.v1") fail("invalid-result-kind", `${path}.kind is invalid`, { path });
  if (result.target_class !== request.target_class) fail("wrong-target", `${path}.target_class mismatch`, { path });
  requireString(result.opaque_target_id, `${path}.opaque_target_id`);
  requireRevision(result.exact_envs_revision, `${path}.exact_envs_revision`);
  requireRevision(result.exact_flakes_revision, `${path}.exact_flakes_revision`);
  requireDigest(result.target_set_digest, `${path}.target_set_digest`);
  requireDigest(result.wrapper_digest, `${path}.wrapper_digest`);
  requireDigest(result.request_identity, `${path}.request_identity`);
  requireDigest(result.result_identity, `${path}.result_identity`);
  if (result.exact_envs_revision !== envsRevision) fail("stale-envs-revision", `${path} envs revision mismatch`, { path });
  if (result.exact_flakes_revision !== flakesRevision) fail("stale-flakes-revision", `${path} flakes revision mismatch`, { path });
  if (result.target_set_digest !== targetSetDigest) fail("target-set-mismatch", `${path} target set mismatch`, { path });
  if (result.wrapper_digest !== wrapperDigest) fail("wrapper-mismatch", `${path} wrapper mismatch`, { path });
  if (result.request_identity !== request.request_identity) fail("request-mismatch", `${path} request mismatch`, { path });
  validatePhase(result.prepare, `${path}.prepare`, "pass");
  validatePhase(result.apply, `${path}.apply`, "pass");
  validatePhase(result.native_observe, `${path}.native_observe`, "pass");
  validatePhase(result.failure_observed, `${path}.failure_observed`, "pass");
  validatePhase(result.rollback, `${path}.rollback`, "pass");
  validatePhase(result.post_rollback_observe, `${path}.post_rollback_observe`, "pass");
  requireNonNegativeInteger(result.second_apply_change_count, `${path}.second_apply_change_count`);
  requireNonNegativeInteger(result.home_reference_count, `${path}.home_reference_count`);
  requireNonNegativeInteger(result.ambient_path_dependency_count, `${path}.ambient_path_dependency_count`);
  requireNonNegativeInteger(result.raw_secret_output_count, `${path}.raw_secret_output_count`);
  if (result.second_apply_change_count !== 0) fail("second-apply-changed", `${path} second apply changed state`, { path });
  if (result.home_reference_count !== 0) fail("home-reference-present", `${path} still depends on home`, { path });
  if (result.ambient_path_dependency_count !== 0) fail("ambient-path-dependency", `${path} used ambient PATH`, { path });
  if (result.raw_secret_output_count !== 0) fail("raw-secret-output", `${path} emitted a raw secret`, { path });
  const payload = { ...result };
  delete payload.result_identity;
  if (digest(payload) !== result.result_identity) fail("result-digest-mismatch", `${path}.result_identity is invalid`, { path });
};

export const buildConvergenceReceipt = ({
  exactOpsRevision,
  exactEnvsRevision,
  exactFlakesRevision,
  targetSetDigest,
  requests,
  wrapperReceipt,
  targetResults,
  independentReview,
}) => {
  requireRevision(exactOpsRevision, "exactOpsRevision");
  requireRevision(exactEnvsRevision, "exactEnvsRevision");
  requireRevision(exactFlakesRevision, "exactFlakesRevision");
  requireDigest(targetSetDigest, "targetSetDigest");
  const requestsByTarget = validateRequests(requests, exactEnvsRevision);
  validateWrapperReceipt(wrapperReceipt, {
    envsRevision: exactEnvsRevision,
    flakesRevision: exactFlakesRevision,
    targetSetDigest,
  });
  if (!isObject(targetResults)) fail("invalid-target-results", "targetResults must be an object");
  requireExactKeys(targetResults, TARGET_CLASSES, "targetResults");
  for (const targetClass of TARGET_CLASSES) {
    validateTargetResult(targetResults[targetClass], requestsByTarget.get(targetClass), {
      envsRevision: exactEnvsRevision,
      flakesRevision: exactFlakesRevision,
      targetSetDigest,
      wrapperDigest: wrapperReceipt.wrapper_digest,
    });
  }
  requireExactKeys(independentReview, ["evidence_digest", "status"], "independentReview");
  if (independentReview.status !== "pass") fail("review-not-pass", "independentReview.status must be pass");
  requireDigest(independentReview.evidence_digest, "independentReview.evidence_digest");

  const perTargetResults = TARGET_CLASSES.map((targetClass) => {
    const result = targetResults[targetClass];
    return {
      ambient_path_dependency_count: result.ambient_path_dependency_count,
      home_reference_count: result.home_reference_count,
      opaque_target_id: result.opaque_target_id,
      private_evidence_digest: result.result_identity,
      raw_secret_output_count: result.raw_secret_output_count,
      request_identity: result.request_identity,
      second_apply_change_count: result.second_apply_change_count,
      target_class: targetClass,
      verdict: "PASS",
    };
  });

  const payload = {
    kind: "OPS_HOMELESS_CONVERGENCE_001",
    exact_ops_revision: exactOpsRevision,
    exact_envs_revision: exactEnvsRevision,
    exact_flakes_revision: exactFlakesRevision,
    target_set_digest: targetSetDigest,
    wrapper_digest: wrapperReceipt.wrapper_digest,
    required_target_classes_unproven: 0,
    desired_state_redefined_in_ops: 0,
    product_package_duplicates: 0,
    unclassified_effects: 0,
    per_target_results: perTargetResults,
    independent_review_evidence_digest: independentReview.evidence_digest,
    verdict: "PASS",
  };
  return { ...payload, receipt_identity: digest(payload) };
};

export const targetClasses = () => [...TARGET_CLASSES];
