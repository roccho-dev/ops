#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distInput, manifestInput, baseInput, outputInput] = process.argv.slice(2);
assert.ok(distInput && manifestInput && baseInput && outputInput, 'usage: generate-urls.mjs DIST MANIFEST BASE OUTPUT');
const dist = path.resolve(distInput);
const manifestPath = path.resolve(manifestInput);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schema, 'ops.mobileAgentPresetApp/1');
const codec = await import(pathToFileURL(path.join(dist, 'protocol/v3/codec.mjs')).href);
const digest = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const generated = [];
for (const item of manifest.fixtures) {
  const fixturePath = path.resolve(path.dirname(manifestPath), item.path);
  const bytes = fs.readFileSync(fixturePath);
  assert.equal(digest(bytes), item.sha256, `${item.id}: fixture digest`);
  const lines = bytes.toString('utf8').split(/\r?\n/u).filter(line => line.length > 0);
  const records = lines.map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${item.id}: line ${index + 1}: ${error.message}`); }
  });
  const created = await codec.createDecisionLog(records, `mobile-agent-preset:${item.id}`);
  const envelope = await codec.createEnvelope(created.log, null, item.view);
  const url = await codec.createSmapUrl(envelope, new URL('app', baseInput).href);
  const decoded = await codec.readSmapHash(url);
  assert.deepEqual(decoded.envelope, envelope, `${item.id}: URL round-trip`);
  assert.equal(decoded.envelope.view.pattern, item.view.pattern);
  generated.push(Object.freeze({ ...item, url, urlLength: url.length, envelope }));
}
const output = Object.freeze({ schema: 'ops.mobileAgentPresetUrls/1', authority: false, base: baseInput, cases: generated });
fs.writeFileSync(outputInput, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', cases: generated.map(({id, view, urlLength}) => ({id, pattern:view.pattern, urlLength})) }));
