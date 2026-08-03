import crypto from "node:crypto";
import { buildConvergenceReceipt, digest, targetClasses } from "./home-convergence.mjs";

const SCOPE = "OPS_HOMELESS_CONVERGENCE_001";
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REVISION_RE = /^[0-9a-f]{40}$/;
const SIGNATURE_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const TARGET_EVIDENCE_FIELDS = [
  "anonymous_readback_digest",
  "credential_reference_private_authority_only",
  "fresh_reconstruction",
  "legacy_permissive_access_state_present",
  "network_safe",
  "plaintext_initial_credential_present",
  "private_evidence_locator_digest",
];

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const fail = (code, message, detail = {}) => {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  throw error;
};

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const requireExactKeys = (value, keys, path) => {
  if (!isObject(value)) fail("invalid-object", `${path} must be an object`, { path });
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-fields", `${path} fields do not match the closed contract`, {
      path,
      expected,
      actual,
    });
  }
};

const requireAllowedKeys = (value, required, allowed, path) => {
  if (!isObject(value)) fail("invalid-object", `${path} must be an object`, { path });
  for (const key of required) {
    if (!(key in value)) fail("missing-field", `${path}.${key} is required`, { path, key });
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail("invalid-fields", `${path} contains unknown fields`, { path, unknown });
};

const requireString = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid-string", `${path} must be a non-empty string`, { path });
  }
};

const requireDigest = (value, path) => {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("invalid-digest", `${path} must be sha256:<64 lowercase hex>`, { path });
  }
};

const requireRevision = (value, path) => {
  if (typeof value !== "string" || !REVISION_RE.test(value)) {
    fail("invalid-revision", `${path} must be a 40-character lowercase git revision`, { path });
  }
};

const authorityPayload = (record) => {
  const payload = { ...record };
  delete payload.authority_identity;
  return payload;
};

export const validateAuthorityRecord = (record, { expectedDigest, expectedRole, path }) => {
  requireExactKeys(
    record,
    [
      "authority_identity",
      "authority_key_id",
      "kind",
      "public_key_pem",
      "role",
      "scope",
    ],
    path,
  );
  if (record.kind !== "ops.homeEvidenceAuthority.v1") {
    fail("invalid-authority-kind", `${path}.kind is invalid`, { path });
  }
  if (record.scope !== SCOPE) {
    fail("wrong-authority-scope", `${path}.scope must be ${SCOPE}`, { path });
  }
  if (record.role !== expectedRole) {
    fail("wrong-authority-role", `${path}.role must be ${expectedRole}`, { path });
  }
  requireString(record.authority_key_id, `${path}.authority_key_id`);
  requireString(record.public_key_pem, `${path}.public_key_pem`);
  requireDigest(record.authority_identity, `${path}.authority_identity`);
  requireDigest(expectedDigest, `${path}.expectedDigest`);
  if (digest(authorityPayload(record)) !== record.authority_identity) {
    fail("authority-digest-mismatch", `${path}.authority_identity is invalid`, { path });
  }
  if (record.authority_identity !== expectedDigest) {
    fail("unaccepted-authority", `${path} does not match the expected accepted digest`, { path });
  }
  let key;
  try {
    key = crypto.createPublicKey(record.public_key_pem);
  } catch {
    fail("invalid-authority-public-key", `${path}.public_key_pem cannot be parsed`, { path });
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail("unsupported-authority-key", `${path} must use Ed25519`, { path });
  }
  return key;
};

const unsignedEnvelope = (envelope) => {
  const payload = { ...envelope };
  delete payload.signature;
  return payload;
};

const stripEnvelope = (envelope) => {
  const payload = unsignedEnvelope(envelope);
  delete payload.authority_key_id;
  return payload;
};

const verifyEnvelope = (envelope, { authority, publicKey, path }) => {
  if (!isObject(envelope)) fail("invalid-object", `${path} must be an object`, { path });
  if (envelope.authority_key_id !== authority.authority_key_id) {
    fail("wrong-signer", `${path}.authority_key_id does not match authority`, { path });
  }
  if (typeof envelope.signature !== "string" || !SIGNATURE_RE.test(envelope.signature)) {
    fail("invalid-signature", `${path}.signature must be base64`, { path });
  }
  const signature = Buffer.from(envelope.signature, "base64");
  if (signature.length !== 64) {
    fail("invalid-signature", `${path}.signature must be a 64-byte Ed25519 signature`, { path });
  }
  const message = Buffer.from(digest(unsignedEnvelope(envelope)), "utf8");
  if (!crypto.verify(null, message, publicKey, signature)) {
    fail("signature-verification-failed", `${path}.signature is invalid`, { path });
  }
};

