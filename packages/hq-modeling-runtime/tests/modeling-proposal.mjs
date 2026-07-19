#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as modelingProposal from '../lib/modeling-proposal.mjs';

const {
  proposalDigest,
  snapshotModelingProposal,
  validateModelingProposal,
} = modelingProposal;

assert.deepEqual(
  Object.keys(modelingProposal).sort(),
  ['proposalDigest', 'snapshotModelingProposal', 'validateModelingProposal'],
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
  const snapshotted = snapshotModelingProposal(proposal);
  assert.deepEqual(snapshotted.errors, []);
  assert.deepEqual(snapshotted.snapshot, proposal);
  assert.notStrictEqual(snapshotted.snapshot, proposal);
  assert.notStrictEqual(snapshotted.snapshot.targetRef, proposal.targetRef);
  assert.notStrictEqual(snapshotted.snapshot.proposedOperation.payload, proposal.proposedOperation.payload);
  assert.deepEqual(validateModelingProposal(proposal), []);
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

for (const malformed of [undefined, null, [], 'proposal', 1, true, 1n, Symbol('proposal'), () => {}, new Date()]) {
  assert.deepEqual(codes(validateModelingProposal(malformed)), ['proposal-not-object']);
}

for (const [candidate, expected] of [
  [{ ...proposal, evidence: [] }, 'evidence-missing'],
  [{ ...proposal, targetRef: { kind: 'repoMap.node' } }, 'targetRef-missing-id'],
  [{ ...proposal, proposedOperation: { payload: {} } }, 'proposal-op-missing'],
]) {
  assert.ok(codes(validateModelingProposal(candidate)).includes(expected));
}

const authorityCounterexamples = [
  ['acceptedRow field', (candidate) => { candidate.acceptedRow = { id: 'accepted' }; }],
  ['accepted kind infix', (candidate) => { candidate.extra = { kind: 'hq.acceptedRow.v1' }; }],
  ['accepted status suffix', (candidate) => { candidate.extra = { status: 'accepted-status' }; }],
  ['model authority infix', (candidate) => { candidate.evidence[0].modelAuthorityClaim = true; }],
  ['admission infix and approval suffix', (candidate) => { candidate.targetRef.isAdmissionApproved = true; }],
  ['authorization variant', (candidate) => { candidate.extra = { requestAuthorizationState: 'pending' }; }],
  ['punctuation and case', (candidate) => { candidate.proposedOperation.payload['MODEL-AUTHORITY.CLAIM'] = true; }],
  ['admit suffix', (candidate) => { candidate.extra = { shouldAdmit: true }; }],
];
for (const [name, mutate] of authorityCounterexamples) {
  const candidate = structuredClone(proposal);
  mutate(candidate);
  const errors = validateModelingProposal(candidate);
  assert.ok(
    errors.some((error) => ['authority-field-present', 'authority-shape-present'].includes(error.code)),
    `${name}: ${JSON.stringify(errors)}`,
  );
}

for (const benign of [
  { ...proposal, author: 'human-reviewer' },
  { ...proposal, review: { acceptanceCriteria: ['still not accepted authority'] } },
  { ...proposal, evidence: [...proposal.evidence, { nonAuthority: true, evidenceOnly: true }] },
  { ...proposal, proposedOperation: { ...proposal.proposedOperation, payload: { authoritativeSourceName: 'not authority token' } } },
]) {
  assert.deepEqual(validateModelingProposal(benign), []);
}

for (const [name, candidate, reason, path] of [
  ['payload Date', withPayload(new Date('2026-07-18T00:00:00Z')), 'non-plain-object', '/proposedOperation/payload/bad'],
  ['target Date', { ...proposal, targetRef: { ...proposal.targetRef, meta: new Date() } }, 'non-plain-object', '/targetRef/meta'],
  ['evidence Map', { ...proposal, evidence: [{ ...proposal.evidence[0], meta: new Map() }] }, 'non-plain-object', '/evidence/0/meta'],
  ['extra NaN', { ...proposal, extra: Number.NaN }, 'non-finite-number', '/extra'],
  ['negative zero', withPayload(-0), 'negative-zero', '/proposedOperation/payload/bad'],
  ['undefined', withPayload(undefined), 'undefined', '/proposedOperation/payload/bad'],
]) {
  assert.doesNotThrow(() => {
    const errors = validateModelingProposal(candidate);
    assert.ok(dataError(errors, reason, path), `${name}: ${JSON.stringify(errors)}`);
  });
}

{
  const sparse = [];
  sparse.length = 2;
  sparse[1] = 'present';
  assert.ok(dataError(validateModelingProposal(withPayload(sparse)), 'sparse-array-hole', '/proposedOperation/payload/bad/0'));
}

{
  const cycle = {};
  cycle.self = cycle;
  assert.ok(dataError(validateModelingProposal({ ...proposal, extra: cycle }), 'cycle', '/extra/self'));
}

{
  const nestedProxy = new Proxy({}, {
    ownKeys() { throw new Error('must not run'); },
  });
  const errors = validateModelingProposal({ ...proposal, extra: nestedProxy });
  assert.ok(dataError(errors, 'proxy-not-allowed', '/extra'));
}

{
  let reads = 0;
  const selfErasing = structuredClone(proposal);
  Object.defineProperty(selfErasing, 'kind', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      Object.defineProperty(selfErasing, 'kind', {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 'modeling.proposal.v1',
      });
      return 'modeling.proposal.v1';
    },
  });
  const errors = validateModelingProposal(selfErasing);
  assert.ok(dataError(errors, 'accessor-property', '/kind'), JSON.stringify(errors));
  assert.equal(reads, 0, 'self-erasing proposal getter must never execute');
}

{
  let reads = 0;
  const nestedAccessor = structuredClone(proposal);
  Object.defineProperty(nestedAccessor.targetRef, 'id', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return 'pkg:core';
    },
  });
  const errors = validateModelingProposal(nestedAccessor);
  assert.ok(dataError(errors, 'accessor-property', '/targetRef/id'), JSON.stringify(errors));
  assert.equal(reads, 0);
}

{
  const hidden = structuredClone(proposal);
  Object.defineProperty(hidden.evidence[0], 'hidden', {
    enumerable: false,
    value: 'not-json-visible',
  });
  assert.ok(dataError(validateModelingProposal(hidden), 'non-enumerable-property', '/evidence/0/hidden'));
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
  const deeplyNested = {};
  let cursor = deeplyNested;
  for (let index = 0; index < 20_000; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.doesNotThrow(() => validateModelingProposal({ ...proposal, extra: deeplyNested }));
}

console.log('hq modeling proposal schema check: PASS');
