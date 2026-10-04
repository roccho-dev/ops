#!/usr/bin/env node
import fs from 'node:fs';
import { semcmp } from '../semcmp.mjs';
import { askJev } from '../../jev-review/jev.mjs';

const inputErrors = new Set(['INVALID_QUERY', 'INVALID_PROPOSALS', 'DUPLICATE_PROPOSAL_ID']);
async function main() {
  if (process.argv.length !== 2) throw new Error('INVALID_ARGUMENTS');
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { throw new Error('INVALID_INPUT'); }
  if (!input || Array.isArray(input) || typeof input !== 'object'
    || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'query')
    || !Object.hasOwn(input, 'proposals')) throw new Error('INVALID_INPUT');
  const result = await semcmp(input.query, {
    propose: () => input.proposals,
    ask: (state, questions) => askJev(state, questions, {
      key: process.env.JEV_API_KEY,
      endpoint: process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone',
      timeoutMs: Number(process.env.JEV_TIMEOUT_MS || '15000'),
    }),
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((error) => {
  const code = inputErrors.has(error?.message) || ['INVALID_ARGUMENTS', 'INVALID_INPUT',
    'JEV_API_KEY_REQUIRED', 'INVALID_TIMEOUT'].includes(error?.message) ? error.message : 'JEV_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
});
