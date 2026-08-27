#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(process.argv[2] ?? join(here, 'source.json'));
const outDir = resolve(process.argv[3] ?? join(here, 'dist'));
const siteDir = join(here, 'site');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonical(value) {
  return `${JSON.stringify(stable(value))}\n`;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function copyText(name) {
  const bytes = await readFile(join(siteDir, name));
  await writeFile(join(outDir, name), bytes);
  return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (source.schema !== 'ops.govJsonRuntimeSource/1') throw new Error('unsupported source contract');
if (source.claim_ceiling !== 'PR_CANDIDATE_GREEN' || source.authority !== false) throw new Error('invalid claim boundary');
if (!Array.isArray(source.assets) || source.assets.length < 1) throw new Error('assets required');

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'data'), { recursive: true });

const mirrored = [];
for (const asset of source.assets) {
  if (!Number.isInteger(asset.asset_id) || typeof asset.name !== 'string') throw new Error('invalid asset identity');
  const apiUrl = `https://api.github.com/repos/${source.source.repository}/releases/assets/${asset.asset_id}`;
  const response = await fetch(apiUrl, {
    redirect: 'follow',
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'roccho-ops-adrs318-gov-json-runtime',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`asset ${asset.asset_id} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (bytes.length !== asset.bytes) throw new Error(`${asset.name}: byte mismatch ${bytes.length} != ${asset.bytes}`);
  if (actual !== asset.sha256) throw new Error(`${asset.name}: digest mismatch ${actual} != ${asset.sha256}`);
  JSON.parse(bytes.toString('utf8'));
  const rel = `data/${basename(asset.name)}`;
  await writeFile(join(outDir, rel), bytes);
  mirrored.push({
    role: asset.role,
    name: asset.name,
    path: rel,
    bytes: bytes.length,
    sha256: actual,
    source_asset_id: asset.asset_id,
    source_api_url: apiUrl,
  });
}

const staticFiles = [];
for (const name of ['index.html', 'app.mjs', 'style.css']) staticFiles.push(await copyText(name));

const current = {
  schema: 'ops.govJsonRuntimeCurrent/1',
  claim_ceiling: source.claim_ceiling,
  authority: false,
  source: source.source,
  view_contract: source.view.contract,
  view_reduce: source.view.reduce,
  semantic_reduce: false,
  assets: mirrored,
  assertions: {
    exact_release_asset_ids: true,
    source_bytes_verified: true,
    byte_identical_same_origin_mirror: true,
    production_package_contract: false,
    authenticated_ui: false,
    provider_e2e: false,
    authority_changed: false,
    cutover: false,
  },
};
const currentBytes = Buffer.from(canonical(current));
await writeFile(join(outDir, 'current.json'), currentBytes);

const headers = `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\n\n/current.json\n  Cache-Control: no-store\n\n/data/*\n  Cache-Control: public, max-age=31536000, immutable\n`;
await writeFile(join(outDir, '_headers'), headers);

const receipt = {
  schema: 'ops.govJsonRuntimeMaterializeReceipt/1',
  status: 'PASS',
  claim_ceiling: 'PR_CANDIDATE_GREEN',
  authority: false,
  source_contract: { path: basename(sourcePath), sha256: sha256(await readFile(sourcePath)) },
  source_release: source.source,
  mirrored_assets: mirrored,
  current: { path: 'current.json', bytes: currentBytes.length, sha256: sha256(currentBytes) },
  static_files: staticFiles,
  boundary: {
    semantic_reduce: false,
    html_generated_per_update: false,
    authenticated_ui: false,
    provider_e2e: false,
    authority_changed: false,
    cutover: false,
  },
};
await writeFile(join(outDir, 'materialize-receipt.json'), canonical(receipt));
console.log(canonical(receipt).trim());
