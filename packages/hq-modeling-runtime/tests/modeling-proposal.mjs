#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as modelingProposal from '../lib/modeling-proposal.mjs';

const { proposalDigest, validateModelingProposal } = modelingProposal;

assert.deepEqual(
  Object.keys(modelingProposal).sort(),
  ['proposalDigest', 'validateModelingProposal'],
);
assert.equal('proposalToQueueIntentCandidate' in modelingProposal, false);

const proposal = {
  kind: 'modeling.proposal.v1',
  id: 'proposal_001',
  sourceAgentTaskId: 'aq_agent_001',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  proposedOperation: {
    op: 'addEdge',
    payload: {
      from: 'pkg:core',
      to: 'pkg:ui',
      type: 'uses',
      optional: null,
      nested: { list: [true, 1, 'value', null] },
    },
  },
  evidence: [
    { kind: 'digest', value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ],
  acceptanceCriteria: ['human may promote into model queue only after review'],
  status: 'proposed',
};

function codes(errors) {
  return errors.map((error) => error.code);
}

function dataError(errors, reason, path) {
  return errors.find((error) => error.code === 'proposal-data-invalid'
    && error.reason === reason
    && error.path === path);
}

function withPayload(value) {
  return {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { ...proposal.proposedOperation.payload, bad: value },
    },
  };
}

{
  const errors = validateModelingProposal(proposal);
  assert.deepEqual(errors, []);
  assert.match(proposalDigest(proposal), /^sha256:/);
  assert.equal(
    proposalDigest(proposal),
    proposalDigest({
      status: proposal.status,
      acceptanceCriteria: proposal.acceptanceCriteria,
      evidence: proposal.evidence,
      proposedOperation: proposal.proposedOperation,
      targetRef: proposal.targetRef,
      sourceAgentTaskId: proposal.sourceAgentTaskId,
      id: proposal.id,
      kind: proposal.kind,
    }),
  );
}

for (const malformed of [undefined, null, [], 'proposal', 1, true, 1n, Symbol('proposal'), () => {}]) {
  const errors = validateModelingProposal(malformed);
  assert.deepEqual(codes(errors), ['proposal-not-object']);
}

{
  const missingEvidence = { ...proposal, evidence: [] };
  const errors = validateModelingProposal(missingEvidence);
  assert.ok(codes(errors).includes('evidence-missing'));
}

{
  const missingTarget = { ...proposal, targetRef: { kind: 'repoMap.node' } };
  const errors = validateModelingProposal(missingTarget);
  assert.ok(codes(errors).includes('targetRef-missing-id'));
}

{
  const missingOp = { ...proposal, proposedOperation: { payload: {} } };
  const errors = validateModelingProposal(missingOp);
  assert.ok(codes(errors).includes('proposal-op-missing'));
}

{
  const authority = {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { nested: [{ acceptedLedger: true }] },
    },
  };
  const errors = validateModelingProposal(authority);
  const authorityError = errors.find((error) => error.code === 'authority-field-present');
  assert.equal(authorityError.fieldPath, 'proposedOperation.payload.nested.0.acceptedLedger');
  assert.equal(authorityError.path, '/proposedOperation/payload/nested/0/acceptedLedger');
}

{
  const embedded = { ...proposal, acceptedRow: { kind: 'accepted.modelCommit.v1' } };
  const errors = validateModelingProposal(embedded);
  assert.ok(codes(errors).includes('embedded-authority-shape'));
}

for (const [name, value, reason] of [
  ['bigint', 1n, 'bigint'],
  ['nan', Number.NaN, 'non-finite-number'],
  ['positive-infinity', Number.POSITIVE_INFINITY, 'non-finite-number'],
  ['negative-infinity', Number.NEGATIVE_INFINITY, 'non-finite-number'],
  ['negative-zero', -0, 'negative-zero'],
  ['date', new Date('2026-07-18T00:00:00Z'), 'non-plain-object'],
  ['map', new Map([['key', 'value']]), 'non-plain-object'],
  ['set', new Set(['value']), 'non-plain-object'],
  ['undefined', undefined, 'undefined'],
  ['function', () => {}, 'function'],
  ['symbol', Symbol('value'), 'symbol'],
]) {
  assert.doesNotThrow(() => {
    const errors = validateModelingProposal(withPayload(value));
    assert.ok(dataError(errors, reason, '/proposedOperation/payload/bad'), `${name}: ${JSON.stringify(errors)}`);
  });
}