const normalizedRequests = (requests) => {
  if (!Array.isArray(requests)) fail("invalid-requests", "requests must be an array");
  return [...requests].sort((left, right) =>
    compareStrings(String(left?.target_class), String(right?.target_class)),
  );
};

const validateRequestAttestation = (
  attestation,
  { requests, exactEnvsRevision, exactFlakesRevision, targetSetDigest },
) => {
  const payload = stripEnvelope(attestation);
  requireExactKeys(
    payload,
    [
      "exact_envs_revision",
      "exact_flakes_revision",
      "kind",
      "request_identities",
      "requests_digest",
      "status",
      "target_set_digest",
    ],
    "requestAttestation",
  );
  if (payload.kind !== "ops.homeRequestAttestation.v1") {
    fail("invalid-request-attestation-kind", "requestAttestation.kind is invalid");
  }
  if (payload.status !== "pass") {
    fail("request-attestation-not-pass", "requestAttestation.status must be pass");
  }
  requireRevision(payload.exact_envs_revision, "requestAttestation.exact_envs_revision");
  requireRevision(payload.exact_flakes_revision, "requestAttestation.exact_flakes_revision");
  requireDigest(payload.target_set_digest, "requestAttestation.target_set_digest");
  requireDigest(payload.requests_digest, "requestAttestation.requests_digest");
  if (payload.exact_envs_revision !== exactEnvsRevision) {
    fail("stale-envs-revision", "requestAttestation envs revision mismatch");
  }
  if (payload.exact_flakes_revision !== exactFlakesRevision) {
    fail("stale-flakes-revision", "requestAttestation flakes revision mismatch");
  }
  if (payload.target_set_digest !== targetSetDigest) {
    fail("target-set-mismatch", "requestAttestation target set mismatch");
  }
  const ordered = normalizedRequests(requests);
  const identities = ordered.map((request) => request.request_identity);
  if (!Array.isArray(payload.request_identities)) {
    fail("invalid-request-identities", "requestAttestation.request_identities must be an array");
  }
  if (
    payload.request_identities.length !== identities.length ||
    payload.request_identities.some((identity, index) => identity !== identities[index])
  ) {
    fail("request-attestation-mismatch", "requestAttestation identities do not match requests");
  }
  if (payload.requests_digest !== digest(ordered)) {
    fail("request-attestation-mismatch", "requestAttestation requests_digest does not match requests");
  }
  return digest(unsignedEnvelope(attestation));
};

const validatePrimitive = (primitive, path) => {
  const required = ["id", "kind", "mainProgram", "version"];
  const allowed = [...required, "layout", "target"];
  requireAllowedKeys(primitive, required, allowed, path);
  if (primitive.kind !== "flakes.packagePrimitive.v1") {
    fail("invalid-package-primitive-kind", `${path}.kind is invalid`, { path });
  }
  requireString(primitive.id, `${path}.id`);
  requireString(primitive.version, `${path}.version`);
  requireString(primitive.mainProgram, `${path}.mainProgram`);
  if ("layout" in primitive) requireString(primitive.layout, `${path}.layout`);
  if ("target" in primitive) requireString(primitive.target, `${path}.target`);
};

