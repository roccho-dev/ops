export const SOURCE = Object.freeze({
  repository: "roccho-dev/governance",
  releaseSelector: "latest",
  tagPattern: "gov-release/<release-id>/<manifest-sha256>",
  manifestName: "gov-release-manifest.json",
  assetName: "accepted-decision.json",
  acceptedContentTypes: Object.freeze([
    "application/json",
    "application/x-ndjson",
  ]),
  maxManifestBytes: 256_000,
  maxBytes: 2_000_000,
});

export const CONFIG = Object.freeze({
  schema: "ops.govReleaseProxyConfig/5",
  authority: false,
  endpoint: "/",
  deliveryModel: "one-root",
  browserDirectGitHubFetch: false,
  runtimeFixture: false,
  source: SOURCE,
});
