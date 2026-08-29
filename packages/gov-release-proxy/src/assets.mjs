const frozenAsset = value => Object.freeze(value);

export const PUBLIC_RELEASE = Object.freeze({
  repository: "roccho-dev/governance",
  releaseId: 356287183,
  tag: "gov-release/company-operating-contract-v0.2.0/8f087d7babfbb04bce7e9e6a1bd21169dec5d37299c58bfcbb49c5756468c461",
  targetCommit: "42d0bf9de25161fb5f6c2a1538fc61ec1f55650b",
  visibility: "public",
});

export const PRIVATE_FIXTURE_RELEASE = Object.freeze({
  repository: "roccho-dev/adrs",
  releaseId: 351310910,
  tag: "decision-live-jsonl-dump-20260709-054012-f9f67b1",
  targetCommit: null,
  visibility: "private",
});

export const PUBLIC_ASSETS = Object.freeze({
  "/data/manifest": frozenAsset({
    ...PUBLIC_RELEASE,
    assetId: 482207654,
    name: "gov-release-manifest.json",
    bytes: 456,
    digest: "sha256:b7a141c2c37849bed8160de4eb4b397d623133373e6c5831c72500a151a2942f",
    contentType: "application/json; charset=utf-8",
    requiresCredential: false,
  }),
  "/data/accepted-decision": frozenAsset({
    ...PUBLIC_RELEASE,
    assetId: 482207652,
    name: "accepted-decision.json",
    bytes: 942,
    digest: "sha256:6c6409f27657eec4b497d5a0da7a6940416a45508fbf5c7032b57e4ab178f1f6",
    contentType: "application/json; charset=utf-8",
    requiresCredential: false,
  }),
});

export const PRIVATE_FIXTURE_ASSETS = Object.freeze({
  "/proof/private/manifest": frozenAsset({
    ...PRIVATE_FIXTURE_RELEASE,
    assetId: 471043874,
    name: "decision-jsonl-dump-20260709-054012.manifest.json",
    bytes: 810,
    digest: "sha256:35fd3a1d07c8f273176a21e4df897e9d18bb69d782c86d3d8dfd62bfc5ff43fd",
    contentType: "application/json; charset=utf-8",
    requiresCredential: true,
  }),
  "/proof/private/events": frozenAsset({
    ...PRIVATE_FIXTURE_RELEASE,
    assetId: 471043875,
    name: "decision-jsonl-dump-20260709-054012.000001.jsonl",
    bytes: 1439,
    digest: "sha256:4dd299b514f2f4a8fa15f6c1a343429c3c62c79860db87d397756e1a5190aa7e",
    contentType: "application/x-ndjson; charset=utf-8",
    requiresCredential: true,
  }),
});

// Compatibility aliases used by the public-only proof.
export const RELEASE = PUBLIC_RELEASE;
export const ASSETS = PUBLIC_ASSETS;

export const configFor = ({ privateFixtureEnabled = false } = {}) => Object.freeze({
  schema: "ops.govReleaseProxyConfig/2",
  authority: false,
  deliveryModel: "always-worker",
  browserDirectGitHubFetch: false,
  publicRelease: PUBLIC_RELEASE,
  privateFixtureRelease: privateFixtureEnabled ? PRIVATE_FIXTURE_RELEASE : null,
  routes: Object.freeze(Object.entries({
    ...PUBLIC_ASSETS,
    ...(privateFixtureEnabled ? PRIVATE_FIXTURE_ASSETS : {}),
  }).map(([path, asset]) => Object.freeze({ path, ...asset }))),
});

export const CONFIG = configFor();
