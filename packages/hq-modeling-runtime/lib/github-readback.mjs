import { sha256Digest } from './digest.mjs';
import { forbiddenAuthorityFields } from './queue-schema.mjs';

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
    if ((forbiddenAuthorityFields.includes(key) || key === 'canonical' || key === 'ssotWrite') && nested !== false) {
      found.push([...path, key].join('.'));
    }
    found.push(...findForbiddenAuthorityFields(nested, [...path, key]));
  }
  return found;
}

export function extractJsonlFencedBlocks(markdown) {
  const body = typeof markdown === 'string' ? markdown : '';
  const blocks = [];
  const pattern = /```(?:jsonl|ndjson)\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

export function parseJsonlBlock(block) {
  const records = [];
  const errors = [];
  const lines = String(block || '').split(/\r?\n/);
  lines.forEach((lineText, index) => {
    const line = index + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) {
      return;
    }
    try {
      const record = JSON.parse(trimmed);
      records.push(record);
      for (const fieldPath of findForbiddenAuthorityFields(record)) {
        errors.push({ code: 'authority-field-present', line, fieldPath, message: `authority field is prohibited: ${fieldPath}` });
      }
    } catch (error) {
      errors.push({ code: 'invalid-jsonl', line, message: error.message });
    }
  });
  return { ok: errors.length === 0, records, errors, recordCount: records.length };
}

export function buildGithubReadbackEvidence({
  body = '',
  source = {},
  expectedDigest,
} = {}) {
  const blocks = extractJsonlFencedBlocks(body);
  const parsedBlocks = blocks.map(parseJsonlBlock);
  const records = parsedBlocks.flatMap((block) => block.records);
  const parseErrors = parsedBlocks.flatMap((block, blockIndex) => block.errors.map((error) => ({ ...error, block: blockIndex + 1 })));
  const observedDigest = sha256Digest({ source, blocks, records });
  const errors = [...parseErrors];
  if (blocks.length === 0) {
    errors.push({ code: 'missing-jsonl-block', message: 'no jsonl fenced block found' });
  }
  if (expectedDigest && expectedDigest !== observedDigest) {
    errors.push({ code: 'readback-digest-mismatch', message: 'observed digest changed from expected digest', expected: expectedDigest, observed: observedDigest });
  }

  const evidence = {
    kind: 'hq.githubIssueCommentReadback.evidence.v1',
    source: {
      repo: source.repo || null,
      issue: source.issue || null,
      commentId: source.commentId || null,
      url: source.url || null,
      author: source.author || null,
    },
    blockCount: blocks.length,
    recordCount: records.length,
    parseOk: errors.length === 0,
    observedDigest,
    records,
    authority: false,
    evidenceOnly: true,
  };

  return {
    ok: errors.length === 0,
    evidence,
    errors,
  };
}
