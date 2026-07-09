export const runtimeBoundary = Object.freeze({
  kind: 'hq.modelingRuntime.boundary.v1',
  packageName: 'hq-modeling-runtime',
  ownerRepo: 'ops',
  purpose: 'ops-owned queue-after-confirm runtime boundary for editor-to-queue-to-ui',
  implementedNow: [
    'package-boundary-metadata',
    'queue-schema-validator',
    'local-worker',
    'receipt-writer',
    'repo-map-projection-builder',
    'local-dev-admission-gate',
  ],
  reservedForLaterIssues: Object.freeze({}),
  owns: [
    'queue contract port',
    'queue validator core',
    'local worker core',
    'receipt writer core',
    'repo-map projection builder core',
    'local-dev admission gate core',
    'runtime core boundary',
    'worker boundary',
    'receipt boundary',
    'projection builder boundary',
    'admission boundary',
  ],
  doesNotOwn: [
    'editor UX',
    'Vim/hq command surface',
    'browser renderer',
    'UI state',
    'production governance authority',
  ],
  authorityBoundary: {
    queueRows: 'intent only',
    receipts: 'evidence only',
    projections: 'generated read models',
    acceptedLedger: 'local-dev admission only; production governance adoption is not implemented here',
  },
});

export function boundarySummary() {
  return {
    kind: runtimeBoundary.kind,
    packageName: runtimeBoundary.packageName,
    ownerRepo: runtimeBoundary.ownerRepo,
    implementedNow: [...runtimeBoundary.implementedNow],
    laterIssueCount: Object.keys(runtimeBoundary.reservedForLaterIssues).length,
    owns: [...runtimeBoundary.owns],
    doesNotOwn: [...runtimeBoundary.doesNotOwn],
    authorityBoundary: { ...runtimeBoundary.authorityBoundary },
  };
}

export function assertNoForbiddenOwnership(boundary = runtimeBoundary) {
  const forbidden = new Set([
    'editor UX',
    'Vim/hq command surface',
    'browser renderer',
    'UI state',
    'production governance authority',
  ]);

  const overlap = boundary.owns.filter((value) => forbidden.has(value));
  if (overlap.length > 0) {
    throw new Error(`forbidden ownership in hq-modeling-runtime: ${overlap.join(', ')}`);
  }

  return true;
}
