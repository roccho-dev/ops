#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runAdmissionGateJsonl } from '../lib/admission-gate.mjs';
import { runLocalWorkerJsonl } from '../lib/local-worker.mjs';
import { runLocalWorkerWithReceiptsJsonl } from '../lib/receipt-writer.mjs';
import { validateJsonl } from '../lib/queue-validator.mjs';

const agent = {
  kind: 'hq.agentTaskQueued.v1',
  id: 'aq_agent_001',
  status: 'queued',
  targetRef: { kind: 'repoMap.node', id: 'pkg:core' },
  goal: 'inspect whether a repo-map edge should be proposed',
  context: ['repoMap.projection.v1'],
  acceptance: ['emit modeling proposal only', 'do not write accepted ledger'],
  confirmedBy: 'human',
};

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

{
  const validation = validateJsonl(JSON.stringify(agent));
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
}

{
  const worker = runLocalWorkerJsonl(JSON.stringify(agent));
  assert.equal(worker.ok, true, JSON.stringify(worker.errors));
  assert.equal(worker.processed, 0, 'agent task must not become processed model output');
  assert.equal(worker.pending, 1, 'agent task must become pending local task state');
  assert.equal(worker.failed, 0);
  assert.equal(worker.state.modelOperations.length, 0);
  assert.equal(worker.state.agentTasks.length, 1);
  assert.equal(worker.state.agentTasks[0].kind, 'hq.localAgentTask.v1');
  assert.equal(worker.state.agentTasks[0].status, 'pending');
  assert.equal(worker.state.agentTasks[0].queueId, agent.id);
}

{
  const withReceipts = runLocalWorkerWithReceiptsJsonl(JSON.stringify(agent));
  assert.equal(withReceipts.ok, true, JSON.stringify(withReceipts.worker.errors));
  assert.equal(withReceipts.receipts, 1);
  assert.equal(withReceipts.receiptRows[0].kind, 'hq.receipt.v1');
  assert.equal(withReceipts.receiptRows[0].status, 'pending');
  assert.equal(withReceipts.receiptRows[0].queueId, agent.id);
  assert.equal(withReceipts.receiptRows[0].outputKind, 'hq.localAgentTask.v1');
  assert.equal(withReceipts.receiptRows[0].evidenceOnly, true);
  assert.ok(!('accepted' in withReceipts.receiptRows[0]));
  assert.ok(!('acceptedLedger' in withReceipts.receiptRows[0]));
}

{
  const admission = runAdmissionGateJsonl(JSON.stringify(agent));
  assert.equal(admission.ok, false, 'agent task must not pass admission');
  assert.equal(admission.admitted, 0);
  assert.equal(admission.rejected, 1);
  assert.equal(admission.acceptedRows.length, 0);
  assert.ok(errorCodes(admission).includes('not-admissible-kind'));
  assert.equal(admission.admissionReceipts[0].status, 'rejected');
  assert.equal(admission.admissionReceipts[0].queueKind, 'hq.agentTaskQueued.v1');
}

{
  const bad = { ...agent, approved: true };
  const validation = validateJsonl(JSON.stringify(bad));
  assert.equal(validation.ok, false);
  assert.ok(errorCodes(validation).includes('authority-field-present'));

  const worker = runLocalWorkerJsonl(JSON.stringify(bad));
  assert.equal(worker.ok, false);
  assert.equal(worker.state.agentTasks.length, 0);
  assert.ok(errorCodes(worker).includes('authority-field-present'));
}

console.log('hq agent task runtime boundary check: PASS');
