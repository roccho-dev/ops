import crypto from "node:crypto";
import { buildConvergenceReceipt, digest, targetClasses } from "./home-convergence.mjs";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
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
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64");
  } catch {
    fail("invalid-signature", `${path}.signature cannot be decoded`, { path });
  }
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

export const signEnvelopeForTest = (payload, { authorityKeyId, privateKey }) => {
  const unsigned = { ...payload, authority_key_id: authorityKeyId };
  const signature = crypto
    .sign(null, Buffer.from(digest(unsigned), "utf8"), privateKey)
    .toString("base64");
  return { ...unsigned, signature };
};

export const buildSignedConvergenceReceipt = ({
  exactOpsRevision,
  exactEnvsRevision,
  exactFlakesRevision,
  targetSetDigest,
  requests,
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
    execution_authority_identity: executionAuthority.authority_identity,
    execution_authority_key_id: executionAuthority.authority_key_id,
    review_authority_identity: reviewAuthority.authority_identity,
    review_authority_key_id: reviewAuthority.authority_key_id,
  };
  delete payload.receipt_identity;
  return { ...payload, receipt_identity: digest(payload) };
};
