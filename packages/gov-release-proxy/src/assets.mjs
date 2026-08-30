import publicBindingSource from "../bindings/selected-universe.json" with { type: "json" };
import privateFixtureBindingSource from "../bindings/private-fixture.json" with { type: "json" };
import { deepFreeze, parseBinding, validateBinding } from "./binding.mjs";

const clone = value => JSON.parse(JSON.stringify(value));
const enabled = value => value === true || value === "true" || value === "1";

export const PUBLIC_BINDING = validateBinding(publicBindingSource);
export const PRIVATE_FIXTURE_BINDING = validateBinding(privateFixtureBindingSource);

const releaseCache = new WeakMap();
const assetCache = new WeakMap();

export const releaseForBinding = binding => {
  if (!releaseCache.has(binding)) releaseCache.set(binding, deepFreeze(clone(binding.release)));
  return releaseCache.get(binding);
};

export const assetForBinding = binding => {
  if (!assetCache.has(binding)) {
    assetCache.set(binding, deepFreeze({ ...clone(binding.release), ...clone(binding.asset) }));
  }
  return assetCache.get(binding);
};

export const privateFixtureEnabled = env => enabled(env.ENABLE_PRIVATE_FIXTURE);
export const bindingFromEnv = (env = {}) => {
  const supplied = env.GOV_RELEASE_BINDING_JSON;
  if (supplied !== undefined && supplied !== null && supplied !== "") return parseBinding(supplied);
  return privateFixtureEnabled(env) ? PRIVATE_FIXTURE_BINDING : PUBLIC_BINDING;
};

export const PUBLIC_RELEASE = releaseForBinding(PUBLIC_BINDING);
export const PRIVATE_FIXTURE_RELEASE = releaseForBinding(PRIVATE_FIXTURE_BINDING);
export const PUBLIC_ROOT_ASSET = assetForBinding(PUBLIC_BINDING);
export const PRIVATE_FIXTURE_ROOT_ASSET = assetForBinding(PRIVATE_FIXTURE_BINDING);
export const PUBLIC_ASSETS = Object.freeze({ "/": PUBLIC_ROOT_ASSET });
export const PRIVATE_FIXTURE_ASSETS = Object.freeze({ "/": PRIVATE_FIXTURE_ROOT_ASSET });
export const RELEASE = PUBLIC_RELEASE;
export const ASSETS = PUBLIC_ASSETS;

export const bindingFor = ({ binding, bindingJson, privateFixtureEnabled: usePrivateFixture = false } = {}) => {
  if (bindingJson !== undefined && bindingJson !== null) return parseBinding(bindingJson);
  if (binding !== undefined && binding !== null) {
    if (binding === PUBLIC_BINDING || binding === PRIVATE_FIXTURE_BINDING) return binding;
    return validateBinding(binding);
  }
  return usePrivateFixture ? PRIVATE_FIXTURE_BINDING : PUBLIC_BINDING;
};

export const rootAssetFor = options => assetForBinding(bindingFor(options));

export const configFor = options => {
  const binding = bindingFor(options);
  return Object.freeze({
    schema: "ops.govReleaseProxyConfig/4",
    bindingId: binding.bindingId,
    authority: false,
    claimCeiling: binding.claimCeiling,
    productionCutover: false,
    endpoint: binding.endpoint,
    deliveryModel: binding.deliveryModel,
    browserDirectGitHubFetch: binding.browserDirectGitHubFetch,
    release: releaseForBinding(binding),
    asset: assetForBinding(binding),
    ui: binding.ui,
  });
};

export const CONFIG = configFor();
