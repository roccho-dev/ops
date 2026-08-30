import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const [uiRootInput, outputRootInput] = process.argv.slice(2);
if (!uiRootInput || !outputRootInput) {
  throw new Error('usage: node build-approved-ui.mjs <ui-root> <output-root>');
}
const uiRoot = path.resolve(uiRootInput);
const outputRoot = path.resolve(outputRootInput);
const uiCommit = process.env.UI_COMMIT;
if (!/^[0-9a-f]{40}$/u.test(uiCommit || '')) throw new Error('UI_COMMIT must be an exact commit SHA');

const inputPath = path.join(root, 'input', 'map-state.jsonl');
const proposalConnectPath = path.join(root, 'src', 'proposal-connect.mjs');
const connectabilityPath = path.join(uiRoot, 'packages', 'connectability', 'src', 'index.mjs');
const generatorPath = path.join(uiRoot, 'packages', 'semantic-map', 'scripts', 'build-browser-example.mjs');
const protocolPath = path.join(uiRoot, 'packages', 'semantic-map', 'protocol', 'index.js');
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const inputBytes = await fs.readFile(inputPath);
const records = inputBytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
const ids = new Set(records.filter(record => record.type === 'region').map(record => record.id));
for (const required of ['repo:adrs', 'repo:governance', 'repo:ops', 'pkg.adrs318.canary']) {
  if (!ids.has(required)) throw new Error(`approved map input is missing ${required}`);
}

const { createDecisionLog, createEnvelope } = await import(pathToFileURL(protocolPath).href);
const created = await createDecisionLog(records, 'semantic-map:adrs-governance-ops-package-map');
const envelope = await createEnvelope(created.log, null, { pattern: 'map/1' });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'approved-semantic-map-'));
try {
  const envelopePath = path.join(temporary, 'envelope.json');
  await fs.writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  const generated = spawnSync(process.execPath, [
    generatorPath,
    `--input=${envelopePath}`,
    `--out=${outputRoot}`,
  ], { cwd: uiRoot, encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout || 'Semantic Map generation failed');

  const connectabilityBytes = await fs.readFile(connectabilityPath);
  const proposalConnectBytes = await fs.readFile(proposalConnectPath);
  await fs.writeFile(path.join(outputRoot, 'connectability.mjs'), connectabilityBytes);
  await fs.writeFile(path.join(outputRoot, 'proposal-connect.mjs'), proposalConnectBytes);

  const indexPath = path.join(outputRoot, 'index.html');
  let html = await fs.readFile(indexPath, 'utf8');
  if (!html.includes('<title>Semantic Map</title>')) throw new Error('generated artifact is not the approved Semantic Map');
  if (!html.includes('map/1')) throw new Error('generated artifact does not contain map/1');
  if (!html.includes('pkg.adrs318.canary')) throw new Error('generated artifact does not contain the proposal canary package');
  if (html.includes('ADRS UI Proposal Canary') || html.includes('固定canary変更')) {
    throw new Error('retired fixed-form UI leaked into the approved artifact');
  }
  html = html.replace(
    '<title>Semantic Map</title>',
    `<title>Semantic Map</title>\n<meta name="semantic-map-ui-commit" content="${uiCommit}">`,
  );
  const marker = '</body>';
  if ((html.split(marker).length - 1) !== 1) throw new Error('generated Semantic Map body marker is not unique');
  html = html.replace(marker, `  <script type="module" src="/proposal-connect.mjs"></script>\n${marker}`);
  const htmlBytes = Buffer.from(html.endsWith('\n') ? html : `${html}\n`);
  await fs.writeFile(indexPath, htmlBytes);

  const generatedReceipt = JSON.parse(await fs.readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
  const receipt = {
    schema: 'ops.approvedSemanticMapBuild/1',
    status: 'PASS',
    uiCommit,
    uiGenerator: 'packages/semantic-map/scripts/build-browser-example.mjs',
    uiConnectability: 'packages/connectability/src/index.mjs',
    pattern: 'map/1',
    input: { path: 'input/map-state.jsonl', bytes: inputBytes.byteLength, sha256: sha256(inputBytes) },
    output: { path: 'public/index.html', bytes: htmlBytes.byteLength, sha256: sha256(htmlBytes) },
    connectability: { path: 'public/connectability.mjs', bytes: connectabilityBytes.byteLength, sha256: sha256(connectabilityBytes) },
    consumer: { path: 'public/proposal-connect.mjs', bytes: proposalConnectBytes.byteLength, sha256: sha256(proposalConnectBytes) },
    upstreamBuild: generatedReceipt,
    requiredRegionIds: ['repo:adrs', 'repo:governance', 'repo:ops', 'pkg.adrs318.canary'],
    retiredFixedFormPresent: false,
    generatedArtifactsAreAuthority: false,
    cutover: false,
  };
  await fs.writeFile(path.join(outputRoot, 'approved-ui-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
