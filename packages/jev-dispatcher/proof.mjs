#!/usr/bin/env node
// Structural evidence coverage is not an independent review or an authority grant.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest } from './query.mjs';
export const required = Object.freeze(['K01','K02','K03','K04','K05','K06','K07','K08','K09','K10']);
const bindingKeys = ['source_commit', 'policy_commit', 'implementation_sha256', 'artifact_sha256', 'surface', 'model'];
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const validBinding = b => object(b) && bindingKeys.every(k => typeof b[k] === 'string' && b[k]) &&
  /^[a-f0-9]{40}$/.test(b.source_commit) && /^[a-f0-9]{40}$/.test(b.policy_commit) &&
  /^[a-f0-9]{64}$/.test(b.implementation_sha256) && /^[a-f0-9]{64}$/.test(b.artifact_sha256);
export function assessEvidence(expected, records) {
  if (!validBinding(expected) || !Array.isArray(records) || !records.every(object)) throw new Error('invalid evidence input');
  const duplicate = new Set(records.filter((r, i) => records.findIndex(x => x.id === r.id) !== i).map(r => r.id));
  const checks = required.map(id => {
    const r = records.find(r => r.id === id);
    let reason = !r ? 'missing' : duplicate.has(id) ? 'duplicate' : r.status !== 'PASS' ? 'not_passed' :
      r.layer !== 'real' ? 'not_real_evidence' : !validBinding(r.binding) || bindingKeys.some(k => r.binding[k] !== expected[k]) ? 'identity_mismatch' :
      !Array.isArray(r.references) || r.references.length === 0 || !r.references.every(x => object(x) &&
        typeof x.ref === 'string' && x.ref.length > 0 && /^[a-f0-9]{64}$/.test(x.sha256)) ? 'missing_references' :
      !object(r.review) || r.review.creator === r.review.reviewer || !r.review.creator || !r.review.reviewer ? 'review_not_separate' : null;
    return { id, status: reason ? 'INCOMPLETE' : 'REFERENCED', ...(reason ? { reason } : {}) };
  });
  const unknown = records.some(r => !required.includes(r.id));
  return { kind: 'dispatcher.query.evidence-coverage', authority: false,
    status: !unknown && checks.every(x => x.status === 'REFERENCED') ? 'READY_FOR_INDEPENDENT_REVIEW' : 'INCOMPLETE',
    binding: expected, checks, unknown_items: unknown, references_sha256: digest(records),
    claim_limit: 'Reference structure only. Verify referenced bytes, review provenance, real execution and adopted completion separately. This output never declares D complete.' };
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 4) throw new Error('usage: proof.mjs EXPECTED.json EVIDENCE.jsonl');
    const expected = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const records = readFileSync(process.argv[3], 'utf8').split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
    const report = assessEvidence(expected, records);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.status !== 'READY_FOR_INDEPENDENT_REVIEW') process.exitCode = 2;
  } catch {
    process.stdout.write(JSON.stringify({ kind: 'dispatcher.query.evidence-coverage', authority: false, status: 'INCOMPLETE', reason: 'invalid_input' }) + '\n');
    process.exitCode = 2;
  }
}
