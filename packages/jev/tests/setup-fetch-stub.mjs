import { createFakeFetch } from "./cli-helpers.mjs";

const scenario = process.env.TEST_FETCH_SCENARIO;

// Always replace globalThis.fetch to fail closed on unexpected calls
globalThis.fetch = scenario
  ? createFakeFetch(scenario)
  : async (url, opts) => {
      throw new Error(`[NETWORK-GUARD] Unexpected fetch to: ${url}`);
    };
