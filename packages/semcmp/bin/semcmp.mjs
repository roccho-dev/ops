#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { semcmp } from '../semcmp.mjs';
import { askJev } from '../../jev-review/jev.mjs';

const inputErrors = new Set(['INVALID_QUERY', 'INVALID_PROPOSALS', 'DUPLICATE_PROPOSAL_ID']);
async function main() {
  // No flag: the supplied {query, proposals} envelope. --propose: a configured module's propose(query).
  const args = process.argv.slice(2);
  const module = args.length === 2 && args[0] === '--propose' && path.isAbsolute(args[1]) ? args[1] : null;
  if (args.length !== 0 && !module) throw new Error('INVALID_ARGUMENTS');
  const keys = module ? ['query'] : ['query', 'proposals'];
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { throw new Error('INVALID_INPUT'); }
  if (!input || Array.isArray(input) || typeof input !== 'object'
    || Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))) throw new Error('INVALID_INPUT');
  let propose = () => input.proposals;
  if (module) {
    try { ({ propose } = await import(pathToFileURL(module).href)); }
    catch { throw new Error('INVALID_PROPOSER'); }
    if (typeof propose !== 'function') throw new Error('INVALID_PROPOSER');
  }
  const result = await semcmp(input.query, {
    propose,
    ask: (state, questions) => askJev(state, questions, {
      key: process.env.JEV_API_KEY,
      endpoint: process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone',
      timeoutMs: Number(process.env.JEV_TIMEOUT_MS || '15000'),
    }),
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((error) => {
  const code = inputErrors.has(error?.message) || ['INVALID_ARGUMENTS', 'INVALID_INPUT', 'INVALID_PROPOSER',
    'PROPOSE_FAILED', 'JEV_API_KEY_REQUIRED', 'INVALID_TIMEOUT'].includes(error?.message) ? error.message : 'JEV_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
});
