import { createFakeFetch } from "./cli-helpers.mjs";

const scenario = process.env.TEST_FETCH_SCENARIO;

if (scenario) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = createFakeFetch(scenario);

  // Guard: if test somehow calls real fetch, fail immediately
  globalThis.fetch.__isStub = true;
} else {
  // No scenario: block all network calls
  globalThis.fetch = async (url, opts) => {
    throw new Error(`[NETWORK-GUARD] Unexpected fetch call: ${url}`);
  };
  globalThis.fetch.__isGuarded = true;
}
