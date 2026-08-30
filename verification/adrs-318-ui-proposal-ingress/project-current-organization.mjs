import fs from 'node:fs/promises';
import path from 'node:path';

const REPO_ORDER = Object.freeze(['adrs', 'governance', 'ops', 'ui']);
const STATUS_PREFIX = Object.freeze({
  accepted: '[ACCEPTED]',
  draft: '[DRAFT]',
  candidate: '[CANDIDATE]',
  'merged-core': '[MERGED]',
  observed: '[OBSERVED]',
  'merged-narrow': '[MERGED / NARROW]',
  'provider-pass-input-drift': '[PASS / INPUT DRIFT]',
  'recorded-canary': '[CANARY]',
  unknown: '[UNKNOWN]',
});

function invariant(condition, message) {
  if (!condition) throw new Error(`organization-map-projector: ${message}`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function recordsToJSONL(records) {
  return `${records.map(record => JSON.stringify(canonical(record))).join('\n')}\n`;
}

async function packageNames(root) {
  const packageRoot = path.join(root, 'packages');
  let entries;
  try {
    entries = await fs.readdir(packageRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function resolveRevision(row, revisions) {
  if (row.revision) return row.revision;
  invariant(row.revisionEnv && revisions[row.revisionEnv], `${row.id} revision is missing`);
  return revisions[row.revisionEnv];
}

function packageRow(repo, name, revision, status = 'observed') {
  return {
    authority: false,
    href: `https://github.com/roccho-dev/${repo}/tree/${revision}/packages/${encodeURIComponent(name)}`,
    id: `package:${repo}:${name}`,
    kind: 'organization.package.v1',
    label: name,
    repo,
    status,
  };
}

function statusLabel(row) {
  return `${STATUS_PREFIX[row.status] || `[${String(row.status).toUpperCase()}]`} ${row.label}`;
}

function repoSummary(row, packages, revision) {
  return `${row.role}\nstatus=${row.status} · packages=${packages.length} · revision=${revision.slice(0, 12)} · authority=${row.authority === true}`;
}

function packageSummary(row, revision) {
  return `packages/${row.label}\nstatus=${row.status} · source=${revision.slice(0, 12)} · authority=false`;
}

function ensureUnique(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    invariant(typeof row.id === 'string' && row.id.length > 0, `${label} id is required`);
    invariant(!ids.has(row.id), `duplicate ${label} id ${row.id}`);
    ids.add(row.id);
  }
}

export async function projectCurrentOrganization({ sourceRows, opsRoot, uiRoot, revisions }) {
  invariant(Array.isArray(sourceRows) && sourceRows.length > 0, 'sourceRows are required');
  const metaRows = sourceRows.filter(row => row.kind === 'organization.meta.v1');
  invariant(metaRows.length === 1, 'exactly one organization.meta.v1 is required');
  const meta = metaRows[0];
  invariant(JSON.stringify(meta.selectedUniverse) === JSON.stringify(REPO_ORDER), 'selectedUniverse must be adrs/governance/ops/ui');

  const repoRows = sourceRows.filter(row => row.kind === 'organization.repository.v1');
  ensureUnique(repoRows, 'repository');
  invariant(repoRows.length === REPO_ORDER.length, 'exactly four selected repositories are required');
  for (const repo of REPO_ORDER) invariant(repoRows.some(row => row.id === `repo:${repo}`), `missing repo:${repo}`);

  const staticPackages = sourceRows.filter(row => row.kind === 'organization.package.v1');
  const repoRevisions = Object.fromEntries(repoRows.map(row => [row.label, resolveRevision(row, revisions)]));
  const scanned = [
    ...(await packageNames(opsRoot)).map(name => packageRow('ops', name, repoRevisions.ops)),
    ...(await packageNames(uiRoot)).map(name => packageRow('ui', name, repoRevisions.ui)),
  ];
  const packageById = new Map();
  for (const row of [...staticPackages, ...scanned]) {
    invariant(REPO_ORDER.includes(row.repo), `${row.id} has unknown repo ${row.repo}`);
    invariant(!packageById.has(row.id), `duplicate package id ${row.id}`);
    packageById.set(row.id, row);
  }
  const packagesByRepo = Object.fromEntries(REPO_ORDER.map(repo => [repo, []]));
  for (const row of packageById.values()) packagesByRepo[row.repo].push(row);
  for (const rows of Object.values(packagesByRepo)) rows.sort((a, b) => a.label.localeCompare(b.label, 'en'));

  const events = sourceRows.filter(row => row.kind === 'organization.event.v1');
  const findings = sourceRows.filter(row => row.kind === 'organization.finding.v1');
  const sourceRelations = sourceRows.filter(row => row.from && row.to && row.id && row.kind && row.label);
  ensureUnique(events, 'event');
  ensureUnique(findings, 'finding');

  const packageColumns = 3;
  const cardWidth = 274;
  const cardHeight = 76;
  const cardGapX = 14;
  const cardGapY = 14;
  const repoWidth = 920;
  const repoGap = 34;
  const repoX0 = 40;
  const repoY = 60;
  const groupInset = 30;
  const maxPackageCount = Math.max(...REPO_ORDER.map(repo => Math.max(1, packagesByRepo[repo].length)));
  const packageRows = Math.ceil(maxPackageCount / packageColumns);
  const groupHeight = 76 + packageRows * (cardHeight + cardGapY) + 24;
  const repoHeight = 150 + groupHeight + 24;
  const rootWidth = repoX0 * 2 + REPO_ORDER.length * repoWidth + (REPO_ORDER.length - 1) * repoGap;
  const lifecycleY = repoY + repoHeight + 54;
  const lifecycleHeight = 330;
  const findingsY = lifecycleY + lifecycleHeight + 36;
  const findingsHeight = 220;
  const rootHeight = findingsY + findingsHeight + 50;

  const records = [
    { type: 'meta', schema: 'semantic-map-state/1', root: 'organization:current', title: meta.title },
    {
      type: 'region', id: 'organization:current', parent: null, label: 'Current internal organization', kind: 'organization',
      bounds: [0, 0, rootWidth, rootHeight],
      summary: `selected repositories=${REPO_ORDER.length} · observed package directories=${packageById.size} · owner universe outside selected scope=${meta.ownerUniverse} · authority=false`,
    },
  ];

  for (const [repoIndex, repoName] of REPO_ORDER.entries()) {
    const row = repoRows.find(item => item.label === repoName);
    const revision = repoRevisions[repoName];
    const x = repoX0 + repoIndex * (repoWidth + repoGap);
    const packages = packagesByRepo[repoName];
    records.push({
      type: 'region', id: row.id, parent: 'organization:current', label: statusLabel(row), kind: 'actor',
      bounds: [x, repoY, repoWidth, repoHeight], summary: repoSummary(row, packages, revision), href: row.href,
      order: repoIndex + 1,
    });
    const groupId = `package-group:${repoName}`;
    records.push({
      type: 'region', id: groupId, parent: row.id, label: `packages (${packages.length})`, kind: 'package-group',
      bounds: [x + groupInset, repoY + 100, repoWidth - groupInset * 2, groupHeight],
      summary: packages.length ? `exact packages/ directories observed at ${revision}` : 'No packages/ directory is present at the selected revision; no package is invented.',
    });
    if (packages.length === 0) {
      records.push({
        type: 'region', id: `finding:${repoName}:no-packages-directory`, parent: groupId,
        label: '[OBSERVED] no packages/ directory', kind: 'finding',
        bounds: [x + 54, repoY + 180, repoWidth - 108, 88],
        summary: `The selected ${repoName} revision has no packages/ surface. This is not converted to Green or to an invented package.`,
        href: row.href,
      });
    } else {
      packages.forEach((pkg, index) => {
        const column = index % packageColumns;
        const packageRowIndex = Math.floor(index / packageColumns);
        records.push({
          type: 'region', id: pkg.id, parent: groupId, label: pkg.label, kind: 'package',
          bounds: [
            x + 48 + column * (cardWidth + cardGapX),
            repoY + 178 + packageRowIndex * (cardHeight + cardGapY),
            cardWidth,
            cardHeight,
          ],
          summary: packageSummary(pkg, revision), href: pkg.href,
          order: index + 1,
        });
      });
    }
  }

  records.push({
    type: 'region', id: 'lifecycle:331', parent: 'organization:current', label: 'decision → governance → UI → Ops → readback',
    kind: 'lifecycle', bounds: [40, lifecycleY, rootWidth - 80, lifecycleHeight],
    summary: 'Same event IDs are projected by map/1, graph/1, and seq/1. DRAFT / UNKNOWN remain visible.',
  });
  const eventWidth = 480;
  const eventGap = 32;
  events.sort((a, b) => a.ordinal.start - b.ordinal.start || a.id.localeCompare(b.id));
  events.forEach((event, index) => {
    const x = 74 + index * (eventWidth + eventGap);
    records.push({
      type: 'region', id: event.id, parent: 'lifecycle:331', label: statusLabel(event), kind: 'event',
      bounds: [x, lifecycleY + 92, eventWidth, 132], summary: event.summary, href: event.href,
      temporal: { actor: event.actor, ordinal: event.ordinal }, order: index + 1,
    });
  });

  records.push({
    type: 'region', id: 'findings:current', parent: 'organization:current', label: 'explicit gaps — never false Green',
    kind: 'finding-group', bounds: [40, findingsY, rootWidth - 80, findingsHeight],
    summary: 'Unknown, missing, drift, conflict, waiver, orphan, retired, and residual states stay explicit.',
  });
  findings.sort((a, b) => a.id.localeCompare(b.id));
  findings.forEach((finding, index) => {
    records.push({
      type: 'region', id: finding.id, parent: 'findings:current', label: finding.label, kind: 'finding',
      bounds: [74 + index * 1120, findingsY + 76, 1060, 96], summary: finding.summary, href: finding.href,
      order: index + 1,
    });
  });

  const extraRelations = [
    ['relation:decision-governs-adrs', 'decision:adrs:331', 'repo:adrs', 'governs', 'accepted meaning'],
    ['relation:bundle-governs-governance', 'bundle:governance:210', 'repo:governance', 'projects', 'current state'],
    ['relation:ui-profile-renders-semantic-map', 'projection:ui:181', 'package:ui:semantic-map', 'renders', 'one core'],
    ['relation:ui-profile-renders-profile', 'projection:ui:181', 'package:ui:semantic-map-profiles', 'renders', 'one profile'],
    ['relation:ops-proof-uses-artifact-assembly', 'proof:ops:360', 'package:ops:artifact-assembly', 'uses', 'exact assembly'],
    ['relation:ops-proof-uses-obligation-compiler', 'proof:ops:360', 'package:ops:adrs-obligation-compiler', 'uses', 'decision input'],
    ['relation:bundle-uses-repo-governance', 'bundle:governance:210', 'package:governance:repo-governance', 'uses', 'current projection'],
    ['relation:unknown-owner-universe-finding', 'gap:owner-universe', 'finding:owner-repositories-unmaterialized', 'reveals', 'explicit unknown'],
    ['relation:unknown-conformance-finding', 'bundle:governance:210', 'finding:package-conformance-unverified', 'reveals', 'proof gap'],
  ].filter(([, from, to]) => records.some(row => row.id === from) && records.some(row => row.id === to));

  const relations = [
    ...sourceRelations.map(row => ({ type: 'relation', id: row.id, from: row.from, to: row.to, kind: row.kind, label: row.label })),
    ...extraRelations.map(([id, from, to, kind, label]) => ({ type: 'relation', id, from, to, kind, label })),
  ];
  ensureUnique(relations, 'relation');
  const regionIds = new Set(records.filter(record => record.type === 'region').map(record => record.id));
  for (const relation of relations) {
    invariant(regionIds.has(relation.from), `${relation.id} missing from ${relation.from}`);
    invariant(regionIds.has(relation.to), `${relation.id} missing to ${relation.to}`);
  }
  records.push(...relations);

  return Object.freeze({
    records: Object.freeze(records),
    receipt: Object.freeze({
      schema: 'ui.internalOrganizationProjection/1',
      status: 'PASS',
      authority: false,
      selectedRepositoryCount: REPO_ORDER.length,
      observedPackageDirectoryCount: packageById.size,
      eventCount: events.length,
      findingCount: findings.length + 1,
      relationCount: relations.length,
      allSelectedRepositoriesRepresented: true,
      allSelectedPackageDirectoriesRepresented: true,
      allOwnerRepositoriesObserved: false,
      ownerUniverse: meta.ownerUniverse,
      repositoryRevisions: repoRevisions,
    }),
  });
}
