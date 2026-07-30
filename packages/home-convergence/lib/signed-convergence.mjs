import crypto from "node:crypto";
import { buildConvergenceReceipt, digest, targetClasses } from "./home-convergence.mjs";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REVISION_RE = /^[0-9a-f]{40}$/;
const SIGNATURE_RE = /^[A-Za-z0-9+/]+={0,2}$/;

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
    ],
    path,
  );
  if (record.kind !== "ops.homeEvidenceAuthority.v1") {
    fail("invalid-authority-kind", `${path}.kind is invalid`, { path });
  }
  if (record.role !== expectedRole) {
    fail("wrong-authority-role", `${path}.role must be ${expectedRole}`, { path });
  }
  if (typeof record.authority_key_id !== "string" || record.authority_key_id.length === 0) {
    fail("invalid-authority-key-id", `${path}.authority_key_id must be non-empty`, { path });
  }
  if (typeof record.public_key_pem !== "string" || record.public_key_pem.length === 0) {
    fail("invalid-authority-public-key", `${path}.public_key_pem must be non-empty`, { path });
  }
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

const stripEnvelope = (envelope) => {
  const payload = { ...envelope };
  delete payload.authority_key_id;
  delete payload.signature;
  return payload;
};

const normalizedRequests = (requests) => {
  if (!Array.isArray(requests)) fail("invalid-requests", "requests must be an array");
  return [...requests].sort((left, right) =>
    String(left?.target_class).localeCompare(String(right?.target_class)),
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

export const buildSignedConvergenceReceipt = ({
  exactOpsRevision,
  exactEnvsRevision,
  exactFlakesRevision,
  targetSetDigest,
  requests,
  requestAttestation,
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
  if (executionAuthority.authority_key_id === reviewAuthority.authority_key_id) {
    fail("review-not-independent", "execution and review authority keys must differ");
  }
  if (executionAuthority.public_key_pem === reviewAuthority.public_key_pem) {
    fail("review-not-independent", "execution and review public keys must differ");
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

  if (!isObject(targetResults)) {
    fail("invalid-target-results", "targetResults must be an object");
  }
  const expectedTargets = targetClasses();
  const actualTargets = Object.keys(targetResults).sort();
  const sortedExpected = [...expectedTargets].sort();
  if (
    actualTargets.length !== sortedExpected.length ||
    actualTargets.some((target, index) => target !== sortedExpected[index])
  ) {
    fail("invalid-target-results", "targetResults must contain exactly the canonical targets");
  }
  for (const targetClass of expectedTargets) {
    verifyEnvelope(targetResults[targetClass], {
      authority: executionAuthority,
      publicKey: executionKey,
      path: `targetResults.${targetClass}`,
    });
  }
  verifyEnvelope(independentReview, {
    authority: reviewAuthority,
    publicKey: reviewKey,
    path: "independentReview",
  });

  const baseReceipt = buildConvergenceReceipt({
    exactOpsRevision,
    exactEnvsRevision,
    exactFlakesRevision,
    targetSetDigest,
    requests,
    wrapperReceipt: stripEnvelope(wrapperReceipt),
    targetResults: Object.fromEntries(
      expectedTargets.map((targetClass) => [targetClass, stripEnvelope(targetResults[targetClass])]),
    ),
    sourceAudit: stripEnvelope(sourceAudit),
    independentReview: stripEnvelope(independentReview),
  });
  const payload = {
    ...baseReceipt,
    request_attestation_digest: requestAttestationDigest,
    execution_authority_identity: executionAuthority.authority_identity,
    execution_authority_key_id: executionAuthority.authority_key_id,
    review_authority_identity: reviewAuthority.authority_identity,
    review_authority_key_id: reviewAuthority.authority_key_id,
  };
  delete payload.receipt_identity;
  return { ...payload, receipt_identity: digest(payload) };
};
