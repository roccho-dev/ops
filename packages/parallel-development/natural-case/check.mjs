import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { driftDigest, reviewContractDrift } from '../contract-drift-shadow.mjs';
import { PHASES } from '../phases.mjs';
import { validateJevBudget } from '../../jev-review/core.mjs';

// One frozen evidence case, not a provider runner or a semantic oracle.
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const rawText = read('raws.jsonl');
assert.equal(driftDigest(rawText), 'sha256:201d15d17f74fa95fa56072e25222831cece4efeaf34c5c8d139e0d7ecd4ef31');
const rows = rawText.trimEnd().split('\n').map(JSON.parse);
assert.equal(rows.length, 8);
const one = (kind) => { const found = rows.filter((r) => r.kind === kind); assert.equal(found.length, 1); return found[0]; };
const target = one('case'), acceptance = one('acceptance-readback'), change = one('change-readback');
const projection = one('projection'), question = one('question-contract'), ceiling = one('claim-ceiling');
const inputText = read('input.json'), input = JSON.parse(inputText);
assert.equal(driftDigest(inputText), target.inputDigest);
assert.equal(projection.digest, target.inputDigest);
assert.equal(target.id, 'ops-pr420-readme-01');
assert.ok(Object.values(target.authority).every((value) => value === 0));
assert.equal(target.providerRequests, 0);
assert.equal(target.providerResponses, 0);
assert.equal(target.jevFindings, 0);
assert.equal(target.independentComparison, 'NOT_RUN');
assert.equal(ceiling.reviewBoundary.state, 'NOT_RUN');
const source = rows.filter((r) => r.kind === 'source-readback');
assert.equal(source.length, 2);
for (const row of source) {
  const bytes = Buffer.from(read(row.file));
  assert.equal(bytes.length, row.bytes);
  assert.equal(driftDigest(bytes), row.digest);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.gitBlob);
  assert.equal(row.path, target.sourcePath);
  assert.equal(row.complete, true);
}
assert.equal(input.contractRef, source[0].url);
assert.equal(source[0].ref, target.base);
assert.equal(source[1].ref, target.head);
assert.equal(input.contract.goal, read('contract.md'));
assert.equal(input.change.implementation, read('change.md'));
assert.deepEqual(input.contract.acceptance, read('contract.md').trimEnd().split('\n\n').slice(-2));
for (const phrase of [...input.contract.in, ...input.contract.out]) assert.ok(read('contract.md').includes(phrase));
assert.equal(input.acceptanceRef, acceptance.exactEventUrl);
assert.equal(acceptance.response.event, 'merged');
assert.equal(acceptance.response.id, 31712461544);
assert.equal(acceptance.response.actor.login, 'roccho-dev');
assert.equal(acceptance.response.commit_id, target.base);
assert.equal(acceptance.prReadback.merge_commit_sha, target.base);
assert.equal(acceptance.prReadback.base, 'proposals');
assert.equal(acceptance.prReadback.merged, true);
assert.equal(input.changeRef, change.url);
assert.equal(change.url, `https://github.com/${target.repository}/compare/${target.base}...${target.head}`);
assert.equal(change.mergeBase, target.base);
assert.equal(change.files.length, 1);
assert.deepEqual(input.change.changed_scope, change.files.map((row) => row.filename));
assert.equal(driftDigest(change.diff), change.diffDigest);
for (const row of question.implementation) {
  assert.equal(driftDigest(fs.readFileSync(new URL(`../../../${row.path}`, import.meta.url))), row.digest);
}
// Stop at the existing injected boundary, before askJev or any transport/response.
let captures = 0;
const result = await reviewContractDrift(inputText, target.inputDigest, async () => {
  captures++; throw new Error('PROVIDER_NOT_RUN');
});
assert.equal(captures, 1);
assert.equal(result.status, 'UNKNOWN');
assert.equal(result.reason, 'PROVIDER_NOT_RUN');
assert.equal(result.observedResponses, 0);
assert.deepEqual(result.ranked, []);
assert.equal(result.exchange.response, null);
assert.equal(result.stateDigest, question.stateDigest);
assert.equal(result.exchange.requestDigest, question.requestDigest);
assert.equal(result.exchange.request.model, question.model);
assert.deepEqual(result.exchange.request.questions, question.questions);
assert.equal(driftDigest(JSON.stringify(question.questions)), question.questionsDigest);
assert.deepEqual(question.themes, PHASES.pr.map(([theme]) => theme));
assert.equal(Object.keys(question.questions).length, 6);
assert.deepEqual(validateJevBudget(result.exchange.request.state, question.questions), question.budget);
console.log(JSON.stringify({ suite: 'contract-drift-natural-case', status: 'PASS', scope: 'offline-frozen-input-integrity',
  caseId: target.id, inputDigest: target.inputDigest, requestDigest: question.requestDigest,
  providerRequests: 0, generatedFindings: 0, independentComparison: 'NOT_RUN' }));
