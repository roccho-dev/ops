#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildCiArtifactReceipt,
  ciModeContract,
  validateCiArtifactReceipt,
} from '../lib/ci-mode.mjs';

assert.equal(ciModeContract.kind, 'hq.ciMode.contract.v1');
assert.equal(ciModeContract.command, 'hq run ci');
assert.equal(ciModeContract.execution, 'ephemeral');
assert.equal(ciModeContract.authority, false);
assert.ok(ciModeContract.allowedOutputs.includes('queue validation receipt'));
assert.ok(ciModeContract.disallowedOutputs.includes('accepted state'));

const valid = buildCiArtifactReceipt({
  runId: 'run-65',
  source: { repo: 'roccho-dev/ops', issue: 65 },
  artifacts: [
    { name: 'queue-validation', content: 'PASS', role: 'receipt' },
    { name: 'projection-proof', content: '{"ok":true}', role: 'artifact' },
  ],
});
assert.equal(valid.ok, true);
assert.equal(valid.receipt.kind, 'hq.ciArtifactReceipt.v1');
assert.equal(valid.receipt.runMode, 'ci');
assert.equal(valid.receipt.execution, 'ephemeral');
assert.equal(valid.receipt.authority, false);
assert.equal(valid.receipt.evidenceOnly, true);
assert.equal(validateCiArtifactReceipt(valid.receipt).ok, true);

const mismatched = buildCiArtifactReceipt({
  artifacts: [{ name: 'queue-validation', content: 'PASS' }],
  expectedDigests: { 'queue-validation': 'sha256:not-the-observed-digest' },
});
assert.equal(mismatched.ok, false);
assert.ok(mismatched.errors.some((error) => error.code === 'digest-mismatch'));

const noArtifact = buildCiArtifactReceipt({ artifacts: [] });
assert.equal(noArtifact.ok, false);
assert.ok(noArtifact.errors.some((error) => error.code === 'missing-artifact'));

const authorityBearing = buildCiArtifactReceipt({
  artifacts: [{ name: 'bad', content: 'bad', authority: true }],
});
assert.equal(authorityBearing.ok, false);
assert.ok(authorityBearing.errors.some((error) => error.code === 'authority-field-present'));

const tampered = { ...valid.receipt, artifactDigest: 'sha256:tampered' };
const tamperedValidation = validateCiArtifactReceipt(tampered);
assert.equal(tamperedValidation.ok, false);
assert.ok(tamperedValidation.errors.some((error) => error.code === 'artifact-digest-invalid'));

console.log('hq ci mode artifact receipt boundary check: PASS');
