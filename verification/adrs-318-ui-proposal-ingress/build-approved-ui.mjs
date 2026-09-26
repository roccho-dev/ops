import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const opsRoot = path.resolve(root, '..', '..');
const [uiRootInput, outputRootInput] = process.argv.slice(2);
if (!uiRootInput || !outputRootInput) {
  throw new Error('usage: node build-approved-ui.mjs <ui-root> <output-root>');
}
const uiRoot = path.resolve(uiRootInput);
const outputRoot = path.resolve(outputRootInput);
const uiCommit = process.env.UI_COMMIT;
const candidateSha = process.env.CANDIDATE_SHA;
if (!/^[0-9a-f]{40}$/u.test(uiCommit || '')) throw new Error('UI_COMMIT must be an exact commit SHA');
if (!/^[0-9a-f]{40}$/u.test(candidateSha || '')) throw new Error('CANDIDATE_SHA must be an exact commit SHA');

const sourcePath = path.join(root, 'input', 'current-organization.jsonl');
const projectorPath = path.join(root, 'project-current-organization.mjs');
const proposalConnectPath = path.join(root, 'src', 'proposal-connect.mjs');
const connectabilityPath = path.join(uiRoot, 'packages', 'connectability', 'src', 'index.mjs');
const generatorPath = path.join(uiRoot, 'packages', 'semantic-map', 'scripts', 'build-browser-example.mjs');
const protocolPath = path.join(uiRoot, 'packages', 'semantic-map', 'protocol', 'index.js');
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const canonical = value => JSON.stringify(value, Object.keys(value).sort());

const sourceBytes = await fs.readFile(sourcePath);
if (sourceBytes.includes(Buffer.from('\r'))) throw new Error('current organization source must use LF');
const sourceRows = sourceBytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const { projectCurrentOrganization, recordsToJSONL } = await import(pathToFileURL(projectorPath).href);
const projected = await projectCurrentOrganization({
  sourceRows,
  opsRoot,
  uiRoot,
  revisions: { CANDIDATE_SHA: candidateSha, UI_COMMIT: uiCommit },
});
const records = [...projected.records];
const projectedBytes = Buffer.from(recordsToJSONL(records));
const ids = new Set(records.filter(record => record.type === 'region').map(record => record.id));
const requiredRegionIds = [
  'repo:adrs',
  'repo:governance',
  'repo:ops',
  'repo:ui',
  'decision:adrs:331',
  'finding:owner-repositories-unmaterialized',
  'package:governance:repo-governance',
  'package:ops:artifact-assembly',
  'package:ui:semantic-map',
  'pkg.adrs318.canary',
];
for (const required of requiredRegionIds) {
  if (!ids.has(required)) throw new Error(`current organization projection is missing ${required}`);
}
if (projected.receipt.allSelectedRepositoriesRepresented !== true) throw new Error('selected repository universe is incomplete');
if (projected.receipt.allSelectedPackageDirectoriesRepresented !== true) throw new Error('selected package inventory is incomplete');
if (projected.receipt.allOwnerRepositoriesObserved !== false) throw new Error('owner universe gap must remain explicit');

const { createDecisionLog, createEnvelope } = await import(pathToFileURL(protocolPath).href);
const created = await createDecisionLog(records, 'semantic-map:internal-organization-current');
const envelope = await createEnvelope(created.log, null, { pattern: 'map/1' });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'internal-organization-semantic-map-'));
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
  await fs.writeFile(path.join(outputRoot, 'current-organization.jsonl'), sourceBytes);
  await fs.writeFile(path.join(outputRoot, 'map-state.jsonl'), projectedBytes);
  await fs.writeFile(path.join(outputRoot, 'organization-projection-receipt.json'), `${JSON.stringify(projected.receipt, null, 2)}\n`);

  const indexPath = path.join(outputRoot, 'index.html');
  let html = await fs.readFile(indexPath, 'utf8');
  if (!html.includes('<title>Semantic Map</title>')) throw new Error('generated artifact is not the approved Semantic Map');
  for (const required of ['map/1', 'graph/1', 'seq/1', 'decision:adrs:331', 'package:ui:semantic-map']) {
    if (!html.includes(required)) throw new Error(`generated artifact does not contain ${required}`);
  }
  if (html.includes('ADRS UI Proposal Canary') || html.includes('固定canary変更')) {
    throw new Error('retired fixed-form UI leaked into the approved artifact');
  }
  html = html.replace(
    '<title>Semantic Map</title>',
    `<title>Semantic Map</title>\n<meta name="semantic-map-ui-commit" content="${uiCommit}">\n<meta name="semantic-map-ops-commit" content="${candidateSha}">`,
  );
  const marker = '</body>';
  if ((html.split(marker).length - 1) !== 1) throw new Error('generated Semantic Map body marker is not unique');
  html = html.replace(marker, `  <script type="module" src="/proposal-connect.mjs"></script>\n${marker}`);
  const htmlBytes = Buffer.from(html.endsWith('\n') ? html : `${html}\n`);
  await fs.writeFile(indexPath, htmlBytes);

  const generatedReceipt = JSON.parse(await fs.readFile(path.join(outputRoot, 'receipt.json'), 'utf8'));
  const receipt = {
    schema: 'ops.internalOrganizationSemanticMapBuild/1',
    status: 'PASS',
    authority: false,
    adrsDecision: 'roccho-dev/adrs#331',
    adrsAcceptedCommit: 'd249dfa4aa5b9b2d16e51f86757e7b0271251a3d',
    governanceCandidateCommit: '93d2f360affa75947e16219863b2ac333803755b',
    opsCommit: candidateSha,
    uiCommit,
    uiGenerator: 'packages/semantic-map/scripts/build-browser-example.mjs',
    uiConnectability: 'packages/connectability/src/index.mjs',
    patterns: ['map/1', 'graph/1', 'seq/1'],
    source: { path: 'current-organization.jsonl', bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) },
    projection: { path: 'map-state.jsonl', bytes: projectedBytes.byteLength, sha256: sha256(projectedBytes), receipt: projected.receipt },
    output: { path: 'index.html', bytes: htmlBytes.byteLength, sha256: sha256(htmlBytes) },
    connectability: { path: 'connectability.mjs', bytes: connectabilityBytes.byteLength, sha256: sha256(connectabilityBytes) },
    consumer: { path: 'proposal-connect.mjs', bytes: proposalConnectBytes.byteLength, sha256: sha256(proposalConnectBytes) },
    upstreamBuild: generatedReceipt,
    requiredRegionIds,
    selectedUniverseComplete: true,
    allOwnerRepositoriesObserved: false,
    unknownsVisible: true,
    retiredFixedFormPresent: false,
    generatedArtifactsAreAuthority: false,
    cutover: false,
  };
  await fs.writeFile(path.join(outputRoot, 'approved-ui-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
