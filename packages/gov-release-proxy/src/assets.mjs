const frozenAsset = value => Object.freeze(value);

export const PUBLIC_RELEASE = Object.freeze({
  sourceKind: "git-raw",
  repository: "roccho-dev/governance",
  releaseId: null,
  tag: "git/6b20ba62e5b84de7549cc1df801af453dec03a38/docs/final-scope-purpose-join/selected-universe.jsonl",
  targetCommit: "6b20ba62e5b84de7549cc1df801af453dec03a38",
  visibility: "public",
});

export const PRIVATE_FIXTURE_RELEASE = Object.freeze({
  sourceKind: "github-release-asset",
  repository: "roccho-dev/adrs",
  releaseId: 351310910,
  tag: "decision-live-jsonl-dump-20260709-054012-f9f67b1",
  targetCommit: null,
  visibility: "private",
});

export const PUBLIC_ROOT_ASSET = frozenAsset({
  ...PUBLIC_RELEASE,
  assetId: null,
  name: "selected-universe.jsonl",
  path: "docs/final-scope-purpose-join/selected-universe.jsonl",
  bytes: 1378,
  digest: "sha256:d29c4cbee8e3c38fc9a29e9dbe2d39e0a6989a62ba2771302b85711025c9ebc3",
  contentType: "application/x-ndjson; charset=utf-8",
  downloadUrl: "https://raw.githubusercontent.com/roccho-dev/governance/6b20ba62e5b84de7549cc1df801af453dec03a38/docs/final-scope-purpose-join/selected-universe.jsonl",
  requiresCredential: false,
});

export const PRIVATE_FIXTURE_ROOT_ASSET = frozenAsset({
  ...PRIVATE_FIXTURE_RELEASE,
  assetId: 471043875,
  name: "decision-jsonl-dump-20260709-054012.000001.jsonl",
  bytes: 1439,
  digest: "sha256:4dd299b514f2f4a8fa15f6c1a343429c3c62c79860db87d397756e1a5190aa7e",
  contentType: "application/x-ndjson; charset=utf-8",
  downloadUrl: null,
  requiresCredential: true,
});

export const PUBLIC_ASSETS = Object.freeze({ "/": PUBLIC_ROOT_ASSET });
export const PRIVATE_FIXTURE_ASSETS = Object.freeze({ "/": PRIVATE_FIXTURE_ROOT_ASSET });
export const RELEASE = PUBLIC_RELEASE;
export const ASSETS = PUBLIC_ASSETS;

export const rootAssetFor = ({ privateFixtureEnabled = false } = {}) => (
  privateFixtureEnabled ? PRIVATE_FIXTURE_ROOT_ASSET : PUBLIC_ROOT_ASSET
);

export const configFor = ({ privateFixtureEnabled = false } = {}) => Object.freeze({
  schema: "ops.govReleaseProxyConfig/3",
  authority: false,
  endpoint: "/",
  deliveryModel: "one-root",
  browserDirectGitHubFetch: false,
  release: privateFixtureEnabled ? PRIVATE_FIXTURE_RELEASE : PUBLIC_RELEASE,
  asset: rootAssetFor({ privateFixtureEnabled }),
});

export const CONFIG = configFor();
