#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDirectories, renderRelease } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const opsDefault = path.resolve(here, '../..');

function parseArgs(argv) {
  const values = {opsRoot: opsDefault, output: path.join(here, 'generated'), check: false};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--check') { values.check = true; continue; }
    if (!['--mobile', '--ui', '--ops', '--out'].includes(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`missing value for ${key}`);
    if (key === '--mobile') values.mobileRoot = path.resolve(value);
    if (key === '--ui') values.uiRoot = path.resolve(value);
    if (key === '--ops') values.opsRoot = path.resolve(value);
    if (key === '--out') values.output = path.resolve(value);
    index += 1;
  }
  if (!values.mobileRoot || !values.uiRoot) throw new Error('--mobile and --ui are required');
  return values;
}

const args = parseArgs(process.argv.slice(2));
if (args.check) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'release-intent-'));
  try {
    const result = renderRelease({...args, output: temporary});
    compareDirectories(args.output, temporary);
    console.log(JSON.stringify({schema: 'roccho.release-intent-projection-check/2', status: 'PASS', ...result.summary}));
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
} else {
  const result = renderRelease(args);
  console.log(JSON.stringify(result.summary));
}
