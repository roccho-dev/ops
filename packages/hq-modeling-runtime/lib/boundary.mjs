export const runtimeBoundary = Object.freeze({
  kind: 'hq.modelingRuntime.boundary.v1',
  packageName: 'hq-modeling-runtime',
  ownerRepo: 'ops',
  purpose: 'ops-owned queue-after-confirm runtime boundary for editor-to-queue-to-ui',
  implementedNow: [
    'package-boundary-metadata',
  ],
  reservedForLaterIssues: Object.freeze({
    'ops#40': 'queue schema and validator',
    'ops#41': 'local worker',
    'ops#42': 'receipt writer',
    'ops#43': 'repo-map projection builder handoff',
    'ops#44': 'admission gate',
  }),
  owns: [
    'queue contract port',
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
    'accepted governance authority',
  ],
  authorityBoundary: {
    queueRows: 'intent only',
    receipts: 'evidence only',
    projections: 'generated read models',
    acceptedLedger: 'explicit admission only; not implemented in scaffold',
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
  ]);

  const overlap = boundary.owns.filter((value) => forbidden.has(value));
  if (overlap.length > 0) {
    throw new Error(`forbidden ownership in hq-modeling-runtime: ${overlap.join(', ')}`);
  }

  return true;
}
