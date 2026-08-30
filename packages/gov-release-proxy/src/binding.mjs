const BINDING_KEYS = [
  "schema",
  "bindingId",
  "authority",
  "claimCeiling",
  "productionCutover",
  "endpoint",
  "deliveryModel",
  "browserDirectGitHubFetch",
  "release",
  "asset",
  "ui",
];
const RELEASE_KEYS = ["sourceKind", "repository", "releaseId", "tag", "targetCommit", "visibility"];
const ASSET_KEYS = ["assetId", "name", "path", "bytes", "digest", "contentType", "downloadUrl", "requiresCredential"];
const UI_KEYS = [
  "repository",
  "rendererSourceCommit",
  "rendererSourceTree",
  "rendererPackage",
  "artifactCommit",
  "artifactTree",
  "artifactRoot",
  "profileId",
  "profileDigest",
  "htmlBytes",
  "htmlDigest",
  "svgDigest",
  "meaningDigest",
  "purpose",
];
const CLAIM_CEILINGS = new Set(["VISUAL_EVALUATION_ONLY", "PRIVATE_FIXTURE_ONLY"]);
const GIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/u;
const BINDING_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

export class BindingError extends Error {
  constructor(message) {
    super(message);
    this.name = "BindingError";
    this.code = "BINDING_INVALID";
    this.status = 500;
  }
}

const fail = (condition, message) => {
  if (!condition) throw new BindingError(message);
};
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sorted = values => [...values].sort();
const exactKeys = (value, expected, path) => {
  fail(isRecord(value), `${path} must be an object`);
  fail(JSON.stringify(sorted(Object.keys(value))) === JSON.stringify(sorted(expected)), `${path} has unsupported or missing fields`);
};
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const clone = value => JSON.parse(JSON.stringify(value));
export const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const validateBinding = candidate => {
  const binding = clone(candidate);
  exactKeys(binding, BINDING_KEYS, "binding");
  fail(binding.schema === "ops.govReleaseProxyBinding/1", "unsupported binding schema");
  fail(BINDING_ID.test(binding.bindingId), "invalid bindingId");
  fail(binding.authority === false, "binding must not claim authority");
  fail(CLAIM_CEILINGS.has(binding.claimCeiling), "unsupported claim ceiling");
  fail(binding.productionCutover === false, "production cutover must remain false");
  fail(binding.endpoint === "/", "only the root endpoint is supported");
  fail(binding.deliveryModel === "one-root", "unsupported delivery model");
  fail(binding.browserDirectGitHubFetch === false, "browser must not fetch GitHub directly");

  exactKeys(binding.release, RELEASE_KEYS, "binding.release");
  exactKeys(binding.asset, ASSET_KEYS, "binding.asset");
  const { release, asset } = binding;
  fail(REPOSITORY.test(release.repository), "invalid release repository");
  fail(["git-raw", "github-release-asset"].includes(release.sourceKind), "unsupported source kind");
  fail(["public", "private"].includes(release.visibility), "unsupported visibility");
  fail(typeof release.tag === "string" && release.tag.length > 0, "release tag is required");
  fail(typeof asset.name === "string" && asset.name.length > 0, "asset name is required");
  fail(positiveInteger(asset.bytes), "asset bytes must be positive");
  fail(SHA256.test(asset.digest), "asset digest must be SHA-256");
  fail(/^application\/(?:json|x-ndjson)(?:;|$)/u.test(asset.contentType), "unsupported asset content type");
  fail(asset.requiresCredential === (release.visibility === "private"), "credential requirement must match visibility");

  if (release.sourceKind === "git-raw") {
    fail(release.releaseId === null, "git-raw releaseId must be null");
    fail(GIT_SHA.test(release.targetCommit), "git-raw targetCommit must be exact");
    fail(asset.assetId === null, "git-raw assetId must be null");
    fail(typeof asset.path === "string" && asset.path.length > 0, "git-raw path is required");
    const expectedUrl = `https://raw.githubusercontent.com/${release.repository}/${release.targetCommit}/${asset.path}`;
    fail(asset.downloadUrl === expectedUrl, "git-raw downloadUrl does not match exact source identity");
    fail(asset.requiresCredential === false, "git-raw source must be anonymous");
  } else {
    fail(positiveInteger(release.releaseId), "release asset releaseId must be positive");
    fail(release.targetCommit === null, "release asset targetCommit must be null");
    fail(positiveInteger(asset.assetId), "release asset assetId must be positive");
    fail(asset.path === null, "release asset path must be null");
    fail(asset.downloadUrl === null, "private release asset downloadUrl must be null");
    fail(asset.requiresCredential === true, "release asset source must require a credential");
  }

  if (binding.ui === null) {
    fail(binding.claimCeiling === "PRIVATE_FIXTURE_ONLY", "a visual binding requires exact UI identity");
  } else {
    exactKeys(binding.ui, UI_KEYS, "binding.ui");
    const ui = binding.ui;
    fail(REPOSITORY.test(ui.repository), "invalid UI repository");
    for (const field of ["rendererSourceCommit", "rendererSourceTree", "artifactCommit", "artifactTree"]) {
      fail(GIT_SHA.test(ui[field]), `binding.ui.${field} must be exact`);
    }
    fail(positiveInteger(ui.htmlBytes), "binding.ui.htmlBytes must be positive");
    for (const field of ["profileDigest", "htmlDigest", "svgDigest", "meaningDigest"]) {
      fail(SHA256.test(ui[field]), `binding.ui.${field} must be SHA-256`);
    }
    for (const field of ["rendererPackage", "artifactRoot", "profileId"]) {
      fail(typeof ui[field] === "string" && ui[field].length > 0, `binding.ui.${field} is required`);
    }
    fail(ui.purpose === "visual-evaluation-only", "unsupported UI purpose");
    fail(ui.meaningDigest === asset.digest, "HTML and NDJSON must bind the same meaning digest");
    fail(binding.claimCeiling === "VISUAL_EVALUATION_ONLY", "visual UI requires visual claim ceiling");
  }

  return deepFreeze(binding);
};

export const parseBinding = value => {
  if (typeof value !== "string") return validateBinding(value);
  try {
    return validateBinding(JSON.parse(value));
  } catch (error) {
    if (error instanceof BindingError) throw error;
    throw new BindingError("binding JSON is malformed");
  }
};
