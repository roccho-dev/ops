#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [carrierRootInput, jsonlInput, patternInput, baseInput, outputInput] = process.argv.slice(2);
assert.ok(carrierRootInput && jsonlInput && patternInput && baseInput && outputInput, 'usage: compile-url.mjs CARRIER_ROOT JSONL PATTERN BASE OUTPUT');
const carrierRoot = path.resolve(carrierRootInput);
const codec = await import(pathToFileURL(path.join(carrierRoot, 'dist/protocol/v3/codec.mjs')).href);
assert.ok(codec.SUPPORTED_PATTERNS.includes(patternInput), `unsupported preset ${patternInput}`);
const source = fs.readFileSync(jsonlInput, 'utf8');
const lines = source.split(/\r?\n/u).filter(line => line.trim().length > 0);
const records = lines.map((line, index) => {
  try { return JSON.parse(line); }
  catch (error) { throw new Error(`line ${index + 1}: ${error.message}`); }
});
const mapId = records.find(record => record?.type === 'meta')?.root ?? path.basename(jsonlInput, path.extname(jsonlInput));
const created = await codec.createDecisionLog(records, mapId);
const view = codec.defaultViewForPattern(patternInput);
const envelope = await codec.createEnvelope(created.log, null, view);
const appBase = new URL('app/', baseInput.endsWith('/') ? baseInput : `${baseInput}/`).href;
const url = await codec.createSmapUrl(envelope, appBase);
const decoded = await codec.readSmapHash(url);
assert.deepEqual(decoded.envelope, envelope, 'URL round-trip differs');
const receipt = {
  schema: 'mobile-agent-url-compile-receipt/1', status: 'PASS', authority: false,
  preset: patternInput, view, mapId, head: created.head, stateHash: created.stateHash,
  input: { bytes: Buffer.byteLength(source), sha256: `sha256:${crypto.createHash('sha256').update(source).digest('hex')}`, lines: lines.length },
  base: appBase, url, urlChars: url.length, roundTripExact: true,
  sourceCloneUsed: false, sourceBuildUsed: false, providerWriteUsed: false,
};
fs.writeFileSync(outputInput, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', preset: patternInput, urlChars: url.length }));