const validatePackagePrimitiveAttestation = (
  attestation,
  { requests, exactFlakesRevision },
) => {
  const payload = stripEnvelope(attestation);
  requireExactKeys(
    payload,
    [
      "exact_flakes_revision",
      "kind",
      "primitive",
      "producer_output",
      "producer_repository",
      "status",
    ],
    "packagePrimitiveAttestation",
  );
  if (payload.kind !== "ops.homePackagePrimitiveAttestation.v1") {
    fail("invalid-package-primitive-attestation-kind", "packagePrimitiveAttestation.kind is invalid");
  }
  if (payload.status !== "pass") {
    fail("package-primitive-attestation-not-pass", "packagePrimitiveAttestation.status must be pass");
  }
  requireRevision(payload.exact_flakes_revision, "packagePrimitiveAttestation.exact_flakes_revision");
  requireString(payload.producer_repository, "packagePrimitiveAttestation.producer_repository");
  requireString(payload.producer_output, "packagePrimitiveAttestation.producer_output");
  validatePrimitive(payload.primitive, "packagePrimitiveAttestation.primitive");
  if (payload.exact_flakes_revision !== exactFlakesRevision) {
    fail("stale-flakes-revision", "packagePrimitiveAttestation flakes revision mismatch");
  }
  if (payload.producer_repository !== "roccho-dev/flakes") {
    fail("wrong-package-producer", "packagePrimitiveAttestation producer must be roccho-dev/flakes");
  }
  const flakesBindings = normalizedRequests(requests)
    .flatMap((request) => request.changes ?? [])
    .filter((change) => change.producer_repository === "roccho-dev/flakes");
  if (flakesBindings.length !== 1) {
    fail("required-package-binding-count", "exactly one required flakes package binding is expected");
  }
  const binding = flakesBindings[0];
  if (
    binding.producer_exact_revision !== payload.exact_flakes_revision ||
    binding.producer_output !== payload.producer_output ||
    binding.resource_identity?.package_id !== payload.primitive.id
  ) {
    fail("package-primitive-binding-mismatch", "package primitive does not match the envs binding");
  }
  return {
    payload,
    attestationDigest: digest(unsignedEnvelope(attestation)),
  };
};

const validateEvidencePhase = (phase, path) => {
  requireExactKeys(phase, ["evidence_digest", "status"], path);
  if (phase.status !== "pass") fail("phase-failed", `${path}.status must be pass`, { path });
  requireDigest(phase.evidence_digest, `${path}.evidence_digest`);
};

const validateTargetExecutionEnvelope = (envelope, path) => {
  const payload = stripEnvelope(envelope);
  for (const field of TARGET_EVIDENCE_FIELDS) {
    if (!(field in payload)) fail("missing-field", `${path}.${field} is required`, { path, field });
  }
  validateEvidencePhase(payload.fresh_reconstruction, `${path}.fresh_reconstruction`);
  validateEvidencePhase(payload.network_safe, `${path}.network_safe`);
  requireDigest(payload.private_evidence_locator_digest, `${path}.private_evidence_locator_digest`);
  requireDigest(payload.anonymous_readback_digest, `${path}.anonymous_readback_digest`);
  if (payload.plaintext_initial_credential_present !== false) {
    fail("plaintext-credential-present", `${path}.plaintext_initial_credential_present must be false`, { path });
  }
  if (payload.legacy_permissive_access_state_present !== false) {
    fail("legacy-access-present", `${path}.legacy_permissive_access_state_present must be false`, { path });
  }
  if (payload.credential_reference_private_authority_only !== true) {
    fail("credential-authority-invalid", `${path}.credential_reference_private_authority_only must be true`, { path });
  }
  const core = { ...payload };
  for (const field of TARGET_EVIDENCE_FIELDS) delete core[field];
  return {
    core,
    metadata: Object.fromEntries(TARGET_EVIDENCE_FIELDS.map((field) => [field, payload[field]])),
    attestationDigest: digest(unsignedEnvelope(envelope)),
  };
};

