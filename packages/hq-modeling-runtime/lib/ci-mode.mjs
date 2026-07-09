import { sha256Digest } from './digest.mjs';
import { forbiddenAuthorityFields } from './queue-schema.mjs';

export const ciModeContract = Object.freeze({
  kind: 'hq.ciMode.contract.v1',
  command: 'hq run ci',
  execution: 'ephemeral',
  authority: false,
  allowedOutputs: Object.freeze([
    'queue validation receipt',
    'projection proof artifact',
    'preview digest proof',
    'cross-repo proof receipt',
  ]),
  disallowedOutputs: Object.freeze([
    'accepted state',
    'remote bare repo write',
    'local long-running server authority',
  ]),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findForbiddenAuthorityFields(value, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenAuthorityFields(entry, [...path, String(index)]));
  }
  if (!isPlainObject(value)) {
    return [];
  }

  const found = [];
  for (const [key, nested] of Object.entries(value)) {
    if ((forbiddenAuthorityFields.includes(key) || key === 'canonicalWrite' || key === 'remoteWrite') && nested !== false) {
      found.push([...path, key].join('.'));
    }
    found.push(...findForbiddenAuthorityFields(nested, [...path, key]));
  }
  return found;
}

export function buildCiArtifactReceipt({
  runId = 'local-ci-fixture',
  artifacts = [],
  expectedDigests = {},
  source = {},
} = {}) {
  const artifactRows = artifacts.map((artifact) => ({
    name: artifact.name,
    digest: artifact.digest || sha256Digest(artifact.content || ''),
    role: artifact.role || 'evidence',
    authority: false,
  }));
  const observed = Object.fromEntries(artifactRows.map((artifact) => [artifact.name, artifact.digest]));
  const mismatch = Object.entries(expectedDigests)
    .filter(([name, digest]) => observed[name] !== digest)
    .map(([name, digest]) => ({ name, expected: digest, observed: observed[name] || null }));
  const forbidden = findForbiddenAuthorityFields({ artifacts, source });
  const errors = [];
  if (artifactRows.length === 0) {
    errors.push({ code: 'missing-artifact', message: 'at least one CI artifact is required' });
  }
  for (const item of mismatch) {
    errors.push({ code: 'digest-mismatch', message: `artifact digest mismatch: ${item.name}`, ...item });
  }
  for (const fieldPath of forbidden) {
    errors.push({ code: 'authority-field-present', message: `authority field is prohibited: ${fieldPath}`, fieldPath });
  }

  const receipt = {
    kind: 'hq.ciArtifactReceipt.v1',
    runMode: 'ci',
    execution: 'ephemeral',
    runId,
    source,
    artifactCount: artifactRows.length,
    artifacts: artifactRows,
    artifactDigest: sha256Digest(artifactRows),
    status: errors.length === 0 ? 'passed' : 'failed',
    authority: false,
    evidenceOnly: true,
  };
  return {
    ok: errors.length === 0,
    receipt,
    errors,
  };
}

export function validateCiArtifactReceipt(receipt, { expectedArtifactDigest } = {}) {
  const errors = [];
  if (!isPlainObject(receipt)) {
    return { ok: false, errors: [{ code: 'receipt-not-object', message: 'receipt must be an object' }] };
  }
  if (receipt.kind !== 'hq.ciArtifactReceipt.v1') {
    errors.push({ code: 'wrong-kind', message: 'receipt kind must be hq.ciArtifactReceipt.v1' });
  }
  if (receipt.runMode !== 'ci' || receipt.execution !== 'ephemeral') {
    errors.push({ code: 'not-ephemeral-ci', message: 'CI receipt must be ephemeral hq run ci evidence' });
  }
  if (receipt.authority !== false || receipt.evidenceOnly !== true) {
    errors.push({ code: 'authority-claim', message: 'CI receipt must be evidence-only and non-authority' });
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    errors.push({ code: 'missing-artifacts', message: 'receipt must contain artifacts' });
  }
  const recalculated = sha256Digest(receipt.artifacts || []);
  if (receipt.artifactDigest !== recalculated) {
    errors.push({ code: 'artifact-digest-invalid', message: 'artifactDigest must match artifacts', expected: recalculated, observed: receipt.artifactDigest });
  }
  if (expectedArtifactDigest && receipt.artifactDigest !== expectedArtifactDigest) {
    errors.push({ code: 'artifact-digest-mismatch', message: 'artifactDigest does not match expected digest', expected: expectedArtifactDigest, observed: receipt.artifactDigest });
  }
  for (const fieldPath of findForbiddenAuthorityFields(receipt)) {
    errors.push({ code: 'authority-field-present', message: `authority field is prohibited: ${fieldPath}`, fieldPath });
  }
  return { ok: errors.length === 0, errors };
}
