#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  proposalDigest,
  validateModelingProposal,
} from '../lib/modeling-proposal.mjs';
import { promoteProposalToModelQueue } from '../lib/promotion-gate.mjs';
import { validateRecord } from '../lib/queue-validator.mjs';

const proposal = {
  kind: 'modeling.proposal.v1',
  id: 'proposal_authority_vocabulary',
  sourceAgentTaskId: 'aq_authority_vocabulary',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  proposedOperation: {
    op: 'addEdge',
    payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  },
  evidence: [{ kind: 'digest', value: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  acceptanceCriteria: ['authority vocabulary must fail closed without rejecting unrelated engineering data'],
  status: 'proposed',
};

const queueRow = {
  kind: 'hq.modelCommitQueued.v1',
  id: 'mq_authority_vocabulary',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  op: 'addEdge',
  payload: { from: 'pkg:core', to: 'pkg:ui', type: 'uses' },
  reason: 'direct human model intent',
  confirmedBy: 'human-review',
  origin: {
    kind: 'direct-human.v1',
    confirmationId: 'confirmation:mq_authority_vocabulary',
    confirmedBy: 'human-review',
  },
};

function hasAuthorityError(errors) {
  return errors.some((error) => [
    'authority-field-present',
    'authority-shape-present',
  ].includes(error.code));
}

const bypasses = [
  ['modelAuthoritativeClaim', (record) => { record.extra = { modelAuthoritativeClaim: true }; }],
  ['isAuthorized', (record) => { record.extra = { isAuthorized: true }; }],
  ['isAuthorised', (record) => { record.extra = { isAuthorised: true }; }],
  ['authorized kind', (record) => { record.extra = { kind: 'hq.authorizedRow.v1' }; }],
  ['authorised kind', (record) => { record.extra = { kind: 'hq.authorisedRow.v1' }; }],
  ['broader authoritative name', (record) => { record.extra = { modelAuthoritativeSourceName: 'forged' }; }],
  ['hyphen authoritative source alias', (record) => { record.extra = { 'authoritative-source-name': 'catalog' }; }],
  ['dot authoritative source alias', (record) => { record.extra = { 'authoritative.source.name': 'catalog' }; }],
  ['upper snake authoritative source alias', (record) => { record.extra = { AUTHORITATIVE_SOURCE_NAME: 'catalog' }; }],
  ['capital camel authoritative source alias', (record) => { record.extra = { AuthoritativeSourceName: 'catalog' }; }],
  ['fused authoritative source alias', (record) => { record.extra = { authoritativesourcename: 'catalog' }; }],
  ['upper fused authoritative source alias', (record) => { record.extra = { AUTHORITATIVESOURCENAME: 'catalog' }; }],
  ['hyphen nonAuthority alias', (record) => { record.extra = { 'non-authority': true }; }],
  ['dot nonAuthority alias', (record) => { record.extra = { 'non.authority': true }; }],
  ['upper snake nonAuthority alias', (record) => { record.extra = { NON_AUTHORITY: true }; }],
  ['capital camel nonAuthority alias', (record) => { record.extra = { NonAuthority: true }; }],
  ['fused nonAuthority alias', (record) => { record.extra = { nonauthority: true }; }],
  ['upper fused nonAuthority alias', (record) => { record.extra = { NONAUTHORITY: true }; }],
];

for (const [name, mutate] of bypasses) {
  const proposalCandidate = structuredClone(proposal);
  mutate(proposalCandidate);
  const proposalErrors = validateModelingProposal(proposalCandidate);
  assert.ok(hasAuthorityError(proposalErrors), `${name} proposal bypass: ${JSON.stringify(proposalErrors)}`);

  const promotion = promoteProposalToModelQueue(proposalCandidate, {
    confirm: true,
    confirmedBy: 'human-review',
    proposalDigest: proposalDigest(proposalCandidate),
  });
  assert.equal(promotion.ok, false, `${name} promotion must reject`);
  assert.ok(hasAuthorityError(promotion.errors), `${name} promotion bypass: ${JSON.stringify(promotion.errors)}`);

  const queueCandidate = structuredClone(queueRow);
  mutate(queueCandidate);
  const queueErrors = validateRecord(queueCandidate);
  assert.ok(hasAuthorityError(queueErrors), `${name} queue bypass: ${JSON.stringify(queueErrors)}`);
}

const benignProposal = structuredClone(proposal);
benignProposal.proposedOperation.payload.admittanceOhms = 50;
benignProposal.proposedOperation.payload.authoritativeSourceName = 'catalog';
benignProposal.proposedOperation.payload.nonAuthority = true;
assert.deepEqual(validateModelingProposal(benignProposal), []);

const benignQueue = structuredClone(queueRow);
benignQueue.payload.admittanceOhms = 50;
benignQueue.payload.authoritativeSourceName = 'catalog';
benignQueue.payload.nonAuthority = true;
assert.deepEqual(validateRecord(benignQueue), []);

const promotedBenign = promoteProposalToModelQueue(benignProposal, {
  confirm: true,
  confirmedBy: 'human-review',
  proposalDigest: proposalDigest(benignProposal),
});
assert.equal(promotedBenign.ok, true, JSON.stringify(promotedBenign.errors));
assert.equal(promotedBenign.queueRow.payload.admittanceOhms, 50);
assert.equal(promotedBenign.queueRow.payload.authoritativeSourceName, 'catalog');
assert.equal(promotedBenign.queueRow.payload.nonAuthority, true);

console.log('hq authority vocabulary boundary check: PASS');