const validateIndependentReview = (
  review,
  {
    exactOpsRevision,
    exactEnvsRevision,
    exactFlakesRevision,
    targetSetDigest,
    requestAttestationDigest,
    packagePrimitiveAttestationDigest,
    wrapperReceiptAttestationDigest,
    targetResultAttestationDigests,
    sourceAuditAttestationDigest,
  },
) => {
  const payload = stripEnvelope(review);
  requireExactKeys(
    payload,
    [
      "evidence_digest",
      "exact_envs_revision",
      "exact_flakes_revision",
      "exact_ops_revision",
      "package_primitive_attestation_digest",
      "request_attestation_digest",
      "source_audit_attestation_digest",
      "status",
      "target_result_attestation_digests",
      "target_set_digest",
      "wrapper_receipt_attestation_digest",
    ],
    "independentReview",
  );
  if (payload.status !== "pass") fail("review-not-pass", "independentReview.status must be pass");
  requireDigest(payload.evidence_digest, "independentReview.evidence_digest");
  requireRevision(payload.exact_ops_revision, "independentReview.exact_ops_revision");
  requireRevision(payload.exact_envs_revision, "independentReview.exact_envs_revision");
  requireRevision(payload.exact_flakes_revision, "independentReview.exact_flakes_revision");
  requireDigest(payload.target_set_digest, "independentReview.target_set_digest");
  requireDigest(payload.request_attestation_digest, "independentReview.request_attestation_digest");
  requireDigest(payload.package_primitive_attestation_digest, "independentReview.package_primitive_attestation_digest");
  requireDigest(payload.wrapper_receipt_attestation_digest, "independentReview.wrapper_receipt_attestation_digest");
  requireDigest(payload.source_audit_attestation_digest, "independentReview.source_audit_attestation_digest");
  if (
    payload.exact_ops_revision !== exactOpsRevision ||
    payload.exact_envs_revision !== exactEnvsRevision ||
    payload.exact_flakes_revision !== exactFlakesRevision
  ) {
    fail("review-revision-mismatch", "independentReview revisions do not match evidence");
  }
  if (payload.target_set_digest !== targetSetDigest) {
    fail("target-set-mismatch", "independentReview target set mismatch");
  }
  if (
    payload.request_attestation_digest !== requestAttestationDigest ||
    payload.package_primitive_attestation_digest !== packagePrimitiveAttestationDigest ||
    payload.wrapper_receipt_attestation_digest !== wrapperReceiptAttestationDigest ||
    payload.source_audit_attestation_digest !== sourceAuditAttestationDigest
  ) {
    fail("review-binding-mismatch", "independentReview evidence-set binding is stale or unrelated");
  }
  const expectedTargets = targetClasses();
  requireExactKeys(
    payload.target_result_attestation_digests,
    expectedTargets,
    "independentReview.target_result_attestation_digests",
  );
  for (const targetClass of expectedTargets) {
    requireDigest(
      payload.target_result_attestation_digests[targetClass],
      `independentReview.target_result_attestation_digests.${targetClass}`,
    );
    if (
      payload.target_result_attestation_digests[targetClass] !==
      targetResultAttestationDigests[targetClass]
    ) {
      fail("review-binding-mismatch", `independentReview result mismatch for ${targetClass}`);
    }
  }
  return {
    core: { status: payload.status, evidence_digest: payload.evidence_digest },
    attestationDigest: digest(unsignedEnvelope(review)),
  };
};

