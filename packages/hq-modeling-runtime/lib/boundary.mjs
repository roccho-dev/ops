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
    'cue-append-contract-adapter',
    'hq-local-root-catalog',
    'hq-serve-local-scaffold',
    'hq-ci-mode-contract',
    'github-issue-comment-readback-adapter-contract',
    'staged-canonical-promotion-eligibility',
  ],
  reservedForLaterIssues: Object.freeze({}),
  owns: [
    'queue contract port',
    'queue validator core',
    'local worker core',
    'receipt writer core',
    'repo-map projection builder core',
    'local-dev admission gate core',
    'cue append contract adapter core',
    'hq local root catalog port',
    'local-only serve scaffold adapter',
    'ci artifact receipt boundary core',
    'GitHub issue-comment readback evidence adapter core',
    'staged-to-canonical promotion eligibility core',
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
    'CUE contract core implementation',
    'remote bare repo write implementation',
    'GitHub issue authority',
    'ChatGPT direct local control',
  ],
  authorityBoundary: {
    queueRows: 'intent only',
    receipts: 'evidence only',
    projections: 'generated read models',
    localRoot: 'recoverable local WIP and proof only; never SSOT',
    ciArtifacts: 'ephemeral evidence only; CI green does not create accepted state',
    githubReadback: 'discussion and JSONL readback evidence only; not accepted authority',
    acceptedLedger: 'local-dev admission only; production governance adoption is not implemented here',
    canonicalPromotion: 'remote bare repo becomes canonical only after eligible staged accepted rows, required receipts, remote write candidate manifest, and successful remote readback',
    cueContractCore: 'external ops contract package; invoked through adapter only',
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
    'CUE contract core implementation',
    'remote bare repo write implementation',
    'GitHub issue authority',
    'ChatGPT direct local control',
  ]);

  const overlap = boundary.owns.filter((value) => forbidden.has(value));
  if (overlap.length > 0) {
    throw new Error(`forbidden ownership in hq-modeling-runtime: ${overlap.join(', ')}`);
  }

  return true;
}
