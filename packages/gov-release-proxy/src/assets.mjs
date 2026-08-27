export const RELEASE = Object.freeze({
  repository: "roccho-dev/governance",
  releaseId: 356287183,
  tag: "gov-release/company-operating-contract-v0.2.0/8f087d7babfbb04bce7e9e6a1bd21169dec5d37299c58bfcbb49c5756468c461",
  targetCommit: "42d0bf9de25161fb5f6c2a1538fc61ec1f55650b",
});

export const ASSETS = Object.freeze({
  "/data/manifest": Object.freeze({
    assetId: 482207654,
    name: "gov-release-manifest.json",
    bytes: 456,
    digest: "sha256:b7a141c2c37849bed8160de4eb4b397d623133373e6c5831c72500a151a2942f",
    contentType: "application/json; charset=utf-8",
  }),
  "/data/accepted-decision": Object.freeze({
    assetId: 482207652,
    name: "accepted-decision.json",
    bytes: 942,
    digest: "sha256:6c6409f27657eec4b497d5a0da7a6940416a45508fbf5c7032b57e4ab178f1f6",
    contentType: "application/json; charset=utf-8",
  }),
});

export const CONFIG = Object.freeze({
  schema: "ops.govReleaseProxyConfig/1",
  authority: false,
  privateUpstream: false,
  release: RELEASE,
  routes: Object.freeze(Object.entries(ASSETS).map(([path, asset]) => Object.freeze({ path, ...asset }))),
});