export const buildSignedConvergenceReceipt = ({
  exactOpsRevision,
  exactEnvsRevision,
  exactFlakesRevision,
  targetSetDigest,
  requests,
  requestAttestation,
  packagePrimitiveAttestation,
  wrapperReceipt,
  targetResults,
  sourceAudit,
  independentReview,
  executionAuthority,
  expectedExecutionAuthorityDigest,
  reviewAuthority,
  expectedReviewAuthorityDigest,
}) => {
  const executionKey = validateAuthorityRecord(executionAuthority, {
    expectedDigest: expectedExecutionAuthorityDigest,
    expectedRole: "execution-evidence",
    path: "executionAuthority",
  });
  const reviewKey = validateAuthorityRecord(reviewAuthority, {
    expectedDigest: expectedReviewAuthorityDigest,
    expectedRole: "independent-review",
    path: "reviewAuthority",
  });
  if (
    executionAuthority.authority_key_id === reviewAuthority.authority_key_id ||
    executionAuthority.public_key_pem === reviewAuthority.public_key_pem
  ) {
    fail("review-not-independent", "execution and review authorities must use distinct keys");
  }

  verifyEnvelope(requestAttestation, {
    authority: executionAuthority,
    publicKey: executionKey,
    path: "requestAttestation",
  });
  const requestAttestationDigest = validateRequestAttestation(requestAttestation, {
    requests,
    exactEnvsRevision,
    exactFlakesRevision,
    targetSetDigest,
  });
  verifyEnvelope(packagePrimitiveAttestation, {
    authority: executionAuthority,
    publicKey: executionKey,
    path: "packagePrimitiveAttestation",
  });
  const primitiveValidation = validatePackagePrimitiveAttestation(
    packagePrimitiveAttestation,
    { requests, exactFlakesRevision },
  );
  verifyEnvelope(wrapperReceipt, {
    authority: executionAuthority,
    publicKey: executionKey,
    path: "wrapperReceipt",
  });
  verifyEnvelope(sourceAudit, {
    authority: executionAuthority,
    publicKey: executionKey,
    path: "sourceAudit",
  });

  if (!isObject(targetResults)) fail("invalid-target-results", "targetResults must be an object");
  const expectedTargets = targetClasses();
  requireExactKeys(targetResults, expectedTargets, "targetResults");
  const targetCore = {};
  const targetMetadata = {};
  const targetAttestationDigests = {};
  for (const targetClass of expectedTargets) {
    verifyEnvelope(targetResults[targetClass], {
      authority: executionAuthority,
      publicKey: executionKey,
      path: `targetResults.${targetClass}`,
    });
    const validation = validateTargetExecutionEnvelope(
      targetResults[targetClass],
      `targetResults.${targetClass}`,
    );
    targetCore[targetClass] = validation.core;
    targetMetadata[targetClass] = validation.metadata;
    targetAttestationDigests[targetClass] = validation.attestationDigest;
  }
  verifyEnvelope(independentReview, {
    authority: reviewAuthority,
    publicKey: reviewKey,
    path: "independentReview",
  });

  const wrapperCore = stripEnvelope(wrapperReceipt);
  const sourceAuditCore = stripEnvelope(sourceAudit);
  const wrapperReceiptAttestationDigest = digest(unsignedEnvelope(wrapperReceipt));
  const sourceAuditAttestationDigest = digest(unsignedEnvelope(sourceAudit));
  const reviewValidation = validateIndependentReview(independentReview, {
    exactOpsRevision,
    exactEnvsRevision,
    exactFlakesRevision,
    targetSetDigest,
    requestAttestationDigest,
    packagePrimitiveAttestationDigest: primitiveValidation.attestationDigest,
    wrapperReceiptAttestationDigest,
    targetResultAttestationDigests: targetAttestationDigests,
    sourceAuditAttestationDigest,
  });

  const baseReceipt = buildConvergenceReceipt({
    exactOpsRevision,
    exactEnvsRevision,
    exactFlakesRevision,
    targetSetDigest,
    requests,
    wrapperReceipt: wrapperCore,
    targetResults: targetCore,
    sourceAudit: sourceAuditCore,
    independentReview: reviewValidation.core,
  });
  const primitive = primitiveValidation.payload.primitive;
  const payload = {
    ...baseReceipt,
    request_attestation_digest: requestAttestationDigest,
    package_primitive_attestation_digest: primitiveValidation.attestationDigest,
    wrapper_receipt_attestation_digest: wrapperReceiptAttestationDigest,
    source_audit_attestation_digest: sourceAuditAttestationDigest,
    review_attestation_digest: reviewValidation.attestationDigest,
    required_package_primitive: {
      id: primitive.id,
      version: primitive.version,
      main_program: primitive.mainProgram,
      target: primitive.target ?? null,
      layout: primitive.layout ?? null,
      producer_output: primitiveValidation.payload.producer_output,
    },
    per_target_results: baseReceipt.per_target_results.map((result) => ({
      ...result,
      private_evidence_digest: targetAttestationDigests[result.target_class],
      private_evidence_locator_digest:
        targetMetadata[result.target_class].private_evidence_locator_digest,
      anonymous_readback_digest:
        targetMetadata[result.target_class].anonymous_readback_digest,
      fresh_reconstruction: "PASS",
      network_safe: "PASS",
      plaintext_initial_credential_present: false,
      legacy_permissive_access_state_present: false,
      credential_reference_private_authority_only: true,
    })),
    execution_authority_identity: executionAuthority.authority_identity,
    execution_authority_key_id: executionAuthority.authority_key_id,
    review_authority_identity: reviewAuthority.authority_identity,
    review_authority_key_id: reviewAuthority.authority_key_id,
  };
  delete payload.receipt_identity;
  return { ...payload, receipt_identity: digest(payload) };
};
