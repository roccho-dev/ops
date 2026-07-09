#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildGithubReadbackEvidence,
  extractJsonlFencedBlocks,
  parseJsonlBlock,
} from '../lib/github-readback.mjs';

const body = [
  'discussion text',
  '```jsonl',
  '{"kind":"knowledge.v1","id":"k1","status":"observed"}',
  '{"kind":"receipt.v1","id":"r1","status":"readback"}',
  '```',
].join('\n');

assert.equal(extractJsonlFencedBlocks(body).length, 1);
const parsed = parseJsonlBlock(extractJsonlFencedBlocks(body)[0]);
assert.equal(parsed.ok, true);
assert.equal(parsed.recordCount, 2);

const valid = buildGithubReadbackEvidence({
  body,
  source: {
    repo: 'roccho-dev/ops',
    issue: 66,
    commentId: 4921966145,
    url: 'https://github.com/roccho-dev/ops/issues/66#issuecomment-4921966145',
    author: 'roccho-dev',
  },
});
assert.equal(valid.ok, true);
assert.equal(valid.evidence.kind, 'hq.githubIssueCommentReadback.evidence.v1');
assert.equal(valid.evidence.recordCount, 2);
assert.equal(valid.evidence.authority, false);
assert.equal(valid.evidence.evidenceOnly, true);
assert.match(valid.evidence.observedDigest, /^sha256:/);

const malformed = buildGithubReadbackEvidence({
  body: ['```jsonl', '{"kind":"bad"', '```'].join('\n'),
});
assert.equal(malformed.ok, false);
assert.ok(malformed.errors.some((error) => error.code === 'invalid-jsonl'));

const missingBlock = buildGithubReadbackEvidence({ body: 'no jsonl here' });
assert.equal(missingBlock.ok, false);
assert.ok(missingBlock.errors.some((error) => error.code === 'missing-jsonl-block'));

const digestMismatch = buildGithubReadbackEvidence({ body, expectedDigest: 'sha256:old' });
assert.equal(digestMismatch.ok, false);
assert.ok(digestMismatch.errors.some((error) => error.code === 'readback-digest-mismatch'));

const authorityClaim = buildGithubReadbackEvidence({
  body: ['```jsonl', '{"kind":"knowledge.v1","id":"k1","authority":true}', '```'].join('\n'),
});
assert.equal(authorityClaim.ok, false);
assert.ok(authorityClaim.errors.some((error) => error.code === 'authority-field-present'));

console.log('hq GitHub issue-comment readback boundary check: PASS');
