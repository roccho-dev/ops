export const SOURCE = Object.freeze({
  repository: "roccho-dev/governance",
  releaseSelector: "latest",
  tagPattern: "gov-release/<release-id>/<manifest-sha256>",
  assetName: "accepted-decision.json",
  acceptedContentTypes: Object.freeze([
    "application/json",
    "application/x-ndjson",
  ]),
  maxBytes: 2_000_000,
});

export const CONFIG = Object.freeze({
  schema: "ops.govReleaseProxyConfig/4",
  authority: false,
  endpoint: "/",
  deliveryModel: "one-root",
  browserDirectGitHubFetch: false,
  runtimeFixture: false,
  source: SOURCE,
});