{
  class CustomValue {
    constructor() {
      this.value = 'custom';
    }
  }
  const errors = validateModelingProposal(withPayload(new CustomValue()));
  assert.ok(dataError(errors, 'non-plain-object', '/proposedOperation/payload/bad'));
}

{
  const sparse = [];
  sparse.length = 2;
  sparse[1] = 'present';
  const errors = validateModelingProposal(withPayload(sparse));
  assert.ok(dataError(errors, 'sparse-array-hole', '/proposedOperation/payload/bad/0'));
}

{
  const hugeSparse = [];
  hugeSparse.length = 4_294_967_295;
  hugeSparse[4_294_967_294] = 'present';
  const errors = validateModelingProposal(withPayload(hugeSparse));
  assert.ok(dataError(errors, 'sparse-array-hole', '/proposedOperation/payload/bad/0'));
}

{
  const deeplyNested = {};
  let cursor = deeplyNested;
  for (let index = 0; index < 20_000; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.doesNotThrow(() => {
    const errors = validateModelingProposal(withPayload(deeplyNested));
    assert.ok(errors.some((error) => error.code === 'proposal-data-invalid'));
  });
}

{
  const arrayWithExtra = ['value'];
  arrayWithExtra.extra = true;
  const errors = validateModelingProposal(withPayload(arrayWithExtra));
  assert.ok(dataError(errors, 'extra-array-property', '/proposedOperation/payload/bad/extra'));
}

{
  const cycle = {};
  cycle.self = cycle;
  assert.doesNotThrow(() => {
    const errors = validateModelingProposal(withPayload(cycle));
    assert.ok(dataError(errors, 'cycle', '/proposedOperation/payload/bad/self'));
  });
}

{
  const payload = { safe: true };
  payload[Symbol('hidden')] = 'symbol-key-value';
  const invalid = {
    ...proposal,
    proposedOperation: { ...proposal.proposedOperation, payload },
  };
  const errors = validateModelingProposal(invalid);
  assert.ok(dataError(errors, 'symbol-key', '/proposedOperation/payload'));
}

{
  const payload = { safe: true };
  Object.defineProperty(payload, 'hidden', { enumerable: false, value: 'not-json-visible' });
  const invalid = {
    ...proposal,
    proposedOperation: { ...proposal.proposedOperation, payload },
  };
  const errors = validateModelingProposal(invalid);
  assert.ok(dataError(errors, 'non-enumerable-property', '/proposedOperation/payload/hidden'));
}

{
  const payload = { 'a/b~c': undefined };
  const invalid = {
    ...proposal,
    proposedOperation: { ...proposal.proposedOperation, payload },
  };
  const errors = validateModelingProposal(invalid);
  assert.ok(dataError(errors, 'undefined', '/proposedOperation/payload/a~1b~0c'));
}

{
  const shared = { value: 'same-object-is-not-a-cycle' };
  const validAlias = {
    ...proposal,
    proposedOperation: {
      ...proposal.proposedOperation,
      payload: { left: shared, right: shared },
    },
  };
  assert.deepEqual(validateModelingProposal(validAlias), []);
  assert.match(proposalDigest(validAlias), /^sha256:/);
}

{
  const nullPrototype = Object.assign(Object.create(null), { value: 'json-compatible' });
  const validNullPrototype = withPayload(nullPrototype);
  assert.deepEqual(validateModelingProposal(validNullPrototype), []);
  assert.match(proposalDigest(validNullPrototype), /^sha256:/);
}

{
  const invalidKindWithGetter = { kind: 'not.modeling.proposal.v1' };
  let reads = 0;
  Object.defineProperty(invalidKindWithGetter, 'trap', {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error('invalid kind must stop before recursive traversal');
    },
  });
  const errors = validateModelingProposal(invalidKindWithGetter);
  assert.deepEqual(codes(errors), ['invalid-proposal-kind']);
  assert.equal(reads, 0);
}

console.log('hq modeling proposal schema check: PASS');
